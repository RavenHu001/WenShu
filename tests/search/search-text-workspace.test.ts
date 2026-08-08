/**
 * TASK-006 WP2 主进程安全搜索器测试（任务第 8.3 节）。
 * 覆盖：无工作区 / 根不可读 / 空工作区；多层子目录与大小写扩展名；
 * 非 TXT、目录、符号链接/junction 与其他类型跳过；子目录与单文件错误隔离；
 * 1000 候选上限；并发不超过固定值 4；搜索前 / 遍历中 / 读取中 / 匹配中取消与重复取消；
 * 结果排序与并发完成顺序无关；统计一致性；不泄漏绝对路径、原始异常或正文。
 * 真实符号链接集成用例按本机权限条件跳过（`it.runIf`），跳过语义由 mock 确定性覆盖。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_CANDIDATE_FILES,
  MAX_FILE_READ_CONCURRENCY,
  type WorkspaceTextSearchFileResult,
  type WorkspaceTextSearchRequest,
} from '../../src/shared/search';
import type { TextDocumentErrorCode, TextDocumentSnapshot } from '../../src/shared/document';
import type { DirEntry, ReadDirFn } from '../../src/main/workspace/scan-workspace';
import { searchTextWorkspace } from '../../src/main/search/search-text-workspace';
import type { ReadTextDocumentResult } from '../../src/shared/document';

/** mock 工作区根：只需绝对路径（目录读取与文件读取均注入 mock）。 */
const mockRoot = join(tmpdir(), 'wenshu-search-mock-ws');

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

function loadedSnapshot(
  content: string,
  relativePath: string,
  extra?: Partial<TextDocumentSnapshot>,
): ReadTextDocumentResult {
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
      ...extra,
    },
  };
}

function errorResult(code: TextDocumentErrorCode, message = `err-${code}`): ReadTextDocumentResult {
  return { status: 'error', error: { code, message } };
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

function completedFiles(result: Awaited<ReturnType<typeof searchTextWorkspace>>): {
  files: readonly WorkspaceTextSearchFileResult[];
  scannedFiles: number;
  matchedFiles: number;
  totalMatches: number;
  skippedFiles: number;
  truncated: boolean;
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
  };
}

describe('searchTextWorkspace 根与请求防御（第 4.7 节）', () => {
  it('无工作区（空或相对根路径）返回 NO_WORKSPACE', async () => {
    for (const root of ['', 'relative/path']) {
      const result = await searchTextWorkspace(root, request('x'), {
        readDir: singleDirFiles(['a.txt']),
      });
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error.code).toBe('NO_WORKSPACE');
        expect(result.requestId).toBe(1);
      }
    }
  });

  it('非法请求防御性返回 INVALID_REQUEST（空查询）', async () => {
    const result = await searchTextWorkspace(mockRoot, {
      requestId: 1,
      query: '',
      caseSensitive: true,
    });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('根目录不可读：整体失败为 SEARCH_FAILED，消息不含路径与原始异常', async () => {
    const readDir: ReadDirFn = async () => {
      throw new Error(`EACCES: permission denied, scandir '${mockRoot}'`);
    };
    const result = await searchTextWorkspace(mockRoot, request('x'), {
      readDir,
      readText: async () => {
        throw new Error('readText 不应被调用');
      },
    });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('SEARCH_FAILED');
      expect(result.error.message).not.toContain(mockRoot);
      expect(result.error.message).not.toContain('EACCES');
    }
  });
});

