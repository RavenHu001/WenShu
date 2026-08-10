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
 * - 自编辑上报的模型用对象身份识别，不反向写回编辑器，以保留历史与光标；
 * - 外部模型替换（重读/保存成功更新基线）比较完整规范模型：语义一致时不触碰编辑器，
 *   文字或格式任一变化时替换内容（历史随替换清空，与 TXT 语义一致）；
 * - 编辑器实例经 `onEditorRegister` 注册，供工具栏操作与测试定位；
 * - `editable` 由标签状态派生（read-only / read-error 不可编辑）。
 *
 * ## 边界
 *
 * - 编辑器实例不跨 IPC；模型转换是纯函数（`docx-convert.ts`）；
 * - 不实现 Word 级 UI：工具栏只含第 4.1 节受支持格式（见 DocxToolbar）。
 */

import { useEffect, useRef } from 'react';
import { Editor, Extension, type Content } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TextStyle, FontSize } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { TextAlign } from '@tiptap/extension-text-align';
import { docxModelToTiptapJson, tiptapJsonToDocxModel } from '../../../shared/docx-convert';
import type { DocxDocumentModel } from '../../../shared/docx';
import type { DocxDocumentTabState } from '../../lib/document-tabs';

/** 最小扩展集（WP0 冻结结论 3）：StarterKit v3 已含下划线；link 输入能力关闭。 */
export const DOCX_EDITOR_EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
  TextStyle,
  Color,
  FontSize,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
];

/** 模型已在共享边界规范化且有序列化预算，完整比较可覆盖 mark/alignment 等格式变化。 */
function docxModelsEqual(left: DocxDocumentModel, right: DocxDocumentModel): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function DocxEditorSessionHost({
  tab,
  editable,
  onContentChange,
  onSaveRequest,
  onEditorRegister,
}: {
  readonly tab: DocxDocumentTabState;
  /** 是否可编辑（read-only / read-error 无快照时 false）。 */
  readonly editable: boolean;
  /** 内容实际变化（docChanged 事务）时上报新模型。 */
  readonly onContentChange: (tabId: string, model: DocxDocumentModel) => void;
  /** Ctrl+S 保存请求（与 TXT 编辑器宿主一致）。 */
  readonly onSaveRequest: (tabId: string) => void;
  /** 注册/注销编辑器实例（工具栏操作与测试定位）。 */
  readonly onEditorRegister: (tabId: string, editor: Editor | null) => void;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const locallyEmittedModelsRef = useRef(new WeakSet<DocxDocumentModel>());
  const applyingExternalModelRef = useRef(false);
  const contentChangeRef = useRef(onContentChange);
  const saveRequestRef = useRef(onSaveRequest);
  const registerRef = useRef(onEditorRegister);

  useEffect(() => {
    contentChangeRef.current = onContentChange;
    saveRequestRef.current = onSaveRequest;
    registerRef.current = onEditorRegister;
  });

  // 创建编辑器（只创建一次；模型变化经下方 effect 同步内容）
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const saveKeymap = Extension.create({
      name: 'wenshu-docx-save-keymap',
      addKeyboardShortcuts: () => ({
        'Mod-s': () => {
          saveRequestRef.current(tab.id);
          return true;
        },
      }),
    });
    const editor = new Editor({
      element: container,
      extensions: [...DOCX_EDITOR_EXTENSIONS, saveKeymap],
      content: docxModelToTiptapJson(
        tab.model ?? { schemaVersion: 1, blocks: [] },
      ) as unknown as Content,
      editable,
      onUpdate: ({ editor: current, transaction }) => {
        if (!transaction.docChanged || applyingExternalModelRef.current) {
          return;
        }
        const converted = tiptapJsonToDocxModel(current.getJSON());
        if (converted.status === 'ok') {
          locallyEmittedModelsRef.current.add(converted.model);
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

  // 自编辑模型由同一对象回写，直接跳过；保存回写等价模型也不触碰编辑器。
  // 重新读取的模型进行完整语义比较，确保纯格式变化同样能替换编辑器内容。
  useEffect(() => {
    const editor = editorRef.current;
    const incomingModel = tab.model;
    if (editor === null || incomingModel === null) {
      return;
    }
    if (locallyEmittedModelsRef.current.has(incomingModel)) {
      locallyEmittedModelsRef.current.delete(incomingModel);
      return;
    }
    const currentModel = tiptapJsonToDocxModel(editor.getJSON());
    if (currentModel.status === 'ok' && docxModelsEqual(incomingModel, currentModel.model)) {
      return;
    }
    applyingExternalModelRef.current = true;
    try {
      editor.commands.setContent(docxModelToTiptapJson(incomingModel) as unknown as Content, {
        emitUpdate: false,
      });
    } finally {
      applyingExternalModelRef.current = false;
    }
  }, [tab.model]);

  return <div ref={containerRef} className="docx-editor" aria-label={tab.name} />;
}
