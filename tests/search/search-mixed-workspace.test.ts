// @vitest-environment node
/**
 * TASK-008 WP2 主进程混合文档搜索测试（任务第 8.3 节）。
 *
 * 覆盖：纯 TXT / 纯 DOCX / 混合工作区与空工作区；大小写扩展名；
 * supported / degraded / read-only / 0 字节 DOCX；损坏、加密、伪装、超限、导入失败
 * 与读取中消失的隔离；不搜索不支持内容、搜索已进入模型的正文；TXT 与 DOCX 统一自然
 * 排序；同一查询在段落、标题、marks、列表中命中；总候选 1000 与 DOCX 候选 200；
 * 单文件 200、总匹配 2000 与截断优先级；总并发 ≤4、DOCX 并发 ≤2；搜索前 / 遍历中 /
 * 读取前后 / 投影与匹配中取消；根错误整体失败；子目录与单文件错误隔离；
 * 符号链接/junction 不跟随（真实链接按环境条件跳过，mock 拒绝分支确定性覆盖）；
 * 搜索不创建或修改任何文件。
 *
 * 新搜索取消旧搜索、工作区切换取消与窗口销毁清理由 `search-ipc.test.ts` 的任务
 * 生命周期测试覆盖（本文件验证搜索器层面的 shouldStop 协作式语义）。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_CANDIDATE_FILES,
  MAX_DOCX_CANDIDATE_FILES,
  type WorkspaceTextSearchFileResult,
  type WorkspaceTextSearchRequest,
  type WorkspaceTextSearchResult,
  type WorkspaceTextSearchTruncatedReason,
} from '../../src/shared/search';
import type { ReadTextDocumentResult } from '../../src/shared/document';
import type {
  DocxBlock,
  DocxDocumentErrorCode,
  DocxDocumentModel,
  DocxDocumentSnapshot,
  ReadDocxDocumentResult,
} from '../../src/shared/docx';
import type { DirEntry, ReadDirFn } from '../../src/main/workspace/scan-workspace';
import { searchTextWorkspace } from '../../src/main/search/search-text-workspace';
import { buildDocxFixtures } from '../docx/docx-fixture-builder';
import { removeDirWithRetry } from '../test-utils/temp-dir-cleanup';

/** mock 工作区根：只需绝对路径（目录读取与文件读取均注入 mock）。 */
const mockRoot = join(tmpdir(), 'wenshu-mixed-search-mock-ws');

function request(query: string, caseSensitive = true): WorkspaceTextSearchRequest {
  return { requestId: 1, query, caseSensitive };
}

function dirent(name: string, kind: 'file' | 'dir' | 'link' | 'other'): DirEntry {
  return {
    name,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir',
    isSymbolicLink: () => kind === 'link',
  };
}

/** 只含指定普通文件的单目录 mock 读取器。 */
function singleDirFiles(names: readonly string[]): ReadDirFn {
  return async () => names.map((name) => dirent(name, 'file'));
}

function txtLoaded(relativePath: string, content = '匹配内容'): ReadTextDocumentResult {
  return {
    status: 'loaded',
    document: {
      name: relativePath.split('/').pop() ?? relativePath,
      relativePath,
      content,
      byteLength: Buffer.byteLength(content, 'utf8'),
      revision: `rev-${relativePath}`,
      hasUtf8Bom: false,
      lineEnding: 'lf',
    },
  };
}

function docxError(code: DocxDocumentErrorCode): ReadDocxDocumentResult {
  return { status: 'error', error: { code, message: `err-${code}` } };
}

function docxSnapshot(
  model: DocxDocumentModel,
  relativePath: string,
  options: {
    readonly revision?: string;
    readonly level?: DocxDocumentSnapshot['compatibility']['level'];
  } = {},
): ReadDocxDocumentResult {
  return {
    status: 'loaded',
    document: {
      kind: 'docx',
      name: relativePath.split('/').pop() ?? relativePath,
      relativePath,
      revision: options.revision ?? `rev-${relativePath}`,
      size: 16,
      model,
      compatibility: { level: options.level ?? 'supported', warnings: [] },
    },
  };
}

