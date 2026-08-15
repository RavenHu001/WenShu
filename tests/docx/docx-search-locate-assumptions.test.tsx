// @vitest-environment jsdom
/**
 * TASK-008 WP0 技术验证：DOCX 结果定位假设与主进程并发/取消假设（任务第 3.3 节）。
 *
 * ## 覆盖
 *
 * - ProseMirror 公开 API：`setTextSelection` / `scrollIntoView` / `focus` 命令，
 *   不读取私有 DOM（第 4.8 节"使用公开命令设置选区、滚动和聚焦"）；
 * - 投影偏移 → PM 位置映射：块起点 + 块内 UTF-16 偏移，中文/emoji/组合字符一致；
 * - read-only 编辑器：可以显示选区并滚动，不会因此获得编辑能力；
 * - 接近 20 MiB DOCX 单文件读取：已开始的读取可完成（耗时窗口实测）；
 * - 协作式取消："已开始读取可完成、结果不再提交"（搜索器注入慢读取验证）；
 * - 双层并发：总并发 ≤4、DOCX 并发 ≤2（冻结池模式测试脚手架，WP2 固化）。
 *
 * 本文件中的 `runMixedSearch`（双层并发池）为测试脚手架（WP2 把同一设计实现为产品
 * 模块）；`projectDocxModelSearchText` 自 WP1 起导入产品模块 `src/shared/docx-search-text.ts`。
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Editor, type Content } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TextStyle, FontSize } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { TextAlign } from '@tiptap/extension-text-align';
import type { DocxDocumentModel } from '../../src/shared/docx';
import { docxModelToTiptapJson } from '../../src/shared/docx-convert';
import { readDocxDocument } from '../../src/main/docx/read-docx-document';
import { searchTextWorkspace } from '../../src/main/search/search-text-workspace';
import type { DirEntry, ReadDirFn } from '../../src/main/workspace/scan-workspace';
import type { ReadTextDocumentResult } from '../../src/shared/document';
import { buildDocxFixtures } from './docx-fixture-builder';
import { projectDocxModelSearchText } from '../../src/shared/docx-search-text';

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverMock;
  if (typeof Range !== 'undefined' && typeof Range.prototype.getClientRects !== 'function') {
    Range.prototype.getClientRects = (() => []) as unknown as () => DOMRectList;
  }
  if (typeof Range !== 'undefined' && typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 }) as DOMRect;
  }
});

afterEach(() => {
  document.body.innerHTML = '';
});

/** 与产品 DOCX_EDITOR_EXTENSIONS 相同的扩展链（link 输入关闭）。 */
const DOCX_EDITOR_EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
  TextStyle,
  Color,
  FontSize,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
];

function paragraph(text: string): DocxBlockLike {
  return {
    kind: 'paragraph',
    alignment: null,
    runs: text.length === 0 ? [] : [{ text, marks: [] }],
  };
}

type DocxBlockLike = DocxDocumentModel['blocks'][number];

const LOCATE_MODEL: DocxDocumentModel = {
  schemaVersion: 1,
  blocks: [
    { kind: 'heading', level: 1, runs: [{ text: '定位标题', marks: [] }] },
    {
      kind: 'paragraph',
      alignment: null,
      runs: [
        { text: '粗体', marks: [{ type: 'bold' }] },
        { text: '跨', marks: [] },
        { text: 'run', marks: [{ type: 'italic' }] },
      ],
    },
    paragraph(''),
    {
      kind: 'bullet-list',
      level: 0,
      blocks: [
        paragraph('列表条目'),
        { kind: 'bullet-list', level: 1, blocks: [paragraph('嵌套条目')] },
      ],
    },
    paragraph('emoji 🎉 与组合字符 e\u0301 结尾'),
  ],
};

/** 创建真实 Tiptap 编辑器（公开 API；与产品宿主同扩展链）。 */
function createEditor(model: DocxDocumentModel, editable: boolean): Editor {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new Editor({
    element: container,
    extensions: DOCX_EDITOR_EXTENSIONS,
    content: docxModelToTiptapJson(model) as unknown as Content,
    editable,
  });
}

