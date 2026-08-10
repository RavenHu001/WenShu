/**
 * DOCX 富文本编辑器宿主 —— 每标签 Tiptap/ProseMirror 会话（TASK-007 WP5，第 4.6 / 6.5 节）。
 *
 * ## 会话与内容同步
 *
 * - 每个 DOCX 标签一个 Tiptap Editor 实例；DocumentPane 保持全部 DOCX 宿主挂载
 *   （非活动标签以 `hidden` 隐藏），切换标签不销毁会话，选择/滚动/撤销历史天然隔离；
 * - 宿主挂载时以 `docxModelToTiptapJson(tab.model)` 创建编辑器内容；
 * - 编辑器内容变化（`transaction.docChanged` 为真）经 `tiptapJsonToDocxModel`
 *   转换为项目模型上报（无变化事务不上报，不制造 dirty）；
 * - 外部模型替换（重读/保存成功更新基线）以"正文文本是否一致"判定：
 *   文本一致（自编辑或保存后回写）不触碰编辑器，保留历史与光标；
 *   文本不一致（重新读取）才替换内容（历史随替换清空，与 TXT 语义一致）；
 * - 编辑器实例经 `onEditorRegister` 注册，供工具栏操作与测试定位；
 * - `editable` 由标签状态派生（read-only / read-error 不可编辑）。
 *
 * ## 边界
 *
 * - 编辑器实例不跨 IPC；模型转换是纯函数（`docx-convert.ts`）；
 * - 不实现 Word 级 UI：工具栏只含第 4.1 节受支持格式（见 DocxToolbar）。
 */

import { useEffect, useRef } from 'react';
import { Editor, type Content } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TextStyle, FontSize } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { TextAlign } from '@tiptap/extension-text-align';
import { docxModelToTiptapJson, tiptapJsonToDocxModel } from '../../../shared/docx-convert';
import type { DocxBlock, DocxDocumentModel } from '../../../shared/docx';
import type { DocxDocumentTabState } from '../../lib/document-tabs';

/** 最小扩展集（WP0 冻结结论 3）：StarterKit v3 已含下划线；link 输入能力关闭。 */
export const DOCX_EDITOR_EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
  TextStyle,
  Color,
  FontSize,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
];

/** 模型正文文本（块级以换行连接），用于"外部替换 vs 自编辑"判定。 */
export function docxModelText(model: DocxDocumentModel): string {
  const parts: string[] = [];
  const walk = (blocks: readonly DocxBlock[]): void => {
    for (const block of blocks) {
      if (block.kind === 'paragraph' || block.kind === 'heading') {
        parts.push(block.runs.map((run) => run.text).join(''));
      } else {
        walk(block.blocks);
      }
    }
  };
  walk(model.blocks);
  return parts.join('\n');
}

export function DocxEditorSessionHost({
  tab,
  editable,
  onContentChange,
  onEditorRegister,
}: {
  readonly tab: DocxDocumentTabState;
  /** 是否可编辑（read-only / read-error 无快照时 false）。 */
  readonly editable: boolean;
  /** 内容实际变化（docChanged 事务）时上报新模型。 */
  readonly onContentChange: (tabId: string, model: DocxDocumentModel) => void;
  /** 注册/注销编辑器实例（工具栏操作与测试定位）。 */
  readonly onEditorRegister: (tabId: string, editor: Editor | null) => void;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const contentChangeRef = useRef(onContentChange);
  const registerRef = useRef(onEditorRegister);

  useEffect(() => {
    contentChangeRef.current = onContentChange;
    registerRef.current = onEditorRegister;
  });

  // 创建编辑器（只创建一次；模型变化经下方 effect 同步内容）
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const editor = new Editor({
      element: container,
      extensions: DOCX_EDITOR_EXTENSIONS,
      content: docxModelToTiptapJson(
        tab.model ?? { schemaVersion: 1, blocks: [] },
      ) as unknown as Content,
      editable,
      onUpdate: ({ editor: current, transaction }) => {
        if (!transaction.docChanged) {
          return;
        }
        const converted = tiptapJsonToDocxModel(current.getJSON());
        if (converted.status === 'ok') {
          contentChangeRef.current(tab.id, converted.model);
        }
      },
    });
    editorRef.current = editor;
    onEditorRegister(tab.id, editor);
    // 测试/调试访问点：编辑器实例挂在容器 DOM 上（不进入 React 状态、IPC 或持久化）
    (container as HTMLElement & { __wenshuEditor?: Editor }).__wenshuEditor = editor;
    return () => {
      if (editorRef.current === editor) {
        onEditorRegister(tab.id, null);
        editorRef.current = null;
      }
      delete (container as HTMLElement & { __wenshuEditor?: Editor }).__wenshuEditor;
      editor.destroy();
    };
  }, [tab.id]);

  // editable 变化同步到编辑器
  useEffect(() => {
    editorRef.current?.setEditable(editable);
  }, [editable]);

  // 外部模型替换（重读/保存回写基线）：与编辑器当前正文文本不一致才替换内容，
  // 一致（自编辑或保存后回写）不触碰编辑器，保留历史与光标
  useEffect(() => {
    const editor = editorRef.current;
    const incomingModel = tab.model;
    if (editor === null || incomingModel === null) {
      return;
    }
    const incomingText = docxModelText(incomingModel);
    if (incomingText === editor.getText({ blockSeparator: '\n' })) {
      return;
    }
    editor.commands.setContent(docxModelToTiptapJson(incomingModel) as unknown as Content);
  }, [tab.model]);

  return <div ref={containerRef} className="docx-editor" aria-label={tab.name} />;
}