function paragraph(text: string): DocxBlock {
  return {
    kind: 'paragraph',
    alignment: null,
    runs: text.length === 0 ? [] : [{ text, marks: [] }],
  };
}

function heading(level: 1 | 2 | 3, text: string): DocxBlock {
  return { kind: 'heading', level, runs: [{ text, marks: [] }] };
}

function modelOf(blocks: readonly DocxBlock[]): DocxDocumentModel {
  return { schemaVersion: 1, blocks };
}

/** 覆盖段落、标题、跨 run marks、空段、嵌套项目符号/编号列表与 emoji 的模型。 */
const STRUCTURE_MODEL = modelOf([
  heading(1, '文档标题'),
  {
    kind: 'paragraph',
    alignment: null,
    runs: [
      { text: '粗体', marks: [{ type: 'bold' }] },
      { text: '与', marks: [] },
      { text: '斜体', marks: [{ type: 'italic' }] },
    ],
  },
  paragraph(''),
  {
    kind: 'bullet-list',
    level: 0,
    blocks: [
      paragraph('项目甲'),
      { kind: 'bullet-list', level: 1, blocks: [paragraph('嵌套项目')] },
    ],
  },
  { kind: 'ordered-list', level: 0, blocks: [paragraph('编号一')] },
  paragraph('emoji 🎉 结尾'),
]);

