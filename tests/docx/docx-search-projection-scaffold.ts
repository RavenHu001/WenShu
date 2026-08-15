/**
 * TASK-008 WP0 冻结投影脚手架 —— 测试共享模块（WP1 将同一规则实现为产品模块
 * `src/shared/docx-search-text.ts`，届时本脚手架退役或被产品模块替换）。
 *
 * ## 冻结的投影规则（任务第 4.3 节）
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
 * 附加冻结约束（WP0 实测）：产品模型（导入/转换）不产生空文本 run——空 run 在
 * `importRuns` 与 `parseInlineContent` 中都被跳过，且 ProseMirror `nodeFromJSON`
 * 拒绝空 text 节点；投影对空文本 run 视为无贡献，输出与真实模型一致。
 */

import type { DocxBlock, DocxDocumentModel } from '../../src/shared/docx';

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

export interface DocxSearchTextProjection {
  /** 完整规范投影文本。 */
  readonly text: string;
  /** 文本块段映射（深度优先顺序）。 */
  readonly blocks: readonly DocxSearchTextBlock[];
}

/** 深度优先收集文本块：列表块不产生文字，只递归其条目。 */
function collectBlocks(
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

/** 冻结投影（第 4.3 节全部规则；测试脚手架，WP1 移植为产品模块）。 */
export function projectDocxModelSearchText(model: DocxDocumentModel): DocxSearchTextProjection {
  const textBlocks = collectBlocks(model.blocks);
  const texts = textBlocks.map((block) => block.runs.map((run) => run.text).join(''));
  const text = texts.join('\n');
  const blocks: DocxSearchTextBlock[] = [];
  let offset = 0;
  for (let ordinal = 0; ordinal < texts.length; ordinal += 1) {
    const blockText = texts[ordinal]!;
    blocks.push({ ordinal, from: offset, to: offset + blockText.length, text: blockText });
    offset += blockText.length + 1; // 相邻块之间一个 `\n`
  }
  return { text, blocks };
}
