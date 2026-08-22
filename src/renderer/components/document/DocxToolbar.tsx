import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { IconButton } from '../common/IconButton';
import { Icon, type IconName } from '../common/Icon';

export const DOCX_FONT_SIZE_WHITELIST = [9, 10.5, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72] as const;

const ALIGNMENTS = [
  { label: '左对齐', value: 'left' },
  { label: '居中', value: 'center' },
  { label: '右对齐', value: 'right' },
  { label: '两端对齐', value: 'justify' },
] as const;

const COMPACT_BREAKPOINT = 700;

export function DocxToolbar({
  editor,
  disabled,
}: {
  readonly editor: Editor | null;
  readonly disabled: boolean;
}): React.JSX.Element {
  const [, setVersion] = useState(0);
  const [compact, setCompact] = useState(false);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (editor === null) return;
    const refresh = (): void => setVersion((version) => version + 1);
    editor.on('transaction', refresh);
    editor.on('selectionUpdate', refresh);
    return () => {
      editor.off('transaction', refresh);
      editor.off('selectionUpdate', refresh);
    };
  }, [editor]);

  useLayoutEffect(() => {
    const element = toolbarRef.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setCompact(width < COMPACT_BREAKPOINT);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const unavailable = disabled || editor === null;
  const run = (action: (activeEditor: Editor) => void): void => {
    if (editor !== null && !disabled) action(editor);
  };
  const active = (predicate: (activeEditor: Editor) => boolean): boolean =>
    editor !== null && !disabled && predicate(editor);

  const toolButton = (
    label: string,
    icon: IconName,
    isActive: (activeEditor: Editor) => boolean,
    action: (activeEditor: Editor) => void,
  ): React.JSX.Element => (
    <IconButton
      aria-pressed={active(isActive)}
      className="docx-tool-btn"
      disabled={unavailable}
      icon={icon}
      key={label}
      label={label}
      onClick={() => run(action)}
      size="compact"
    />
  );

  const currentFontSize = (): string => {
    if (editor === null) return '';
    const attrs = editor.getAttributes('textStyle') as { fontSize?: string };
    return typeof attrs.fontSize === 'string' ? attrs.fontSize : '';
  };
  const currentColor = (): string => {
    if (editor === null) return '#000000';
    const attrs = editor.getAttributes('textStyle') as { color?: string };
    return typeof attrs.color === 'string' ? attrs.color : '#000000';
  };
  const currentAlignment = (): string => {
    if (editor === null) return '';
    return (
      (editor.getAttributes('paragraph').textAlign as string) ||
      (editor.getAttributes('heading').textAlign as string) ||
      ''
    );
  };

  const extras = (suffix: string): React.JSX.Element => (
    <>
      <div className="docx-tool-group" aria-label="字符外观">
        <select
          aria-label="字号"
          className="docx-tool-select"
          disabled={unavailable}
          onChange={(event) => {
            const value = event.target.value;
            run((activeEditor) => {
              if (value === '') activeEditor.chain().focus().unsetFontSize().run();
              else activeEditor.chain().focus().setFontSize(value).run();
            });
          }}
          value={currentFontSize()}
        >
          <option value="">默认字号</option>
          {DOCX_FONT_SIZE_WHITELIST.map((size) => (
            <option key={`${suffix}-${size}`} value={`${size}px`}>
              {size} pt
            </option>
          ))}
        </select>
        <label className="docx-tool-color" title={`文字颜色 ${currentColor()}`}>
          <span className="sr-only">文字颜色</span>
          <Icon name="palette" size={15} />
          <input
            aria-label="文字颜色"
            disabled={unavailable}
            onChange={(event) =>
              run((activeEditor) => activeEditor.chain().focus().setColor(event.target.value).run())
            }
            type="color"
            value={currentColor()}
          />
        </label>
        {toolButton(
          '清除颜色',
          'close',
          () => false,
          (activeEditor) => activeEditor.chain().focus().unsetColor().run(),
        )}
      </div>
      <div className="docx-tool-group" aria-label="列表">
        {toolButton(
          '项目符号',
          'list-bulleted',
          (activeEditor) => activeEditor.isActive('bulletList'),
          (activeEditor) => activeEditor.chain().focus().toggleBulletList().run(),
        )}
        {toolButton(
          '编号',
          'list-numbered',
          (activeEditor) => activeEditor.isActive('orderedList'),
          (activeEditor) => activeEditor.chain().focus().toggleOrderedList().run(),
        )}
      </div>
      <div className="docx-tool-group" aria-label="对齐">
        <select
          aria-label="对齐方式"
          className="docx-tool-select"
          disabled={unavailable}
          onChange={(event) =>
            run((activeEditor) =>
              activeEditor.chain().focus().setTextAlign(event.target.value).run(),
            )
          }
          value={currentAlignment()}
        >
          <option value="">默认对齐</option>
          {ALIGNMENTS.map((alignment) => (
            <option key={`${suffix}-${alignment.value}`} value={alignment.value}>
              {alignment.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );

  return (
    <div aria-label="DOCX 格式工具栏" className="docx-toolbar" ref={toolbarRef} role="toolbar">
      <div className="docx-tool-group" aria-label="历史">
        {toolButton(
          '撤销',
          'undo',
          () => false,
          (activeEditor) => activeEditor.chain().focus().undo().run(),
        )}
        {toolButton(
          '重做',
          'redo',
          () => false,
          (activeEditor) => activeEditor.chain().focus().redo().run(),
        )}
      </div>
      <div className="docx-tool-group" aria-label="字符格式">
        {toolButton(
          '粗体',
          'bold',
          (activeEditor) => activeEditor.isActive('bold'),
          (activeEditor) => activeEditor.chain().focus().toggleBold().run(),
        )}
        {toolButton(
          '斜体',
          'italic',
          (activeEditor) => activeEditor.isActive('italic'),
          (activeEditor) => activeEditor.chain().focus().toggleItalic().run(),
        )}
        {toolButton(
          '下划线',
          'underline',
          (activeEditor) => activeEditor.isActive('underline'),
          (activeEditor) => activeEditor.chain().focus().toggleUnderline().run(),
        )}
      </div>
      <div className="docx-tool-group docx-tool-group--style" aria-label="段落样式组">
        <select
          aria-label="段落样式"
          className="docx-tool-select"
          disabled={unavailable}
          onChange={(event) => {
            const value = event.target.value;
            run((activeEditor) => {
              const chain = activeEditor.chain().focus();
              if (value === 'paragraph') chain.setParagraph().run();
              else chain.toggleHeading({ level: Number(value) as 1 | 2 | 3 }).run();
            });
          }}
          value={
            editor !== null && editor.isActive('heading')
              ? String(editor.getAttributes('heading').level ?? 1)
              : 'paragraph'
          }
        >
          <option value="paragraph">正文</option>
          <option value="1">标题 1</option>
          <option value="2">标题 2</option>
          <option value="3">标题 3</option>
        </select>
      </div>
      <div className="docx-toolbar-extras" hidden={compact}>
        {extras('wide')}
      </div>
      <details className="docx-toolbar-overflow" hidden={!compact}>
        <summary aria-label="更多格式" title="更多格式">
          <Icon name="more" size={17} />
        </summary>
        <div className="docx-toolbar-overflow-panel">{extras('compact')}</div>
      </details>
    </div>
  );
}