describe('searchTextWorkspace 遍历与候选收集（第 4.5 / 4.7 节）', () => {
  it('空工作区：completed，无文件、零统计、不截断', async () => {
    const result = completedFiles(
      await searchTextWorkspace(mockRoot, request('x'), { readDir: singleDirFiles([]) }),
    );
    expect(result.files).toEqual([]);
    expect(result.scannedFiles).toBe(0);
    expect(result.matchedFiles).toBe(0);
    expect(result.totalMatches).toBe(0);
    expect(result.skippedFiles).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('非 TXT、其他类型与符号链接跳过：不进入候选、不计入跳过', async () => {
    let dirReads = 0;
    const readDir: ReadDirFn = async (path) => {
      dirReads += 1;
      if (path === mockRoot) {
        return [
          dirent('link-dir', 'link'),
          dirent('link.txt', 'link'),
          dirent('notes.md', 'file'),
          dirent('data.bin', 'other'),
          dirent('real.txt', 'file'),
          dirent('sub', 'dir'),
        ];
      }
      return [];
    };
    const readText = async (_root: string, relativePath: string) =>
      loadedSnapshot('x', relativePath);
    const result = completedFiles(
      await searchTextWorkspace(mockRoot, request('x'), { readDir, readText }),
    );
    expect(result.files.map((f) => f.relativePath)).toEqual(['real.txt']);
    expect(result.scannedFiles).toBe(1);
    expect(result.skippedFiles).toBe(0);
    expect(dirReads).toBe(2); // 根目录 + sub（链接目录不被跟随）
  });

  it('子目录读取失败隔离：计入跳过，同级文件正常返回', async () => {
    const readDir: ReadDirFn = async (path) => {
      if (path === join(mockRoot, 'blocked')) {
        throw new Error('EACCES: permission denied');
      }
      return [dirent('ok.txt', 'file'), dirent('blocked', 'dir'), dirent('ok2.txt', 'file')];
    };
    const readText = async (_root: string, relativePath: string) =>
      loadedSnapshot('x', relativePath);
    const result = completedFiles(
      await searchTextWorkspace(mockRoot, request('x'), { readDir, readText }),
    );
    expect(result.files.map((f) => f.relativePath)).toEqual(['ok.txt', 'ok2.txt']);
    expect(result.skippedFiles).toBe(1);
    expect(result.scannedFiles).toBe(2);
  });

  it('候选文件数达到 1000 上限：截断并报告 file-limit，不读取超出部分', async () => {
    const files = Array.from({ length: MAX_CANDIDATE_FILES + 1 }, (_, i) =>
      String(i).padStart(4, '0'),
    ).map((n) => `f${n}.txt`);
    let readCount = 0;
    const readText = async () => {
      readCount += 1;
      return loadedSnapshot('x', 'f.txt');
    };
    const result = completedFiles(
      await searchTextWorkspace(mockRoot, request('x'), {
        readDir: singleDirFiles(files),
        readText,
      }),
    );
    expect(result.truncated).toBe(true);
    expect(result.scannedFiles).toBe(MAX_CANDIDATE_FILES);
    expect(readCount).toBe(MAX_CANDIDATE_FILES);
    expect(result.totalMatches).toBe(MAX_CANDIDATE_FILES);
  });

  it('多层子目录候选（mock）：相对路径拼接正确且自然排序', async () => {
    const readDir: ReadDirFn = async (path) => {
      if (path === mockRoot) {
        return [dirent('b', 'dir'), dirent('a.txt', 'file')];
      }
      if (path === join(mockRoot, 'b')) {
        return [dirent('a10.txt', 'file'), dirent('a2.txt', 'file')];
      }
      return [];
    };
    const readText = async (_root: string, relativePath: string) =>
      loadedSnapshot('x', relativePath);
    const result = completedFiles(
      await searchTextWorkspace(mockRoot, request('x'), { readDir, readText }),
    );
    expect(result.files.map((f) => f.relativePath)).toEqual(['a.txt', 'b/a2.txt', 'b/a10.txt']);
  });
});

describe('searchTextWorkspace 单文件错误隔离（第 4.7 节）', () => {
  it('各类稳定读取错误计入跳过，不阻塞其他结果', async () => {
    const readText = async (_root: string, relativePath: string) => {
      switch (relativePath) {
        case 'gone.txt':
          return errorResult('NOT_FOUND');
        case 'denied.txt':
          return errorResult('ACCESS_DENIED');
        case 'huge.txt':
          return errorResult('TOO_LARGE');
        case 'bad-utf8.txt':
          return errorResult('INVALID_UTF8');
        case 'not-file.txt':
          return errorResult('NOT_FILE');
        case 'outside.txt':
          return errorResult('OUTSIDE_WORKSPACE');
        case 'unsupported.txt':
          return errorResult('UNSUPPORTED_TYPE');
        default:
          return loadedSnapshot('x', relativePath);
      }
    };
    const result = completedFiles(
      await searchTextWorkspace(mockRoot, request('x'), {
        readDir: singleDirFiles([
          'gone.txt',
          'denied.txt',
          'huge.txt',
          'bad-utf8.txt',
          'not-file.txt',
          'outside.txt',
          'unsupported.txt',
          'good.txt',
        ]),
        readText,
      }),
    );
    expect(result.files.map((f) => f.relativePath)).toEqual(['good.txt']);
    expect(result.skippedFiles).toBe(7);
    expect(result.scannedFiles).toBe(8);
  });

  it('文件消失（读取阶段 NOT_FOUND）隔离：单文件错误不使本次搜索失败', async () => {
    const readText = async (_root: string, relativePath: string) =>
      relativePath === 'gone.txt' ? errorResult('NOT_FOUND') : loadedSnapshot('x', relativePath);
    const result = completedFiles(
      await searchTextWorkspace(mockRoot, request('x'), {
        readDir: singleDirFiles(['gone.txt', 'stay.txt']),
        readText,
      }),
    );
    expect(result.files.map((f) => f.relativePath)).toEqual(['stay.txt']);
    expect(result.skippedFiles).toBe(1);
  });
});

describe('searchTextWorkspace 并发与确定性（第 4.5 节）', () => {
  it('读取并发从不超过固定值 4，且达到并发上限', async () => {
    const gates = Array.from({ length: 10 }, () => deferred());
    let started = 0;
    let maxInFlight = 0;
    const readText = async () => {
      started += 1;
      maxInFlight = Math.max(maxInFlight, started);
      await gates[Math.min(started - 1, gates.length - 1)]!.promise;
      started -= 1;
      return loadedSnapshot('x', 'f.txt');
    };
    const promise = searchTextWorkspace(mockRoot, request('x'), {
      readDir: singleDirFiles(Array.from({ length: 10 }, (_, i) => `f${i}.txt`)),
      readText,
    });
    await waitFor(() => started === MAX_FILE_READ_CONCURRENCY);
    expect(maxInFlight).toBe(MAX_FILE_READ_CONCURRENCY);
    gates.forEach((gate) => gate.resolve(undefined));
    const result = await promise;
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.statistics.scannedFiles).toBe(10);
    }
  });

  it('自定义并发上限生效（并发 1 串行）', async () => {
    const gates = Array.from({ length: 3 }, () => deferred());
    let started = 0;
    let maxInFlight = 0;
    const readText = async () => {
      started += 1;
      maxInFlight = Math.max(maxInFlight, started);
      await gates[Math.min(started - 1, gates.length - 1)]!.promise;
      started -= 1;
      return loadedSnapshot('x', 'f.txt');
    };
    const promise = searchTextWorkspace(mockRoot, request('x'), {
      readDir: singleDirFiles(['a.txt', 'b.txt', 'c.txt']),
      readText,
      readConcurrency: 1,
    });
    await waitFor(() => started === 1);
    expect(maxInFlight).toBe(1);
    gates.forEach((gate) => gate.resolve(undefined));
    const result = await promise;
    expect(result.status).toBe('completed');
  });

  it('结果排序与并发完成顺序无关', async () => {
    const gates = [deferred(), deferred(), deferred()];
    let index = 0;
    const readText = async (_root: string, relativePath: string) => {
      const gate = gates[index]!;
      index += 1;
      await gate.promise;
      return loadedSnapshot('x', relativePath);
    };
    // 乱序放行：c 先完成、a 最后完成
    gates[2]!.resolve(undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));
    gates[1]!.resolve(undefined);
    gates[0]!.resolve(undefined);
    const result = completedFiles(
      await searchTextWorkspace(mockRoot, request('x'), {
        readDir: singleDirFiles(['c.txt', 'a.txt', 'b.txt']),
        readText,
      }),
    );
    expect(result.files.map((f) => f.relativePath)).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });
});

