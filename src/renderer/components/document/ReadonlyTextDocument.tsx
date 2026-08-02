/**
 * 只读 TXT 正文展示 —— 明确只读的 textarea。
 *
 * - 保留换行和空白；
 * - 支持浏览器原生选择与复制；
 * - 不使用 contentEditable 模拟只读；
 * - 不把正文注入 innerHTML；
 * - 空文件仍显示已打开的标签和空正文区域。
 */
export function ReadonlyTextDocument({
  name,
  content,
}: {
  readonly name: string;
  readonly content: string;
}): React.JSX.Element {
  return (
    <div className="doc-readonly">
      <textarea
        className="doc-readonly-text"
        readOnly
        value={content}
        aria-label={name}
        spellCheck={false}
      />
    </div>
  );
}
