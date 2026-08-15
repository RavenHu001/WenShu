/**
 * DOCX 规范正文投影 —— TASK-008 WP1（任务第 4.3 节与 WP0 冻结规则）。
 *
 * 将 Task 7 的 `DocxDocumentModel` 投影为确定性的可搜索正文与文本块映射，作为 DOCX
 * 工作区搜索的唯一语义来源：不把 DOCX 当作 UTF-8 TXT，也不直接搜索 OOXML、Mammoth
 * HTML 或编辑器 DOM（任务第一、4.2 节）。本模块是纯 TypeScript 模块，不依赖 Electron、
 * Node.js、Mammoth、Tiptap/ProseMirror、DOM 或文件系统。
 *
 * ## 冻结的投影规则（任务第 4.3 节全部 10 条；WP0 实测冻结）
 *
 * 1. 按文档顺序深度优先遍历模型；
 * 2. 普通段落与标题各形成一个文本块；
 * 3. 列表块自身不产生文字，列表内段落/标题按深度优先顺序形成文本块；
 * 4. 单个文本块内容为全部 run 的 `text` 原样连接，marks/字号/颜色/对齐/标题等级
 *    与列表序号不进入搜索文本；
 * 5. 相邻文本块之间插入恰好一个人工 `\n`；
 * 6. 空段落仍保留为空文本块和相邻分隔边界；
 * 7. 不在文档开头或结尾额外插入换行；
 * 8. 投影偏移使用 UTF-16 code unit，与 JavaScript 字符串和 ProseMirror 文本位置一致；
 * 9. 投影结果携带仅供进程内映射使用的文本块序号、投影 `from/to` 与块正文；
 * 10. 投影函数不依赖 Electron、Node.js、Mammoth、Tiptap、ProseMirror、DOM 或文件系统。
 *
 * ## 输入前提（调用方保证）
 *
 * - 输入必须是经过 `validateDocxDocumentModel` 的合法模型（结构、预算、规范形式）；
 *   投影本身不做完整重新校验，避免对每个候选文件重复 O(n) 校验（WP0 实测 20,000 块
 *   模型投影约 7 ms）。
 * - 附加冻结约束（WP0 实测）：产品模型（导入/转换）不产生空文本 run——空 run 在
 *   `importRuns` 与 `parseInlineContent` 中都被跳过，且 ProseMirror `nodeFromJSON`
 *   拒绝空 text 节点；投影对空文本 run 视为无贡献，输出与真实模型一致。
 */

import type { DocxBlock, DocxDocumentModel } from './docx';

/** 单个文本块在投影中的段映射（仅供进程内映射使用，不跨 IPC 传递模型或 PM 节点）。 */
export interface DocxSearchTextBlock {
  /** 文本块序号（文档顺序，0 起始）。 */
  readonly ordinal: number;
  /** 块起点在完整投影文本中的 UTF-16 偏移。 */
  readonly from: number;
  /** 块终点（不包含）在完整投影文本中的 UTF-16 偏移。 */
  readonly to: number;
  /** 块正文（全部 run text 原样连接）。 */
  readonly text: string;
}

/** 规范正文投影：完整可搜索文本 + 深度优先文本块段映射。 */
export interface DocxSearchTextProjection {
  /** 完整规范投影文本。 */
  readonly text: string;
  /** 文本块段映射（深度优先顺序）。 */
  readonly blocks: readonly DocxSearchTextBlock[];
}

/** 深度优先收集文本块：列表块不产生文字，只递归其条目。 */
function collectTextBlocks(
  blocks: readonly DocxBlock[],
): readonly Extract<DocxBlock, { readonly kind: 'paragraph' | 'heading' }>[] {
  const out: Extract<DocxBlock, { readonly kind: 'paragraph' | 'heading' }>[] = [];
  const visit = (items: readonly DocxBlock[]): void => {
    for (const block of items) {
      if (block.kind === 'paragraph' || block.kind === 'heading') {
        out.push(block);
      } else {
        visit(block.blocks);
      }
    }
  };
  visit(blocks);
  return out;
}

/**
 * 把 `DocxDocumentModel` 投影为规范可搜索正文与文本块映射（第 4.3 节全部规则）。
 * 输入必须是合法模型（`validateDocxDocumentModel` 通过）；输出为确定性纯数据，
 * 可被 WP2 搜索器直接送入现有 literal matcher，并供 WP4 做 ProseMirror 位置映射。
 */
export function projectDocxModelSearchText(model: DocxDocumentModel): DocxSearchTextProjection {
  const textBlocks = collectTextBlocks(model.blocks);
  const texts = textBlocks.map((block) => block.runs.map((run) => run.text).join(''));
  const text = texts.join('\n');
  const blocks: DocxSearchTextBlock[] = [];
  let offset = 0;
  for (let ordinal = 0; ordinal < texts.length; ordinal += 1) {
    const blockText = texts[ordinal]!;
    blocks.push({ ordinal, from: offset, to: offset + blockText.length, text: blockText });
    offset += blockText.length + 1; // 相邻块之间恰好一个 `\n`
  }
  return { text, blocks };
}