/** 把投影偏移映射为 PM 位置：文本块起点（pos+1）+ 块内 UTF-16 偏移。 */
function mapToPmPosition(editor: Editor, blockIndex: number, blockOffset: number): number {
  const doc = editor.view.state.doc;
  let currentBlock = 0;
  let mapped = -1;
  // 注意：descendants 的 return false 只停止进入该节点子树，不停止整个遍历；
  // 匹配后必须用 done 标志终止，否则后续文本块会覆盖映射结果（WP0 实测发现）。
  let done = false;
  doc.descendants((node, pos) => {
    if (done) {
      return false;
    }
    if (node.isTextblock) {
      if (currentBlock === blockIndex) {
        mapped = pos + 1 + blockOffset;
        done = true;
        return false;
      }
      currentBlock += 1;
    }
    return true;
  });
  return mapped;
}

/** 按文档顺序收集 PM textblock 文本（公开 API）。 */
function pmBlockTexts(editor: Editor): readonly string[] {
  const texts: string[] = [];
  editor.view.state.doc.descendants((node) => {
    if (node.isTextblock) {
      texts.push(node.textContent);
    }
    return true;
  });
  return texts;
}

/* ======================= ProseMirror 公开 API 定位 ======================= */

describe('ProseMirror 公开 API 定位（TASK-008 WP0，第 3.3 / 4.8 节）', () => {
  it('投影偏移映射为 PM 位置后 setTextSelection/scrollIntoView/focus 生效', async () => {
    const editor = createEditor(LOCATE_MODEL, true);
    try {
      const projection = projectDocxModelSearchText(LOCATE_MODEL);
      expect(pmBlockTexts(editor)).toEqual(projection.blocks.map((b) => b.text));

      // 跨 run 匹配："粗体跨run" 位于块 1
      const query = '粗体跨run';
      const fromInBlock = projection.blocks[1]!.text.indexOf(query);
      expect(fromInBlock).toBe(0);
      const from = mapToPmPosition(editor, 1, fromInBlock);
      const to = from + query.length;
      expect(editor.view.state.doc.textBetween(from, to)).toBe('粗体跨run');

      // 公开命令设置选区：不读取私有 DOM
      expect(editor.commands.setTextSelection({ from, to })).toBe(true);
      const selection = editor.view.state.selection;
      expect(selection.from).toBe(from);
      expect(selection.to).toBe(to);
      expect(editor.view.state.doc.textBetween(from, to)).toBe('粗体跨run');
      // 选区命令不修改正文
      expect(pmBlockTexts(editor)).toEqual(projection.blocks.map((b) => b.text));

      // 公开命令滚动与聚焦
      expect(() => editor.commands.scrollIntoView()).not.toThrow();
      expect(editor.commands.focus()).toBe(true);
      // Tiptap focus 命令经 requestAnimationFrame 延迟调用 view.focus()（WP0 实测），
      // 等一帧后断言真实焦点（jsdom 支持 RAF 派发）
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      expect(editor.view.hasFocus()).toBe(true);
      // 滚动/聚焦不改选区与正文（PM textContent 无人工分隔符：长度等于各块正文之和）
      expect(editor.view.state.selection.from).toBe(from);
      expect(editor.view.state.doc.textContent.length).toBe(
        projection.blocks.reduce((total, block) => total + block.text.length, 0),
      );
    } finally {
      editor.destroy();
    }
  });

  it('emoji 代理对与组合字符的块内偏移映射到正确 PM 范围', () => {
    const editor = createEditor(LOCATE_MODEL, true);
    try {
      const projection = projectDocxModelSearchText(LOCATE_MODEL);
      const last = projection.blocks[projection.blocks.length - 1]!;
      const emojiOffset = last.text.indexOf('🎉');
      expect(emojiOffset).toBeGreaterThanOrEqual(0);
      const from = mapToPmPosition(editor, projection.blocks.length - 1, emojiOffset);
      // 🎉 为代理对：占 2 个 UTF-16 code unit
      expect(editor.view.state.doc.textBetween(from, from + 2)).toBe('🎉');
      expect(editor.commands.setTextSelection({ from, to: from + 2 })).toBe(true);
      expect(editor.view.state.selection.to - editor.view.state.selection.from).toBe(2);
    } finally {
      editor.destroy();
    }
  });

  it('空段落保留为空 textblock，定位其后的块不偏移', () => {
    const editor = createEditor(LOCATE_MODEL, true);
    try {
      const projection = projectDocxModelSearchText(LOCATE_MODEL);
      expect(projection.blocks[2]!.text).toBe('');
      // 空段保留为空文本块：相邻块之间恰好一个 `\n`（不变量）
      for (let i = 1; i < projection.blocks.length; i += 1) {
        expect(projection.blocks[i]!.from).toBe(projection.blocks[i - 1]!.to + 1);
      }
      const from = mapToPmPosition(editor, 3, 0);
      expect(editor.view.state.doc.textBetween(from, from + '列表条目'.length)).toBe('列表条目');
    } finally {
      editor.destroy();
    }
  });

  it('read-only 编辑器：可显示选区与滚动，不因此获得编辑能力', async () => {
    const editor = createEditor(LOCATE_MODEL, false);
    try {
      expect(editor.isEditable).toBe(false);
      const container = editor.view.dom;
      expect(container.getAttribute('contenteditable')).toBe('false');
      const projection = projectDocxModelSearchText(LOCATE_MODEL);
      const before = editor.view.state.doc.textContent;

      const from = mapToPmPosition(editor, 0, 0);
      // 映射位置在只读编辑器上同样精确命中目标文本
      expect(editor.view.state.doc.textBetween(from, from + '定位标题'.length)).toBe('定位标题');
      expect(editor.commands.setTextSelection({ from, to: from + '定位标题'.length })).toBe(true);
      expect(editor.view.state.selection.from).toBe(from);
      expect(() => editor.commands.scrollIntoView()).not.toThrow();
      expect(editor.commands.focus()).toBe(true);
      // 只读语义（WP0 实测记录）：PM view.focus() 对非 editable 视图是安全 no-op，
      // 不设置 DOM 焦点（不开放编辑），选区与滚动不受影响；真实浏览器同样如此。
      expect(editor.view.hasFocus()).toBe(false);
      expect(editor.view.state.selection.from).toBe(from);
      // 选区/滚动/聚焦不改变正文、不产生历史步骤
      expect(editor.view.state.doc.textContent).toBe(before);
      expect(projection.blocks.map((b) => b.text)).toEqual(pmBlockTexts(editor));
      // 不可编辑：DOM 仍为非 contenteditable
      expect(container.getAttribute('contenteditable')).toBe('false');
    } finally {
      editor.destroy();
    }
  });

  it('嵌套列表条目按深度优先映射为 PM textblock', () => {
    const editor = createEditor(LOCATE_MODEL, true);
    try {
      const projection = projectDocxModelSearchText(LOCATE_MODEL);
      const nestedIndex = projection.blocks.findIndex((b) => b.text === '嵌套条目');
      expect(nestedIndex).toBe(4);
      const from = mapToPmPosition(editor, nestedIndex, 0);
      expect(editor.view.state.doc.textBetween(from, from + 4)).toBe('嵌套条目');
    } finally {
      editor.destroy();
    }
  });
});