describe('searchTextWorkspace 取消（第 4.6 节）', () => {
  it('搜索前取消：立即停止并返回 cancelled', async () => {
    const result = await searchTextWorkspace(mockRoot, request('x'), {
      readDir: singleDirFiles(['a.txt']),
      readText: async () => loadedSnapshot('x', 'a.txt'),
      shouldStop: () => true,
    });
    expect(result.status).toBe('cancelled');
    if (result.status === 'cancelled') {
      expect(result.requestId).toBe(1);
    }
  });

  it('遍历中取消：返回 cancelled，不提交任何部分结果', async () => {
    const stop = stopAfter(3); // 根目录批次与首个条目后停止
    let readCount = 0;
    const result = await searchTextWorkspace(mockRoot, request('x'), {
      readDir: singleDirFiles(['a.txt', 'b.txt', 'c.txt']),
      readText: async () => {
        readCount += 1;
        return loadedSnapshot('x', 'a.txt');
      },
      shouldStop: stop.fn,
    });
    expect(result.status).toBe('cancelled');
    expect(readCount).toBe(0);
  });

  it('读取中取消：已开始的受控读取可以完成，其结果不提交', async () => {
    const gates = Array.from({ length: 3 }, () => deferred());
    let started = 0;
    let stop = false;
    const readText = async () => {
      started += 1;
      await gates[Math.min(started - 1, gates.length - 1)]!.promise;
      return loadedSnapshot('x', 'f.txt');
    };
    const promise = searchTextWorkspace(mockRoot, request('x'), {
      readDir: singleDirFiles(['a.txt', 'b.txt', 'c.txt']),
      readText,
      shouldStop: () => stop,
    });
    await waitFor(() => started === 3);
    stop = true;
    gates.forEach((gate) => gate.resolve(undefined));
    const result = await promise;
    expect(result.status).toBe('cancelled');
    expect(started).toBe(3); // 在途读取全部完成，但结果未提交
  });

  it('匹配中取消：读取完成后在匹配循环内停止，返回 cancelled', async () => {
    // 单候选文件时 shouldStop 的检查点序列（共 5 个前置检查点）：
    // 1 遍历批次、2 条目循环、3 遍历后、4 读取前、5 读取后；第 6 次即匹配循环首次迭代。
    // 断言只依赖"已读取且整体 cancelled"，对检查点计数漂移 ±1 依然成立。
    const stop = stopAfter(6);
    let readCount = 0;
    const result = await searchTextWorkspace(mockRoot, request('a'), {
      readDir: singleDirFiles(['many.txt']),
      readText: async () => {
        readCount += 1;
        return loadedSnapshot('a'.repeat(50), 'many.txt');
      },
      shouldStop: stop.fn,
    });
    expect(result.status).toBe('cancelled');
    expect(readCount).toBe(1);
  });

  it('重复取消与取消后再次搜索：取消不是错误，两次均返回 cancelled', async () => {
    const readText = async () => loadedSnapshot('x', 'a.txt');
    const options = { readDir: singleDirFiles(['a.txt']), readText, shouldStop: () => true };
    const first = await searchTextWorkspace(mockRoot, request('x'), options);
    const second = await searchTextWorkspace(mockRoot, request('x'), options);
    expect(first.status).toBe('cancelled');
    expect(second.status).toBe('cancelled');
  });
});

