/**
 * DOCX 基础格式工具栏 —— 只含第 4.1 节受支持格式（TASK-007 WP5，第 6.5 节）。
 *
 * - 粗体 / 斜体 / 下划线；段落与标题 1-3；
 * - 字号白名单（`DOCX_FONT_SIZE_WHITELIST`，冻结常量）；文字颜色（`#RRGGBB`）；
 * - 项目符号 / 编号列表；左/中/右/两端对齐；撤销 / 重做；
 * - 编辑器不可用（loading / read-only / read-error）时整条禁用；
 * - 不包含超出范围的功能（无字体选择、无复杂样式、无分页）。
 */

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';

/** 受支持字号白名单（磅值）；与导入/导出映射一致（导出为半磅 w:sz）。 */
export const DOCX_FONT_SIZE_WHITELIST = [9, 10.5, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72] as const;

/** 受支持对齐值（Tiptap 侧 justify 对应模型 both）。 */
const ALIGNMENTS = [
  { label: '左对齐', value: 'left' },
  { label: '居中', value: 'center' },
  { label: '右对齐', value: 'right' },
  { label: '两端对齐', value: 'justify' },
] as const;

export function DocxToolbar({
  editor,
  disabled,
}: {
  /** 活动标签的编辑器实例；不可用时为 null。 */
  readonly editor: Editor | null;
  /** 编辑器不可用（loading / read-only / read-error）时禁用整条工具栏。 */
  readonly disabled: boolean;
}): React.JSX.Element {
  // 订阅编辑器事务：选中/内容变化时刷新按钮激活状态
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (editor === null) {
      return;
    }
    const refresh = (): void => setVersion((v) => v + 1);
    editor.on('transaction', refresh);
    editor.on('selectionUpdate', refresh);
    return () => {
      editor.off('transaction', refresh);
      editor.off('selectionUpdate', refresh);
    };
  }, [editor]);

  const run = (fn: (editor: Editor) => void): void => {
    if (editor !== null && !disabled) {
      fn(editor);
    }
  };
  const active = (predicate: (editor: Editor) => boolean): boolean =>
    editor !== null && !disabled && predicate(editor);

  const toggleBtn = (
    label: string,
    isActive: (editor: Editor) => boolean,
    action: (editor: Editor) => void,
  ): React.JSX.Element => (
    <button
      type="button"
      className={`docx-tool-btn${active(isActive) ? ' is-active' : ''}`}
      disabled={disabled || editor === null}
      aria-pressed={active(isActive)}
      onClick={() => run(action)}
    >
      {label}
    </button>
  );

  const currentFontSize = (): string => {
    if (editor === null) {
      return '';
    }
    const attrs = editor.getAttributes('textStyle') as { fontSize?: string };
    return typeof attrs.fontSize === 'string' ? attrs.fontSize : '';
  };
  const currentColor = (): string => {
    if (editor === null) {
      return '#000000';
    }
    const attrs = editor.getAttributes('textStyle') as { color?: string };
    return typeof attrs.color === 'string' ? attrs.color : '#000000';
  };

  return (
    <div className="docx-toolbar" aria-label="DOCX 格式工具栏">
      {toggleBtn(
        '粗体',
        (e) => e.isActive('bold'),
        (e) => e.chain().focus().toggleBold().run(),
      )}
      {toggleBtn(
        '斜体',
        (e) => e.isActive('italic'),
        (e) => e.chain().focus().toggleItalic().run(),
      )}
      {toggleBtn(
        '下划线',
        (e) => e.isActive('underline'),
        (e) => e.chain().focus().toggleUnderline().run(),
      )}

      <select
        className="docx-tool-select"
        aria-label="段落样式"
        disabled={disabled || editor === null}
        value={
          editor !== null && editor.isActive('heading')
            ? String(editor.getAttributes('heading').level ?? 1)
            : 'paragraph'
        }
        onChange={(event) => {
          const value = event.target.value;
          run((e) => {
            const chain = e.chain().focus();
            if (value === 'paragraph') {
              chain.setParagraph().run();
            } else {
              chain.toggleHeading({ level: Number(value) as 1 | 2 | 3 }).run();
            }
          });
        }}
      >
        <option value="paragraph">正文</option>
        <option value="1">标题 1</option>
        <option value="2">标题 2</option>
        <option value="3">标题 3</option>
      </select>

      <select
        className="docx-tool-select"
        aria-label="字号"
        disabled={disabled || editor === null}
        value={currentFontSize()}
        onChange={(event) => {
          const value = event.target.value;
          run((e) => {
            if (value === '') {
              e.chain().focus().unsetFontSize().run();
            } else {
              e.chain().focus().setFontSize(value).run();
            }
          });
        }}
      >
        <option value="">默认字号</option>
        {DOCX_FONT_SIZE_WHITELIST.map((size) => (
          <option key={size} value={`${size}px`}>
            {size} pt
          </option>
        ))}
      </select>

      <label className="docx-tool-color">
        颜色
        <input
          type="color"
          aria-label="文字颜色"
          disabled={disabled || editor === null}
          value={currentColor()}
          onChange={(event) => {
            const value = event.target.value;
            run((e) => e.chain().focus().setColor(value).run());
          }}
        />
      </label>
      {toggleBtn(
        '清除颜色',
        () => false,
        (e) => e.chain().focus().unsetColor().run(),
      )}

      {toggleBtn(
        '项目符号',
        (e) => e.isActive('bulletList'),
        (e) => e.chain().focus().toggleBulletList().run(),
      )}
      {toggleBtn(
        '编号',
        (e) => e.isActive('orderedList'),
        (e) => e.chain().focus().toggleOrderedList().run(),
      )}

      <select
        className="docx-tool-select"
        aria-label="对齐方式"
        disabled={disabled || editor === null}
        value={
          editor !== null
            ? (editor.getAttributes('paragraph').textAlign as string) ||
              (editor.getAttributes('heading').textAlign as string) ||
              ''
            : ''
        }
        onChange={(event) => {
          const value = event.target.value;
          run((e) => e.chain().focus().setTextAlign(value).run());
        }}
      >
        <option value="">默认对齐</option>
        {ALIGNMENTS.map((alignment) => (
          <option key={alignment.value} value={alignment.value}>
            {alignment.label}
          </option>
        ))}
      </select>

      {toggleBtn(
        '撤销',
        () => false,
        (e) => e.chain().focus().undo().run(),
      )}
      {toggleBtn(
        '重做',
        () => false,
        (e) => e.chain().focus().redo().run(),
      )}
    </div>
  );
}