function completedFiles(result: WorkspaceTextSearchResult): {
  files: readonly WorkspaceTextSearchFileResult[];
  scannedFiles: number;
  matchedFiles: number;
  totalMatches: number;
  skippedFiles: number;
  truncated: boolean;
  truncatedReason: WorkspaceTextSearchTruncatedReason | null;
} {
  expect(result.status).toBe('completed');
  if (result.status !== 'completed') {
    throw new Error('unreachable');
  }
  return {
    files: result.files,
    scannedFiles: result.statistics.scannedFiles,
    matchedFiles: result.statistics.matchedFiles,
    totalMatches: result.statistics.totalMatches,
    skippedFiles: result.statistics.skippedFiles,
    truncated: result.truncated,
    truncatedReason: result.truncatedReason,
  };
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor 超时');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** 调用 n 次后开始返回 true 的停止回调（用于取消阶段的确定性测试）。 */
function stopAfter(n: number): { readonly fn: () => boolean } {
  let calls = 0;
  return {
    fn: () => {
      calls += 1;
      return calls >= n;
    },
  };
}

describe('searchTextWorkspace 混合候选与 kind（第 8.3 节）', () => {
  it('纯 TXT 工作区：结果全部为 txt，行为与 Task 6 一致', async () => {
    const readText = async (_root: string, relativePath: string) =>
      txtLoaded(relativePath, 'hello');
    const result = completedFiles(
      await searchTextWorkspace(mockRoot, request('hello'), {
        readDir: singleDirFiles(['a.txt', 'b.txt']),
        readText,
      }),
    );
    expect(result.files.map((f) => [f.kind, f.relativePath])).toEqual([
      ['txt', 'a.txt'],
      ['txt', 'b.txt'],
    ]);
    expect(result.scannedFiles).toBe(2);
    expect(result.skippedFiles).toBe(0);
  });

  it('纯 DOCX 工作区：段落、标题、跨 run marks、嵌套列表、emoji 均可命中，kind 为 docx', async () => {
    const readDocx = async (_root: string, relativePath: string) =>
      docxSnapshot(STRUCTURE_MODEL, relativePath);
    const readDir = singleDirFiles(['doc.docx']);
    for (const query of ['文档标题', '粗体与斜体', '嵌套项目', '编号一', '🎉', '项目甲']) {
      const result = completedFiles(
        await searchTextWorkspace(mockRoot, request(query), { readDir, readDocx }),
      );
      expect(result.files).toHaveLength(1);
      expect(result.files[0]!.kind).toBe('docx');
      expect(result.files[0]!.relativePath).toBe('doc.docx');
      expect(result.files[0]!.matches.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('混合工作区：TXT 与 DOCX 结果统一自然排序，kind 与文件类型一致', async () => {
    const readDir = singleDirFiles(['z.txt', 'a.docx', 'm.txt']);
    const readText = async (_root: string, relativePath: string) => txtLoaded(relativePath);
    const readDocx = async (_root: string, relativePath: string) =>
      docxSnapshot(modelOf([paragraph('匹配内容')]), relativePath);
    const result = completedFiles(
      await searchTextWorkspace(mockRoot, request('匹配内容'), { readDir, readText, readDocx }),
    );
    expect(result.files.map((f) => [f.kind, f.relativePath])).toEqual([
      ['docx', 'a.docx'],
      ['txt', 'm.txt'],
      ['txt', 'z.txt'],
    ]);
    expect(result.scannedFiles).toBe(3);
  });

  it('大小写扩展名：.DOCX / .Txt / .TXT 均按大小写不敏感分类为候选', async () => {
    const readDir = singleDirFiles(['a.DOCX', 'b.Txt', 'c.TXT']);
    const readText = async (_root: string, relativePath: string) => txtLoaded(relativePath);
    const readDocx = async (_root: string, relativePath: string) =>
      docxSnapshot(modelOf([paragraph('匹配内容')]), relativePath);
    const result = completedFiles(
      await searchTextWorkspace(mockRoot, request('匹配内容'), { readDir, readText, readDocx }),
    );
    expect(result.files.map((f) => [f.kind, f.relativePath])).toEqual([
      ['docx', 'a.DOCX'],
      ['txt', 'b.Txt'],
      ['txt', 'c.TXT'],
    ]);
  });

  it('0 字节 DOCX 占位（空模型）：无匹配、不报错、不计跳过', async () => {
    const readDir = singleDirFiles(['zero.docx']);
    const readDocx = async (_root: string, relativePath: string) =>
      docxSnapshot(modelOf([]), relativePath);
    const result = completedFiles(
      await searchTextWorkspace(mockRoot, request('x'), { readDir, readDocx }),
    );
    expect(result.files).toEqual([]);
    expect(result.scannedFiles).toBe(1);
    expect(result.skippedFiles).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('degraded 与 read-only 文档：已进入模型的正文均可搜索（不影响原兼容性门禁）', async () => {
    const readDir = singleDirFiles(['degraded.docx', 'readonly.docx']);
    const readDocx = async (_root: string, relativePath: string) =>
      docxSnapshot(modelOf([paragraph('共享正文')]), relativePath, {
        level: relativePath.startsWith('degraded') ? 'degraded' : 'read-only',
      });
    const result = completedFiles(
      await searchTextWorkspace(mockRoot, request('共享正文'), { readDir, readDocx }),
    );
    expect(result.files.map((f) => f.relativePath).sort()).toEqual([
      'degraded.docx',
      'readonly.docx',
    ]);
    expect(result.skippedFiles).toBe(0);
  });

  it('不搜索未进入模型的内容：mock 模型不含表格正文，表格文字不命中、模型正文命中', async () => {
    const readDir = singleDirFiles(['table.docx']);
    const readDocx = async (_root: string, relativePath: string) =>
      docxSnapshot(modelOf([paragraph('表格后的正文')]), relativePath);
    const noMatch = completedFiles(
      await searchTextWorkspace(mockRoot, request('单元格'), { readDir, readDocx }),
    );
    expect(noMatch.files).toEqual([]);
    const hit = completedFiles(
      await searchTextWorkspace(mockRoot, request('表格后的正文'), { readDir, readDocx }),
    );
    expect(hit.files).toHaveLength(1);
    expect(hit.files[0]!.kind).toBe('docx');
  });
});

describe('searchTextWorkspace DOCX 单文件错误隔离（第 8.3 节）', () => {
  it('损坏/加密/伪装/超限/资源预算/消失等稳定错误计入跳过，不阻塞其他结果', async () => {
    const readDir = singleDirFiles([
      'corrupt.docx',
      'encrypted.docx',
      'fake.docx',
      'oversize.docx',
      'budget.docx',
      'gone.docx',
      'denied.docx',
      'good.docx',
      'good.txt',
    ]);
    const readText = async (_root: string, relativePath: string) => txtLoaded(relativePath);
    const readDocx = async (_root: string, relativePath: string) => {
      switch (relativePath) {
        case 'corrupt.docx':
          return docxError('INVALID_DOCX');
        case 'encrypted.docx':
          return docxError('INVALID_DOCX');
        case 'fake.docx':
          return docxError('INVALID_DOCX');
        case 'oversize.docx':
          return docxError('TOO_LARGE');
        case 'budget.docx':
          return docxError('RESOURCE_LIMIT_EXCEEDED');
        case 'gone.docx':
          return docxError('NOT_FOUND');
        case 'denied.docx':
          return docxError('ACCESS_DENIED');
        default:
          return docxSnapshot(modelOf([paragraph('匹配内容')]), relativePath);
      }
    };
    const result = completedFiles(
      await searchTextWorkspace(mockRoot, request('匹配内容'), { readDir, readText, readDocx }),
    );
    expect(result.files.map((f) => f.relativePath).sort()).toEqual(['good.docx', 'good.txt']);
    expect(result.skippedFiles).toBe(7);
    expect(result.scannedFiles).toBe(9);
  });
});

describe('searchTextWorkspace 双层并发（第 8.3 节，第 4.5 / 4.7 节）', () => {
  it('总并发不超过 4、DOCX 并发不超过 2，且达到双层上限', async () => {
    // 路径自然排序后 DOCX 与 TXT 交错：a0.docx < a1.txt < a2.docx < ...，
    // 保证 4 个 worker 能同时处于 2 DOCX + 2 TXT 的在途状态。
    const names = [
      'a0.docx',
      'a1.txt',
      'a2.docx',
      'a3.txt',
      'a4.docx',
      'a5.txt',
      'a6.docx',
      'a7.txt',
    ];
    let activeTotal = 0;
    let activeDocx = 0;
    let maxTotal = 0;
    let maxDocx = 0;
    let gateResolve: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      gateResolve = resolve;
    });
    const readText = async () => {
      activeTotal += 1;
      maxTotal = Math.max(maxTotal, activeTotal);
      await gate;
      activeTotal -= 1;
      return txtLoaded('t.txt');
    };
    const readDocx = async () => {
      activeTotal += 1;
      activeDocx += 1;
      maxTotal = Math.max(maxTotal, activeTotal);
      maxDocx = Math.max(maxDocx, activeDocx);
      await gate;
      activeTotal -= 1;
      activeDocx -= 1;
      return docxSnapshot(modelOf([paragraph('匹配内容')]), 'd.docx');
    };
    const promise = searchTextWorkspace(mockRoot, request('匹配内容'), {
      readDir: singleDirFiles(names),
      readText,
      readDocx,
    });
    // 门闩关闭期间：4 个 worker 全部在途（2 DOCX + 2 TXT），其余等待信号量
    await waitFor(() => activeTotal === 4);
    expect(maxTotal).toBe(4);
    expect(maxDocx).toBe(2);
    gateResolve();
    const result = await promise;
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.statistics.scannedFiles).toBe(names.length);
      expect(result.files).toHaveLength(names.length);
    }
  });

  it('自定义双层上限生效：总并发 2、DOCX 并发 1', async () => {
    const names = ['d0.docx', 'd1.docx', 'd2.docx', 'd3.docx'];
    let activeTotal = 0;
    let activeDocx = 0;
    let maxTotal = 0;
    let maxDocx = 0;
    const readDocx = async () => {
      activeTotal += 1;
      activeDocx += 1;
      maxTotal = Math.max(maxTotal, activeTotal);
      maxDocx = Math.max(maxDocx, activeDocx);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeTotal -= 1;
      activeDocx -= 1;
      return docxSnapshot(modelOf([paragraph('匹配内容')]), 'd.docx');
    };
    const result = await searchTextWorkspace(mockRoot, request('匹配内容'), {
      readDir: singleDirFiles(names),
      readDocx,
      readConcurrency: 2,
      docxReadConcurrency: 1,
    });
    expect(result.status).toBe('completed');
    expect(maxTotal).toBeLessThanOrEqual(2);
    expect(maxDocx).toBeLessThanOrEqual(1);
  });
});

describe('searchTextWorkspace 预算与截断（第 8.3 节，第 4.5 节）', () => {
  function matchingModel(): DocxDocumentModel {
    return modelOf([paragraph('匹配')]);
  }

  it('总候选 1000：遍历提前停止，file-limit 优先于 docx-file-limit 报告', async () => {
    // 700 TXT + 700 DOCX：自然排序后前 1000 个候选为 700 DOCX + 300 TXT；
    // 读取列表再按 DOCX 200 上限压缩为 200 DOCX + 300 TXT = 500。
    const docxNames = Array.from({ length: 700 }, (_, i) => `d${String(i).padStart(3, '0')}.docx`);
    const txtNames = Array.from({ length: 700 }, (_, i) => `t${String(i).padStart(3, '0')}.txt`);
    let readCount = 0;
    const readText = async (_root: string, relativePath: string) => {
      readCount += 1;
      return txtLoaded(relativePath);
    };
    const readDocx = async (_root: string, relativePath: string) => {
      readCount += 1;
      return docxSnapshot(matchingModel(), relativePath);
    };
    const result = completedFiles(
      await searchTextWorkspace(mockRoot, request('匹配'), {
        readDir: singleDirFiles([...docxNames, ...txtNames]),
        readText,
        readDocx,
      }),
    );
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe('file-limit');
    expect(result.scannedFiles).toBe(MAX_CANDIDATE_FILES - (700 - MAX_DOCX_CANDIDATE_FILES));
    expect(readCount).toBe(result.scannedFiles);
    expect(result.files).toHaveLength(result.scannedFiles);
    expect(result.files.filter((f) => f.kind === 'docx')).toHaveLength(MAX_DOCX_CANDIDATE_FILES);
    expect(result.files.filter((f) => f.kind === 'txt')).toHaveLength(
      result.scannedFiles - MAX_DOCX_CANDIDATE_FILES,
    );
  });

  it('总候选预算在全局相对路径自然排序后应用，子目录不得提前耗尽预算', async () => {
    const nestedNames = Array.from(
      { length: MAX_CANDIDATE_FILES },
      (_, i) => `${String(i).padStart(4, '0')}.txt`,
    );
    const readDir: ReadDirFn = async (path) => {
      if (path === mockRoot) {
        // 目录名 `a` 在根目录条目排序中早于 `a.txt`，但完整相对路径
        // `a.txt` 早于 `a/0000.txt`；预算必须遵循后者的全局顺序。
        return [dirent('a', 'dir'), dirent('a.txt', 'file')];
      }
      if (path === join(mockRoot, 'a')) {
        return nestedNames.map((name) => dirent(name, 'file'));
      }
      return [];
    };
    const readPaths: string[] = [];
    const result = completedFiles(
      await searchTextWorkspace(mockRoot, request('匹配'), {
        readDir,
        readText: async (_root, relativePath) => {
          readPaths.push(relativePath);
          return txtLoaded(relativePath);
        },
      }),
    );

    expect(result.truncatedReason).toBe('file-limit');
    expect(result.scannedFiles).toBe(MAX_CANDIDATE_FILES);
    expect(readPaths).toContain('a.txt');
    expect(readPaths).not.toContain(`a/${nestedNames[MAX_CANDIDATE_FILES - 1]}`);
    expect(result.files[0]!.relativePath).toBe('a.txt');
  });

  it('DOCX 候选 200：超出部分预算排除（不计跳过），报告 docx-file-limit 且优先于匹配级截断', async () => {
    // 400 TXT + 250 DOCX = 650 个候选（未到 1000 总预算）；
    // 读取列表 = 400 TXT + 200 DOCX = 600；每文件 4 个匹配 → 2400 > 2000 总匹配，
    // 但 docx-file-limit 优先级高于 total-matches-limit。
    const docxNames = Array.from({ length: 250 }, (_, i) => `d${String(i).padStart(3, '0')}.docx`);
    const txtNames = Array.from({ length: 400 }, (_, i) => `t${String(i).padStart(3, '0')}.txt`);
    const readText = async (_root: string, relativePath: string) =>
      txtLoaded(relativePath, '匹配匹配匹配匹配');
    const readDocx = async (_root: string, relativePath: string) =>
      docxSnapshot(modelOf([paragraph('匹配匹配匹配匹配')]), relativePath);
    const result = completedFiles(
      await searchTextWorkspace(mockRoot, request('匹配'), {
        readDir: singleDirFiles([...docxNames, ...txtNames]),
        readText,
        readDocx,
      }),
    );
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe('docx-file-limit');
    expect(result.scannedFiles).toBe(400 + MAX_DOCX_CANDIDATE_FILES);
    expect(result.skippedFiles).toBe(0); // 预算排除不计为读取失败
    expect(result.files.filter((f) => f.kind === 'docx')).toHaveLength(MAX_DOCX_CANDIDATE_FILES);
    // 600 文件 × 4 匹配 = 2400 > 2000：总匹配预算同时截断（500 文件），
    // 但 docx-file-limit 优先级更高，仍报告 docx-file-limit。
    expect(result.totalMatches).toBe(2000);
    expect(result.matchedFiles).toBe(500);
  });

  it('单文件 200：DOCX 投影正文超过单文件匹配上限时截断为 matches-per-file-limit', async () => {
    const readDir = singleDirFiles(['many.docx']);
    const readDocx = async () => docxSnapshot(modelOf([paragraph('a'.repeat(201))]), 'many.docx');
    const result = completedFiles(
      await searchTextWorkspace(mockRoot, request('a'), { readDir, readDocx }),
    );
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.matches).toHaveLength(200);
    expect(result.files[0]!.truncated).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe('matches-per-file-limit');
    expect(result.totalMatches).toBe(200);
  });

  it('总匹配 2000：超过总预算时报告 total-matches-limit', async () => {
    // 11 个 DOCX 各 200 匹配 = 2200；分组预算截断在 2000。
    const names = Array.from({ length: 11 }, (_, i) => `f${String(i).padStart(2, '0')}.docx`);
    const readDocx = async (_root: string, relativePath: string) =>
      docxSnapshot(modelOf([paragraph('ab'.repeat(200))]), relativePath);
    const result = completedFiles(
      await searchTextWorkspace(mockRoot, request('ab'), {
        readDir: singleDirFiles(names),
        readDocx,
      }),
    );
    expect(result.files).toHaveLength(10);
    expect(result.totalMatches).toBe(2000);
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe('total-matches-limit');
  });
});

describe('searchTextWorkspace 取消（第 8.3 节，第 4.7 节）', () => {
  it('搜索前取消：立即停止并返回 cancelled，不读取任何候选', async () => {
    let reads = 0;
    const result = await searchTextWorkspace(mockRoot, request('x'), {
      readDir: singleDirFiles(['a.txt', 'b.docx']),
      readText: async () => {
        reads += 1;
        return txtLoaded('a.txt');
      },
      readDocx: async () => {
        reads += 1;
        return docxSnapshot(modelOf([]), 'b.docx');
      },
      shouldStop: () => true,
    });
    expect(result.status).toBe('cancelled');
    expect(reads).toBe(0);
  });

  it('遍历中取消：返回 cancelled，不提交任何部分结果', async () => {
    const stop = stopAfter(3);
    let readCount = 0;
    const result = await searchTextWorkspace(mockRoot, request('x'), {
      readDir: singleDirFiles(['a.txt', 'b.docx', 'c.txt']),
      readText: async () => {
        readCount += 1;
        return txtLoaded('a.txt');
      },
      readDocx: async () => {
        readCount += 1;
        return docxSnapshot(modelOf([]), 'b.docx');
      },
      shouldStop: stop.fn,
    });
    expect(result.status).toBe('cancelled');
    expect(readCount).toBe(0);
  });

  it('读取中取消（混合）：已开始的受控读取可以完成，其结果不提交', async () => {
    const names = ['d0.docx', 'd1.docx', 't0.txt', 't1.txt'];
    const gates = Array.from({ length: names.length }, () => deferred());
    const readLog: string[] = [];
    let started = 0;
    let stop = false;
    const readText = async (path: string) => {
      started += 1;
      readLog.push(`start:${path}`);
      await gates[Math.min(started - 1, gates.length - 1)]!.promise;
      readLog.push(`done:${path}`);
      return txtLoaded(path);
    };
    const readDocx = async (path: string) => {
      started += 1;
      readLog.push(`start:${path}`);
      await gates[Math.min(started - 1, gates.length - 1)]!.promise;
      readLog.push(`done:${path}`);
      return docxSnapshot(modelOf([paragraph('匹配内容')]), path);
    };
    const promise = searchTextWorkspace(mockRoot, request('匹配内容'), {
      readDir: singleDirFiles(names),
      readText,
      readDocx,
      shouldStop: () => stop,
    });
    await waitFor(() => started === 4);
    stop = true;
    gates.forEach((gate) => gate.resolve(undefined));
    const result = await promise;
    expect(result.status).toBe('cancelled');
    // 四个已开始的读取全部完成（协作式取消不中断受控读取）
    expect(readLog.filter((entry) => entry.startsWith('start:'))).toHaveLength(4);
    expect(readLog.filter((entry) => entry.startsWith('done:'))).toHaveLength(4);
  });

  it('投影/匹配中取消：读取已完成，但结果在投影后或匹配循环内丢弃，整体 cancelled', async () => {
    // stopAfter(12)：全部前置检查点（遍历批次/条目/遍历后/读取前/读取后/投影前后）
    // 远少于 12 次调用，取消必然落在投影后或匹配循环内（断言只依赖"已读取且整体
    // cancelled"，对检查点计数漂移 ±1 依然成立）。
    const stop = stopAfter(12);
    let readCount = 0;
    const result = await searchTextWorkspace(mockRoot, request('匹配'), {
      readDir: singleDirFiles(['many.docx']),
      readDocx: async () => {
        readCount += 1;
        return docxSnapshot(modelOf([paragraph('匹配'.repeat(200))]), 'many.docx');
      },
      shouldStop: stop.fn,
    });
    expect(result.status).toBe('cancelled');
    expect(readCount).toBe(1);
  });
});

describe('searchTextWorkspace 真实文件系统混合搜索（第 8.3 节）', () => {
  let ws: string;
  let realDirSymlinkSupported = false;
  let fixtures: Awaited<ReturnType<typeof buildDocxFixtures>>;

  beforeAll(async () => {
    fixtures = await buildDocxFixtures();
    ws = await mkdtemp(join(tmpdir(), 'wenshu-mixed-search-ws-'));
    await mkdir(join(ws, 'sub'));
    await writeFile(join(ws, 'a.txt'), 'hello world\n中文内容');
    await writeFile(join(ws, 'sub', 'b.txt'), '你好 world');
    await writeFile(join(ws, 'plain.docx'), fixtures.files['ok-plain']!);
    await writeFile(join(ws, 'proj.docx'), fixtures.files['ok-projection-mixed']!);
    await writeFile(join(ws, 'table.docx'), fixtures.files['complex-table']!);
    await writeFile(join(ws, 'readonly.docx'), fixtures.files['ok-read-only']!);
    await writeFile(join(ws, 'empty.docx'), Buffer.alloc(0));
    await writeFile(join(ws, 'corrupt.docx'), fixtures.files['fail-corrupt']!);
    await writeFile(join(ws, 'oversize.docx'), fixtures.files['fail-oversize']!);

    // 有界真实链接探测：本机权限受限时只跳过真实链接用例（mock 拒绝分支继续覆盖）
    const probeDir = await mkdtemp(join(tmpdir(), 'wenshu-mixed-probe-'));
    const probeTarget = join(probeDir, 'target');
    await mkdir(probeTarget);
    try {
      await Promise.race([
        symlink(probeTarget, join(probeDir, 'alias'), 'junction'),
        new Promise<void>((_resolve, reject) => {
          setTimeout(() => reject(new Error('symlink probe timed out')), 5_000);
        }),
      ]);
      realDirSymlinkSupported = true;
    } catch {
      realDirSymlinkSupported = false;
    }
    await removeDirWithRetry(probeDir);
  }, 60_000);

  afterAll(async () => {
    // 真实链接用例在 ws 内创建 junction：清理使用有界重试（EBUSY 瞬时锁）
    await removeDirWithRetry(ws);
  });

  it('混合结果：TXT 与 DOCX 统一自然排序、kind 正确、统计与跳过准确', async () => {
    const result = completedFiles(await searchTextWorkspace(ws, request('中文')));
    expect(result.files.map((f) => [f.kind, f.relativePath])).toEqual([
      ['txt', 'a.txt'],
      ['docx', 'plain.docx'],
      ['docx', 'readonly.docx'],
    ]);
    // 候选：a.txt、sub/b.txt、plain/proj/table/readonly/empty/corrupt/oversize（9 个）
    expect(result.scannedFiles).toBe(9);
    expect(result.skippedFiles).toBe(2); // corrupt + oversize
    expect(result.matchedFiles).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it('read-only DOCX 已进入模型的正文可搜索', async () => {
    const result = completedFiles(await searchTextWorkspace(ws, request('第一段')));
    expect(result.files.map((f) => f.relativePath).sort()).toEqual(['plain.docx', 'readonly.docx']);
  });

  it('标题、跨 run marks、列表与 emoji 在真实 DOCX 中命中', async () => {
    for (const [query, expectedCount] of [
      ['投影标题', 1],
      ['粗体与斜体', 1],
      ['嵌套项目', 1],
      ['English', 1],
      ['🎉', 1],
    ] as const) {
      const result = completedFiles(await searchTextWorkspace(ws, request(query, false)));
      const proj = result.files.find((f) => f.relativePath === 'proj.docx');
      expect(proj, `查询 ${query}`).toBeDefined();
      expect(proj!.matches).toHaveLength(expectedCount);
    }
  });

  it('不搜索未进入模型的内容：表格单元格文字不命中，模型内正文命中', async () => {
    const noMatch = completedFiles(await searchTextWorkspace(ws, request('单元格')));
    expect(noMatch.files).toEqual([]);
    const hit = completedFiles(await searchTextWorkspace(ws, request('表格后的正文')));
    expect(hit.files.map((f) => f.relativePath)).toEqual(['table.docx']);
  });

  it('0 字节 DOCX 占位：无匹配、不报错、不计跳过', async () => {
    const result = completedFiles(await searchTextWorkspace(ws, request('zzzz')));
    expect(result.files).toEqual([]);
    expect(result.skippedFiles).toBe(2); // 只有 corrupt + oversize
    expect(result.truncated).toBe(false);
  });

  it('损坏与超限 DOCX 隔离为跳过，不影响其他结果', async () => {
    const result = completedFiles(await searchTextWorkspace(ws, request('中文')));
    expect(result.files.map((f) => f.relativePath)).not.toContain('corrupt.docx');
    expect(result.files.map((f) => f.relativePath)).not.toContain('oversize.docx');
    expect(result.skippedFiles).toBe(2);
  });

  it('搜索只读：不创建、修改或删除任何文件（无临时/索引/缓存残留）', async () => {
    const listAll = async (): Promise<string[]> => {
      const entries = await readdir(ws, { recursive: true });
      return [...entries].sort();
    };
    const before = await listAll();
    await searchTextWorkspace(ws, request('中文'));
    await searchTextWorkspace(ws, request('匹配', false));
    const after = await listAll();
    expect(after).toEqual(before);
    expect(after.some((name) => name.includes('.wenshu'))).toBe(false);
  });

  it.runIf(realDirSymlinkSupported)(
    '真实符号链接目录不被跟随（环境不支持时跳过，mock 覆盖拒绝分支）',
    async () => {
      await mkdir(join(ws, 'link-target'));
      await writeFile(join(ws, 'link-target', 'linked.docx'), fixtures.files['ok-plain']!);
      await symlink(join(ws, 'link-target'), join(ws, 'link-sub'), 'junction');
      try {
        const result = completedFiles(await searchTextWorkspace(ws, request('中文')));
        const paths = result.files.map((f) => f.relativePath);
        expect(paths).not.toContain('link-sub/linked.docx');
        expect(paths).toContain('plain.docx');
      } finally {
        await removeDirWithRetry(join(ws, 'link-sub'));
        await rm(join(ws, 'link-target'), { recursive: true, force: true });
      }
    },
  );
});