describe('searchTextWorkspace 真实文件系统集成', () => {
  let ws: string;
  let realDirSymlinkSupported = false;

  beforeAll(async () => {
    ws = await mkdtemp(join(tmpdir(), 'wenshu-search-ws-'));
    await mkdir(join(ws, 'sub'));
    await writeFile(join(ws, 'alpha.txt'), 'Hello\nWorld');
    await writeFile(join(ws, 'sub', 'beta.TXT'), '你好 world');
    await writeFile(join(ws, 'sub', 'gamma.txt'), 'a\r\nb\r\nworld');
    await writeFile(join(ws, 'notes.md'), 'world here');
    await writeFile(join(ws, 'sub', 'readme.txt'), 'nothing to match');
    await writeFile(join(ws, 'sub', 'bad.txt'), Buffer.from([0xff, 0xfe, 0xfd, 0x61]));

    // 有界真实链接探测：本机权限受限时只跳过真实链接用例（mock 拒绝分支继续覆盖）
    const probeDir = await mkdtemp(join(tmpdir(), 'wenshu-search-probe-'));
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
    await rm(probeDir, { recursive: true, force: true });
  }, 60_000);

  afterAll(async () => {
    await rm(ws, { recursive: true, force: true });
  });

  it('多层目录与大小写扩展名：结果、行列与统计正确（含非法 UTF-8 跳过）', async () => {
    const result = completedFiles(await searchTextWorkspace(ws, request('world', false)));
    expect(result.files.map((f) => f.relativePath)).toEqual([
      'alpha.txt',
      'sub/beta.TXT',
      'sub/gamma.txt',
    ]);
    expect(result.files[0]!.matches).toHaveLength(1);
    expect(result.files[0]!.matches[0]!.line).toBe(2);
    expect(result.files[0]!.matches[0]!.column).toBe(1);
    expect(result.files[1]!.matches[0]!.line).toBe(1);
    expect(result.files[1]!.matches[0]!.column).toBe(4);
    expect(result.files[2]!.matches[0]!.line).toBe(3);
    expect(result.files[2]!.matches[0]!.column).toBe(1);
    expect(result.scannedFiles).toBe(5); // alpha/beta/gamma/readme/bad
    expect(result.matchedFiles).toBe(3);
    expect(result.totalMatches).toBe(3);
    expect(result.skippedFiles).toBe(1); // bad.txt 非法 UTF-8
    expect(result.truncated).toBe(false);
  });

  it('大小写敏感：只有精确匹配被返回', async () => {
    // alpha.txt 第 2 行为 "World"（大写 W），小写 beta/gamma 不含大写 W
    const result = completedFiles(await searchTextWorkspace(ws, request('World', true)));
    expect(result.files.map((f) => f.relativePath)).toEqual(['alpha.txt']);
    expect(result.files[0]!.matches[0]!.line).toBe(2);
    expect(result.files[0]!.matches[0]!.column).toBe(1);
  });

  it('无匹配：completed、空结果、零匹配统计', async () => {
    const result = completedFiles(await searchTextWorkspace(ws, request('zzzz')));
    expect(result.files).toEqual([]);
    expect(result.totalMatches).toBe(0);
    expect(result.matchedFiles).toBe(0);
  });

  it('空工作区：无候选、无错误', async () => {
    const emptyWs = await mkdtemp(join(tmpdir(), 'wenshu-search-empty-'));
    try {
      const result = completedFiles(await searchTextWorkspace(emptyWs, request('x')));
      expect(result.files).toEqual([]);
      expect(result.scannedFiles).toBe(0);
      expect(result.truncated).toBe(false);
    } finally {
      await rm(emptyWs, { recursive: true, force: true });
    }
  });

  it('超过 5 MiB 的 TXT 读取阶段被拒绝并计入跳过', async () => {
    const hugeWs = await mkdtemp(join(tmpdir(), 'wenshu-search-huge-'));
    try {
      await writeFile(join(hugeWs, 'huge.txt'), Buffer.alloc(5 * 1024 * 1024 + 1, 0x61));
      const result = completedFiles(await searchTextWorkspace(hugeWs, request('a')));
      expect(result.files).toEqual([]);
      expect(result.scannedFiles).toBe(1);
      expect(result.skippedFiles).toBe(1);
    } finally {
      await rm(hugeWs, { recursive: true, force: true });
    }
  });

  it.runIf(realDirSymlinkSupported)(
    '真实符号链接目录与文件不被跟随（环境不支持时跳过，mock 覆盖拒绝分支）',
    async () => {
      await symlink(join(ws, 'sub'), join(ws, 'link-sub'), 'junction');
      await symlink(join(ws, 'sub', 'beta.TXT'), join(ws, 'link.txt'), 'file');
      try {
        const result = completedFiles(await searchTextWorkspace(ws, request('world', false)));
        const paths = result.files.map((f) => f.relativePath);
        expect(paths).not.toContain('link-sub/gamma.txt');
        expect(paths).not.toContain('link.txt');
        expect(paths).toContain('sub/gamma.txt');
      } finally {
        await rm(join(ws, 'link-sub'), { recursive: true, force: true });
        await rm(join(ws, 'link.txt'), { force: true });
      }
    },
  );

  it('revision 来自受控读取器：与结果绑定且生命周期内一致', async () => {
    const result = completedFiles(await searchTextWorkspace(ws, request('world', false)));
    for (const file of result.files) {
      expect(file.revision).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