/* ======================= 接近 20 MiB 读取与取消 ======================= */

describe('接近 20 MiB DOCX 读取与协作式取消（TASK-008 WP0，第 3.3 节）', () => {
  it('接近上限的单文件读取可完成且耗时窗口有限（已开始读取可完成的语义基础）', async () => {
    const fixtures = await buildDocxFixtures();
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'wenshu-wp0-large-'));
    try {
      const bytes = fixtures.files['ok-large']!;
      expect(bytes.byteLength).toBe(20 * 1024 * 1024);
      await writeFile(join(workspaceRoot, 'large.docx'), bytes);
      const started = Date.now();
      const result = await readDocxDocument(workspaceRoot, 'large.docx');
      const elapsed = Date.now() - started;
      expect(result.status).toBe('loaded');
      if (result.status === 'loaded') {
        expect(result.document.size).toBe(20 * 1024 * 1024);
        expect(result.document.revision).toMatch(/^[0-9a-f]{64}$/);
      }
      // WP0 冻结观察：接近 20 MiB 的受控读取在秒级预算内完成；
      // 该窗口即"取消后允许已开始读取完成"的协作式语义时间成本。
      expect(elapsed).toBeLessThan(15_000);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('读取中取消：已开始的受控读取可以完成，其结果不提交（搜索器现网语义）', async () => {
    const readLog: string[] = [];
    const readText = async (): Promise<ReadTextDocumentResult> => {
      readLog.push('start');
      await new Promise((resolve) => setTimeout(resolve, 60));
      readLog.push('done');
      return {
        status: 'loaded',
        document: {
          name: 'a.txt',
          relativePath: 'a.txt',
          content: '匹配内容',
          byteLength: 12,
          revision: 'rev-a',
          hasUtf8Bom: false,
          lineEnding: 'lf',
        },
      };
    };
    const readDir: ReadDirFn = async () =>
      [
        dirent('a.txt', 'file'),
        dirent('b.txt', 'file'),
        dirent('c.txt', 'file'),
      ] as readonly DirEntry[];
    let stopped = false;
    // 读取开始后置位停止标志（模拟搜索/工作区切换/窗口销毁时的协作式取消）
    setTimeout(() => {
      stopped = true;
    }, 10);
    const result = await searchTextWorkspace(
      mockRoot,
      { requestId: 1, query: '匹配', caseSensitive: true },
      {
        readDir,
        readText,
        shouldStop: () => stopped,
      },
    );
    expect(result.status).toBe('cancelled');
    // 三个已开始的读取全部执行到完成（协作式取消不中断受控读取）
    expect(readLog.filter((entry) => entry === 'start')).toHaveLength(3);
    expect(readLog.filter((entry) => entry === 'done')).toHaveLength(3);
    expect(readLog).toEqual(['start', 'start', 'start', 'done', 'done', 'done']);
  });
});

/** mock 工作区根：只需绝对路径（目录读取与文件读取均注入 mock）。 */
const mockRoot = join(tmpdir(), 'wenshu-wp0-search-root');

function dirent(name: string, kind: 'file' | 'dir' | 'link' | 'other'): DirEntry {
  return {
    name,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir',
    isSymbolicLink: () => kind === 'link',
  };
}

/* ======================= 双层并发（总 4 / DOCX 2） ======================= */

/** 二值信号量：`limit` 个并发许可。 */
class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(limit: number) {
    this.available = limit;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next !== undefined) {
      next();
    } else {
      this.available += 1;
    }
  }
}

