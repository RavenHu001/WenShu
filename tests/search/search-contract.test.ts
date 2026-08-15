/**
 * TASK-006 WP1 共享契约与运行时校验测试（任务第 8.2 节）。
 * 覆盖：请求精确键、错误类型、多余字段、requestId、查询长度与非法字符；
 * 取消请求校验；固定上限常量。
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_CANDIDATE_FILES,
  MAX_DOCX_CANDIDATE_FILES,
  MAX_DOCX_READ_CONCURRENCY,
  MAX_FILE_READ_CONCURRENCY,
  MAX_MATCHES_PER_FILE,
  MAX_PREVIEW_LENGTH,
  MAX_QUERY_LENGTH,
  MAX_TOTAL_MATCHES,
  WORKSPACE_SEARCH_TRUNCATION_PRIORITY,
  isWorkspaceSearchDocumentKind,
  validateWorkspaceTextSearchCancelRequest,
  validateWorkspaceTextSearchRequest,
} from '../../src/shared/search';

describe('固定资源上限常量（第 4.5 节，WP0 冻结项 5；TASK-008 第 4.5 节）', () => {
  it('查询长度 256、候选文件 1000、单文件匹配 200、总匹配 2000、预览 160、并发 4', () => {
    expect(MAX_QUERY_LENGTH).toBe(256);
    expect(MAX_CANDIDATE_FILES).toBe(1000);
    expect(MAX_MATCHES_PER_FILE).toBe(200);
    expect(MAX_TOTAL_MATCHES).toBe(2000);
    expect(MAX_PREVIEW_LENGTH).toBe(160);
    expect(MAX_FILE_READ_CONCURRENCY).toBe(4);
  });

  it('TASK-008 新增：DOCX 候选 200、DOCX 并发 2（总并发 4 内的独立上限）', () => {
    expect(MAX_DOCX_CANDIDATE_FILES).toBe(200);
    expect(MAX_DOCX_READ_CONCURRENCY).toBe(2);
    expect(MAX_DOCX_CANDIDATE_FILES).toBeLessThan(MAX_CANDIDATE_FILES);
    expect(MAX_DOCX_READ_CONCURRENCY).toBeLessThanOrEqual(MAX_FILE_READ_CONCURRENCY);
  });
});

describe('搜索文件 kind 判别（TASK-008 第 4.6 节，第 8.4 节）', () => {
  it('isWorkspaceSearchDocumentKind 只接受 txt / docx', () => {
    expect(isWorkspaceSearchDocumentKind('txt')).toBe(true);
    expect(isWorkspaceSearchDocumentKind('docx')).toBe(true);
    for (const bad of ['md', 'TXT', 'DOCX', 'text', '', null, undefined, 0, 1, {}, ['txt']]) {
      expect(isWorkspaceSearchDocumentKind(bad), String(bad)).toBe(false);
    }
  });
});

describe('截断原因与优先级（TASK-008 第 4.5 节，第 8.4 节）', () => {
  it('截断原因包含新增的 docx-file-limit，且优先级固定为 file-limit > docx-file-limit > total-matches-limit > matches-per-file-limit', () => {
    expect(WORKSPACE_SEARCH_TRUNCATION_PRIORITY).toEqual([
      'file-limit',
      'docx-file-limit',
      'total-matches-limit',
      'matches-per-file-limit',
    ]);
    // 优先级数组去重且覆盖全部原因（运行时与类型契约一致）
    expect(new Set(WORKSPACE_SEARCH_TRUNCATION_PRIORITY).size).toBe(
      WORKSPACE_SEARCH_TRUNCATION_PRIORITY.length,
    );
  });
});

describe('搜索请求运行时校验（第 4.6/4.7 节）', () => {
  const validRequest = () => ({ requestId: 1, query: 'hello', caseSensitive: true });

  it('合法请求通过并返回冻结形状', () => {
    const result = validateWorkspaceTextSearchRequest(validRequest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request).toEqual({ requestId: 1, query: 'hello', caseSensitive: true });
    }
  });

  it('requestId 为 0 与最大安全整数均合法', () => {
    expect(validateWorkspaceTextSearchRequest({ ...validRequest(), requestId: 0 }).ok).toBe(true);
    expect(
      validateWorkspaceTextSearchRequest({ ...validRequest(), requestId: Number.MAX_SAFE_INTEGER })
        .ok,
    ).toBe(true);
  });

  it('非对象输入被拒绝：null、undefined、数组、字符串', () => {
    expect(validateWorkspaceTextSearchRequest(null).ok).toBe(false);
    expect(validateWorkspaceTextSearchRequest(undefined).ok).toBe(false);
    expect(validateWorkspaceTextSearchRequest([1, 'a', true]).ok).toBe(false);
    expect(validateWorkspaceTextSearchRequest('request').ok).toBe(false);
    expect(validateWorkspaceTextSearchRequest(42).ok).toBe(false);
  });

  it('多余字段被拒绝（根路径、绝对路径、上限、并发、通道等危险字段）', () => {
    const withRoot = { ...validRequest(), workspaceRoot: 'C:\\workspace' };
    const result = validateWorkspaceTextSearchRequest(withRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('EXTRA_FIELDS');
    }
    for (const extra of [
      'rootPath',
      'absolutePath',
      'glob',
      'maxFiles',
      'concurrency',
      'encoding',
      'channel',
      'strategy',
      // TASK-008 明确不在请求内的文件类型 / 解析 / 预算字段（第 4.6 / 7.2 节）
      'fileTypes',
      'includeDocx',
      'docxOnly',
      'maxDocxFiles',
      'parseOptions',
    ]) {
      expect(validateWorkspaceTextSearchRequest({ ...validRequest(), [extra]: 1 }).ok).toBe(false);
    }
  });

  it('requestId 类型错误被拒绝：字符串、浮点、负数、NaN、Infinity、非安全整数', () => {
    for (const bad of ['1', 1.5, -1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const result = validateWorkspaceTextSearchRequest({ ...validRequest(), requestId: bad });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('INVALID_REQUEST_ID');
      }
    }
  });

  it('query 非字符串被拒绝', () => {
    for (const bad of [null, 42, true, {}, ['a']]) {
      const result = validateWorkspaceTextSearchRequest({ ...validRequest(), query: bad });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('INVALID_QUERY_TYPE');
      }
    }
  });

  it('空查询被拒绝', () => {
    const result = validateWorkspaceTextSearchRequest({ ...validRequest(), query: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('EMPTY_QUERY');
    }
  });

  it('查询长度为 256 UTF-16 code unit 合法，257 被拒绝', () => {
    const ascii256 = 'a'.repeat(256);
    expect(validateWorkspaceTextSearchRequest({ ...validRequest(), query: ascii256 }).ok).toBe(
      true,
    );
    expect(
      validateWorkspaceTextSearchRequest({ ...validRequest(), query: 'a'.repeat(257) }).ok,
    ).toBe(false);
    // emoji 按 UTF-16 code unit 计长：128 个 emoji = 256 单元
    const emoji128 = '😀'.repeat(128);
    expect(validateWorkspaceTextSearchRequest({ ...validRequest(), query: emoji128 }).ok).toBe(
      true,
    );
    expect(
      validateWorkspaceTextSearchRequest({ ...validRequest(), query: '😀'.repeat(129) }).ok,
    ).toBe(false);
  });

  it('含换行或空字符的查询被拒绝（单行约束）', () => {
    const withLf = validateWorkspaceTextSearchRequest({ ...validRequest(), query: 'a\nb' });
    expect(withLf.ok).toBe(false);
    if (!withLf.ok) {
      expect(withLf.reason).toBe('QUERY_HAS_LINE_BREAK');
    }
    const withCr = validateWorkspaceTextSearchRequest({ ...validRequest(), query: 'a\rb' });
    expect(withCr.ok).toBe(false);
    if (!withCr.ok) {
      expect(withCr.reason).toBe('QUERY_HAS_LINE_BREAK');
    }
    const withNul = validateWorkspaceTextSearchRequest({ ...validRequest(), query: 'a\0b' });
    expect(withNul.ok).toBe(false);
    if (!withNul.ok) {
      expect(withNul.reason).toBe('QUERY_HAS_NUL');
    }
  });

  it('caseSensitive 非布尔被拒绝', () => {
    for (const bad of [null, 0, 1, 'true', undefined]) {
      const result = validateWorkspaceTextSearchRequest({ ...validRequest(), caseSensitive: bad });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('INVALID_CASE_SENSITIVE');
      }
    }
  });
});

describe('取消请求运行时校验（第 4.6 节）', () => {
  it('合法取消请求通过：只含 requestId', () => {
    const result = validateWorkspaceTextSearchCancelRequest({ requestId: 7 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request).toEqual({ requestId: 7 });
    }
  });

  it('多余字段被拒绝', () => {
    const result = validateWorkspaceTextSearchCancelRequest({ requestId: 7, query: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('EXTRA_FIELDS');
    }
  });

  it('requestId 非法或非对象被拒绝', () => {
    expect(validateWorkspaceTextSearchCancelRequest(null).ok).toBe(false);
    expect(validateWorkspaceTextSearchCancelRequest([]).ok).toBe(false);
    const badId = validateWorkspaceTextSearchCancelRequest({ requestId: '1' });
    expect(badId.ok).toBe(false);
    if (!badId.ok) {
      expect(badId.reason).toBe('INVALID_REQUEST_ID');
    }
  });
});
