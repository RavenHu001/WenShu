/**
 * TASK-006 WP1 字面量匹配器测试（任务第 8.2 节）。
 * 覆盖：空查询、无匹配、单/多匹配与不重叠规则；大小写敏感与不敏感；
 * 中文、emoji、组合字符、CRLF/LF/独立 CR、空行与超长行；
 * 行列、全文范围、preview 范围与实际匹配文本一致；
 * 单文件 200 与总计 2000 上限及截断原因；结果排序与分组。
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_MATCHES_PER_FILE,
  MAX_PREVIEW_LENGTH,
  MAX_TOTAL_MATCHES,
  type WorkspaceTextSearchFileResult,
} from '../../src/shared/search';
import {
  compareRelativePaths,
  groupMatchedFileResults,
  matchText,
  sortMatchedFileResults,
} from '../../src/main/search/match-text';

function fileResult(
  relativePath: string,
  matches: WorkspaceTextSearchFileResult['matches'],
  truncated = false,
): WorkspaceTextSearchFileResult {
  return { relativePath, revision: `rev-${relativePath}`, matches, truncated };
}

describe('基础匹配（第 4.4 节）', () => {
  it('空查询防御性返回空结果', () => {
    const outcome = matchText('hello', '', { caseSensitive: true });
    expect(outcome.matches).toEqual([]);
    expect(outcome.truncated).toBe(false);
  });

  it('无匹配返回空结果，不误报截断', () => {
    const outcome = matchText('hello world', 'xyz', { caseSensitive: true });
    expect(outcome.matches).toEqual([]);
    expect(outcome.truncated).toBe(false);
  });

  it('查询长于正文时无匹配', () => {
    const outcome = matchText('ab', 'abc', { caseSensitive: true });
    expect(outcome.matches).toEqual([]);
  });

  it('单匹配：全文范围、1-based 行列与匹配文本一致', () => {
    const outcome = matchText('hello world', 'world', { caseSensitive: true });
    expect(outcome.matches).toHaveLength(1);
    const match = outcome.matches[0]!;
    expect(match.from).toBe(6);
    expect(match.to).toBe(11);
    expect(match.line).toBe(1);
    expect(match.column).toBe(7);
    expect(match.matchedText).toBe('world');
  });

  it('多匹配：按 from 升序且不重叠（重叠查询从匹配结束位置继续）', () => {
    const outcome = matchText('aaaa', 'aa', { caseSensitive: true });
    expect(outcome.matches.map((m) => [m.from, m.to])).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(outcome.matches[0]!.column).toBe(1);
    expect(outcome.matches[1]!.column).toBe(3);
  });

  it('同一匹配位置只产生一次匹配', () => {
    const outcome = matchText('abcabc', 'abc', { caseSensitive: true });
    expect(outcome.matches.map((m) => [m.from, m.to])).toEqual([
      [0, 3],
      [3, 6],
    ]);
  });
});

describe('大小写敏感与不敏感（第 4.4 节与 WP0 冻结项 3）', () => {
  it('大小写敏感：大小写不同的文本不匹配', () => {
    const outcome = matchText('Hello HELLO', 'hello', { caseSensitive: true });
    expect(outcome.matches).toEqual([]);
    const exact = matchText('Hello HELLO', 'HELLO', { caseSensitive: true });
    expect(exact.matches).toHaveLength(1);
    expect(exact.matches[0]!.from).toBe(6);
  });

  it('大小写不敏感：只折叠 ASCII 字母，返回原正文实际范围与文本', () => {
    const outcome = matchText('Hello HELLO hello', 'hello', { caseSensitive: false });
    expect(outcome.matches.map((m) => m.matchedText)).toEqual(['Hello', 'HELLO', 'hello']);
    expect(outcome.matches.map((m) => [m.from, m.to])).toEqual([
      [0, 5],
      [6, 11],
      [12, 17],
    ]);
    expect(outcome.matches[0]!.matchedText).toBe('Hello');
  });

  it('大小写不敏感不折叠非 ASCII 字符：é 不匹配 É', () => {
    const outcome = matchText('É', 'é', { caseSensitive: false });
    expect(outcome.matches).toEqual([]);
  });

  it('大小写不敏感不产生正则 i 标志的意外匹配：K 不匹配 Kelvin 符号', () => {
    const outcome = matchText('\u212a', 'K', { caseSensitive: false });
    expect(outcome.matches).toEqual([]);
  });

  it('大小写不敏感匹配不改变偏移（折叠不影响 UTF-16 长度）', () => {
    const content = 'a😀Ab';
    const outcome = matchText(content, 'a', { caseSensitive: false });
    expect(outcome.matches.map((m) => [m.from, m.to])).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });
});

describe('中文、emoji 与组合字符（第 8.2 节）', () => {
  it('中文匹配：UTF-16 范围、行列正确', () => {
    const outcome = matchText('你好世界', '世界', { caseSensitive: true });
    expect(outcome.matches).toHaveLength(1);
    const match = outcome.matches[0]!;
    expect([match.from, match.to]).toEqual([2, 4]);
    expect(match.column).toBe(3);
    expect(match.matchedText).toBe('世界');
  });

  it('emoji 按 UTF-16 code unit 计偏移（代理对）', () => {
    const outcome = matchText('a😀b', '😀', { caseSensitive: true });
    expect(outcome.matches).toHaveLength(1);
    const match = outcome.matches[0]!;
    expect([match.from, match.to]).toEqual([1, 3]);
    expect(match.column).toBe(2);
    expect(match.matchedText).toBe('😀');
  });

  it('连续 emoji 不重叠匹配', () => {
    const outcome = matchText('😀😀', '😀', { caseSensitive: true });
    expect(outcome.matches.map((m) => [m.from, m.to])).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it('组合字符按 code unit 匹配', () => {
    const content = 'e\u0301';
    const outcome = matchText(content, 'e', { caseSensitive: true });
    expect(outcome.matches).toHaveLength(1);
    expect([outcome.matches[0]!.from, outcome.matches[0]!.to]).toEqual([0, 1]);
  });
});

describe('换行边界与行列（第 4.4 节，CRLF 视为一个边界）', () => {
  it('LF 行号正确，CRLF 只计一次换行边界', () => {
    const lf = matchText('a\nb', 'b', { caseSensitive: true });
    expect(lf.matches[0]!.line).toBe(2);
    expect(lf.matches[0]!.column).toBe(1);
    const crlf = matchText('a\r\nb', 'b', { caseSensitive: true });
    expect(crlf.matches[0]!.line).toBe(2);
    expect(crlf.matches[0]!.column).toBe(1);
  });

  it('独立 CR 也视为换行边界', () => {
    const outcome = matchText('a\rb', 'b', { caseSensitive: true });
    expect(outcome.matches[0]!.line).toBe(2);
    expect(outcome.matches[0]!.column).toBe(1);
  });

  it('CRLF 后同一行内的列号从 1 开始', () => {
    const outcome = matchText('a\r\nxy', 'y', { caseSensitive: true });
    expect(outcome.matches[0]!.line).toBe(2);
    expect(outcome.matches[0]!.column).toBe(2);
  });

  it('空行计入行号', () => {
    const outcome = matchText('a\n\nb', 'b', { caseSensitive: true });
    expect(outcome.matches[0]!.line).toBe(3);
  });

  it('尾随换行产生的空行不可匹配', () => {
    const outcome = matchText('a\n', 'a', { caseSensitive: true });
    expect(outcome.matches).toHaveLength(1);
    expect(outcome.matches[0]!.line).toBe(1);
  });

  it('匹配不出现在换行符上（查询不含换行）', () => {
    const outcome = matchText('a\r\nb\nc\rd', 'b', { caseSensitive: true });
    expect(outcome.matches).toHaveLength(1);
    expect(outcome.matches[0]!.line).toBe(2);
  });
});

describe('预览片段（第 4.4/4.5 节与 WP0 冻结项 4）', () => {
  it('短行取整行作为预览，不含换行符，范围以 preview 为基准', () => {
    const outcome = matchText('hello world', 'world', { caseSensitive: true });
    const match = outcome.matches[0]!;
    expect(match.preview).toBe('hello world');
    expect([match.previewMatchFrom, match.previewMatchTo]).toEqual([6, 11]);
    expect(match.preview).toHaveLength(11);
  });

  it('超长行：窗口尽量让匹配居中，preview 长度固定 160', () => {
    const content = 'a'.repeat(100) + 'XYZ' + 'b'.repeat(197);
    const outcome = matchText(content, 'XYZ', { caseSensitive: true });
    const match = outcome.matches[0]!;
    expect(match.from).toBe(100);
    expect(match.preview).toHaveLength(MAX_PREVIEW_LENGTH);
    expect(match.previewMatchFrom).toBe(80);
    expect(match.previewMatchTo).toBe(83);
    expect(match.preview.slice(match.previewMatchFrom, match.previewMatchTo)).toBe('XYZ');
    // 权威范围始终是全文 from/to
    expect(content.slice(match.from, match.to)).toBe(match.matchedText);
  });

  it('超长行：匹配在行首时窗口从行首开始', () => {
    const content = 'XYZ' + 'a'.repeat(300);
    const outcome = matchText(content, 'XYZ', { caseSensitive: true });
    const match = outcome.matches[0]!;
    expect(match.preview).toHaveLength(MAX_PREVIEW_LENGTH);
    expect([match.previewMatchFrom, match.previewMatchTo]).toEqual([0, 3]);
  });

  it('超长行：匹配在行尾时窗口贴着行尾', () => {
    const content = 'a'.repeat(300) + 'XYZ';
    const outcome = matchText(content, 'XYZ', { caseSensitive: true });
    const match = outcome.matches[0]!;
    expect(match.preview).toHaveLength(MAX_PREVIEW_LENGTH);
    expect([match.previewMatchFrom, match.previewMatchTo]).toEqual([157, 160]);
  });

  it('查询长于预览时 preview 范围被截断，匹配文本仍完整', () => {
    const query = 'x'.repeat(200);
    const content = 'a'.repeat(50) + query;
    const outcome = matchText(content, query, { caseSensitive: true });
    const match = outcome.matches[0]!;
    expect(match.matchedText).toHaveLength(200);
    expect(match.preview).toHaveLength(MAX_PREVIEW_LENGTH);
    expect(match.previewMatchTo).toBe(160);
    expect(match.previewMatchFrom).toBe(50);
  });
});

describe('单文件匹配上限（第 4.5 节，200）', () => {
  it('恰好 200 个匹配且正文结束：不截断', () => {
    const outcome = matchText('ab'.repeat(200), 'ab', { caseSensitive: true });
    expect(outcome.matches).toHaveLength(MAX_MATCHES_PER_FILE);
    expect(outcome.truncated).toBe(false);
  });

  it('存在第 201 个匹配：保留 200 个并报告截断', () => {
    const outcome = matchText('ab'.repeat(201), 'ab', { caseSensitive: true });
    expect(outcome.matches).toHaveLength(MAX_MATCHES_PER_FILE);
    expect(outcome.truncated).toBe(true);
  });

  it('200 个匹配后剩余内容短于查询：不截断', () => {
    const outcome = matchText('ab'.repeat(200) + 'x', 'ab', { caseSensitive: true });
    expect(outcome.matches).toHaveLength(MAX_MATCHES_PER_FILE);
    expect(outcome.truncated).toBe(false);
  });

  it('自定义单文件上限生效', () => {
    const outcome = matchText('aaa', 'a', { caseSensitive: true, maxMatchesPerFile: 2 });
    expect(outcome.matches).toHaveLength(2);
    expect(outcome.truncated).toBe(true);
  });
});

describe('总匹配预算与分组（第 4.5 节，2000）', () => {
  it('恰好 2000 个匹配：不截断', () => {
    const files = Array.from({ length: 10 }, (_, i) =>
      fileResult(
        `f${i}.txt`,
        Array.from({ length: 200 }, (_, j) => ({
          from: j,
          to: j + 1,
          line: 1,
          column: j + 1,
          matchedText: 'a',
          preview: 'a',
          previewMatchFrom: 0,
          previewMatchTo: 1,
        })),
      ),
    );
    const grouped = groupMatchedFileResults(files);
    expect(grouped.files).toHaveLength(10);
    expect(grouped.totalMatches).toBe(MAX_TOTAL_MATCHES);
    expect(grouped.matchedFiles).toBe(10);
    expect(grouped.truncated).toBe(false);
    expect(grouped.truncatedReason).toBeNull();
  });

  it('超过 2000：后续文件整体丢弃并报告 total-matches-limit', () => {
    const oneFile = (path: string) =>
      fileResult(
        path,
        Array.from({ length: 200 }, (_, j) => ({
          from: j,
          to: j + 1,
          line: 1,
          column: j + 1,
          matchedText: 'a',
          preview: 'a',
          previewMatchFrom: 0,
          previewMatchTo: 1,
        })),
      );
    const files = Array.from({ length: 11 }, (_, i) => oneFile(`f${i}.txt`));
    const grouped = groupMatchedFileResults(files);
    expect(grouped.files).toHaveLength(10);
    expect(grouped.totalMatches).toBe(MAX_TOTAL_MATCHES);
    expect(grouped.matchedFiles).toBe(10);
    expect(grouped.truncated).toBe(true);
    expect(grouped.truncatedReason).toBe('total-matches-limit');
  });

  it('总预算在文件中间截断：当前文件按剩余预算截断并标记 truncated', () => {
    const matches = (n: number) =>
      Array.from({ length: n }, (_, j) => ({
        from: j,
        to: j + 1,
        line: 1,
        column: j + 1,
        matchedText: 'a',
        preview: 'a',
        previewMatchFrom: 0,
        previewMatchTo: 1,
      }));
    const grouped = groupMatchedFileResults(
      [fileResult('a.txt', matches(200)), fileResult('b.txt', matches(200))],
      { maxTotalMatches: 350 },
    );
    expect(grouped.files).toHaveLength(2);
    expect(grouped.files[0]!.matches).toHaveLength(200);
    expect(grouped.files[1]!.matches).toHaveLength(150);
    expect(grouped.files[1]!.truncated).toBe(true);
    expect(grouped.totalMatches).toBe(350);
    expect(grouped.truncated).toBe(true);
    expect(grouped.truncatedReason).toBe('total-matches-limit');
  });

  it('单文件截断保留 matches-per-file-limit 原因', () => {
    const oneMatch = (j: number) => ({
      from: j,
      to: j + 1,
      line: 1,
      column: j + 1,
      matchedText: 'a',
      preview: 'a',
      previewMatchFrom: 0,
      previewMatchTo: 1,
    });
    const grouped = groupMatchedFileResults([
      fileResult(
        'a.txt',
        Array.from({ length: 5 }, (_, j) => oneMatch(j)),
        true,
      ),
      fileResult('b.txt', [oneMatch(0)]),
    ]);
    expect(grouped.truncated).toBe(true);
    expect(grouped.truncatedReason).toBe('matches-per-file-limit');
    expect(grouped.totalMatches).toBe(6);
  });

  it('空匹配分组被剔除，matchedFiles 与实际分组一致', () => {
    const oneMatch = {
      from: 0,
      to: 1,
      line: 1,
      column: 1,
      matchedText: 'a',
      preview: 'a',
      previewMatchFrom: 0,
      previewMatchTo: 1,
    };
    const grouped = groupMatchedFileResults([
      fileResult('empty.txt', []),
      fileResult('hit.txt', [oneMatch]),
    ]);
    expect(grouped.files.map((f) => f.relativePath)).toEqual(['hit.txt']);
    expect(grouped.matchedFiles).toBe(1);
    expect(grouped.totalMatches).toBe(1);
  });
});

describe('文件分组排序（第 4.4 节与 WP0 冻结项 9）', () => {
  it('相对路径自然排序：数字感知、大小写不敏感', () => {
    expect(compareRelativePaths('a2.txt', 'a10.txt')).toBeLessThan(0);
    expect(compareRelativePaths('a.txt', 'b.txt')).toBeLessThan(0);
    expect(compareRelativePaths('dir/a.txt', 'dir2/a.txt')).toBeLessThan(0);
  });

  it('排序结果与输入顺序无关（并发完成顺序不改变最终排序）', () => {
    const oneMatch = {
      from: 0,
      to: 1,
      line: 1,
      column: 1,
      matchedText: 'a',
      preview: 'a',
      previewMatchFrom: 0,
      previewMatchTo: 1,
    };
    const paths = ['b.txt', 'a10.txt', 'a2.txt', 'a.txt'];
    const shuffled: string[][] = [
      ['b.txt', 'a10.txt', 'a2.txt', 'a.txt'],
      ['a.txt', 'a2.txt', 'a10.txt', 'b.txt'],
      ['a10.txt', 'b.txt', 'a.txt', 'a2.txt'],
    ];
    for (const order of shuffled) {
      const sorted = sortMatchedFileResults(order.map((p) => fileResult(p, [oneMatch])));
      expect(sorted.map((f) => f.relativePath)).toEqual(['a.txt', 'a2.txt', 'a10.txt', 'b.txt']);
    }
    expect(paths).toEqual(['b.txt', 'a10.txt', 'a2.txt', 'a.txt']);
  });

  it('排序不修改原数组', () => {
    const oneMatch = {
      from: 0,
      to: 1,
      line: 1,
      column: 1,
      matchedText: 'a',
      preview: 'a',
      previewMatchFrom: 0,
      previewMatchTo: 1,
    };
    const input = [fileResult('b.txt', [oneMatch]), fileResult('a.txt', [oneMatch])];
    const sorted = sortMatchedFileResults(input);
    expect(sorted.map((f) => f.relativePath)).toEqual(['a.txt', 'b.txt']);
    expect(input.map((f) => f.relativePath)).toEqual(['b.txt', 'a.txt']);
  });
});

describe('匹配结果确定性（第 5.2 节不变量 6）', () => {
  it('同一正文与查询重复匹配结果完全一致', () => {
    const content = 'Hello\nworld\r\nhello 你好 😀\n';
    const first = matchText(content, 'hello', { caseSensitive: false });
    const second = matchText(content, 'hello', { caseSensitive: false });
    expect(second.matches).toEqual(first.matches);
    expect(first.matches.map((m) => [m.line, m.column])).toEqual([
      [1, 1],
      [3, 1],
    ]);
  });
});