interface MixedCandidate {
  readonly kind: 'txt' | 'docx';
  readonly path: string;
}

interface MixedSearchOutcome {
  readonly status: 'completed' | 'cancelled';
  readonly maxTotalInFlight: number;
  readonly maxDocxInFlight: number;
  readonly reads: number;
}

/**
 * 冻结的双层并发池模式（测试脚手架；WP2 实现产品搜索器时复用该设计）：
 * - 总并发 ≤ `totalLimit`（4），其中 DOCX 同时读取/导入 ≤ `docxLimit`（2）；
 * - 顺序取候选（预先自然排序），读取完成顺序不影响最终排序（排序在池外）；
 * - 协作式取消：读取完成后检查 `shouldStop`，停止时丢弃结果并整体返回 cancelled。
 */
async function runMixedSearch(
  candidates: readonly MixedCandidate[],
  options: {
    readonly totalLimit: number;
    readonly docxLimit: number;
    readonly shouldStop: () => boolean;
    readonly readTxt: (path: string) => Promise<void>;
    readonly readDocx: (path: string) => Promise<void>;
  },
): Promise<MixedSearchOutcome> {
  const totalSem = new Semaphore(options.totalLimit);
  const docxSem = new Semaphore(options.docxLimit);
  let nextIndex = 0;
  let activeTotal = 0;
  let activeDocx = 0;
  let maxTotalInFlight = 0;
  let maxDocxInFlight = 0;
  let reads = 0;
  let cancelled = false;

  const track = (): void => {
    maxTotalInFlight = Math.max(maxTotalInFlight, activeTotal);
    maxDocxInFlight = Math.max(maxDocxInFlight, activeDocx);
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= candidates.length) {
        return;
      }
      const candidate = candidates[index]!;
      if (candidate.kind === 'docx') {
        await docxSem.acquire();
      }
      await totalSem.acquire();
      activeTotal += 1;
      if (candidate.kind === 'docx') {
        activeDocx += 1;
      }
      track();
      try {
        // 已开始的受控读取可以完成；取消只在读取前后检查
        if (candidate.kind === 'docx') {
          await options.readDocx(candidate.path);
        } else {
          await options.readTxt(candidate.path);
        }
        reads += 1;
        if (options.shouldStop()) {
          cancelled = true;
        }
      } finally {
        activeTotal -= 1;
        if (candidate.kind === 'docx') {
          activeDocx -= 1;
        }
        totalSem.release();
        if (candidate.kind === 'docx') {
          docxSem.release();
        }
      }
    }
  };

  const workers = Array.from({ length: options.totalLimit }, () => worker());
  await Promise.all(workers);
  return {
    status: cancelled ? 'cancelled' : 'completed',
    maxTotalInFlight,
    maxDocxInFlight,
    reads,
  };
}

describe('双层并发与取消（TASK-008 WP0，第 4.5 / 4.7 节冻结假设）', () => {
  it('总并发不超过 4，DOCX 并发不超过 2；全部读取完成后排序无关提交', async () => {
    const candidates: MixedCandidate[] = [];
    for (let i = 0; i < 6; i += 1) {
      candidates.push({ kind: 'txt', path: `t${i}.txt` });
      candidates.push({ kind: 'docx', path: `d${i}.docx` });
    }
    const started: string[] = [];
    const finished: string[] = [];
    let gateResolve: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      gateResolve = resolve;
    });
    const outcome = runMixedSearch(candidates, {
      totalLimit: 4,
      docxLimit: 2,
      shouldStop: () => false,
      readTxt: async (path) => {
        started.push(path);
        await gate;
        finished.push(path);
      },
      readDocx: async (path) => {
        started.push(path);
        await gate;
        finished.push(path);
      },
    });
    // 门闩关闭期间：4 个 worker 已启动（2 DOCX + 2 TXT），其余等待
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(started.filter((p) => p.endsWith('.docx'))).toHaveLength(2);
    expect(started.filter((p) => p.endsWith('.txt'))).toHaveLength(2);
    gateResolve();
    const result = await outcome;
    expect(result.status).toBe('completed');
    expect(result.reads).toBe(candidates.length);
    expect(result.maxTotalInFlight).toBeLessThanOrEqual(4);
    expect(result.maxDocxInFlight).toBeLessThanOrEqual(2);
    // 并发确实达到双层上限（冻结假设成立而非空转）
    expect(result.maxTotalInFlight).toBe(4);
    expect(result.maxDocxInFlight).toBe(2);
    expect(finished.length).toBe(candidates.length);
  });

  it('读取完成时已取消：结果不提交，整体返回 cancelled（无部分 completed）', async () => {
    const candidates: MixedCandidate[] = [
      { kind: 'docx', path: 'a.docx' },
      { kind: 'txt', path: 'b.txt' },
      { kind: 'docx', path: 'c.docx' },
      { kind: 'txt', path: 'd.txt' },
    ];
    let gateResolve: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      gateResolve = resolve;
    });
    let stopped = false;
    const resultPromise = runMixedSearch(candidates, {
      totalLimit: 4,
      docxLimit: 2,
      shouldStop: () => stopped,
      readTxt: async () => {
        await gate;
      },
      readDocx: async () => {
        await gate;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    stopped = true; // 读取在途时置位取消
    gateResolve();
    const result = await resultPromise;
    expect(result.status).toBe('cancelled');
    // 已开始的 4 个读取全部完成（读取不中断），但整体结果不标记 completed
    expect(result.reads).toBe(candidates.length);
  });
});
