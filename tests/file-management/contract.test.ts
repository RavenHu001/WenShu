/**
 * TASK-009 WP2：文件管理共享契约测试（纯模块，node 环境）。
 * 覆盖：Windows 保留名/非法字符/尾随点空格/长度、ADS/绝对/UNC/盘符/路径穿越、
 * 目标与请求精确形状（多余字段拒绝）、稳定错误码与文案、路径纯函数、
 * 结果与错误的 structured clone。
 */

import { describe, expect, it } from 'vitest';
import {
  FILE_MANAGEMENT_ERROR_CODES,
  FILE_MANAGEMENT_ERROR_MESSAGES,
  fileManagementError,
  isCaseOnlyRename,
  isInternalWorkspaceName,
  isSameOrDescendantPath,
  pathsEqualInsensitive,
  validateCreateWorkspaceEntryRequest,
  validateRelocateWorkspaceEntryRequest,
  validateRevealWorkspaceEntryRequest,
  validateSaveDocxDocumentAsRequest,
  validateSaveTextDocumentAsRequest,
  validateTrashWorkspaceEntryRequest,
  validateWindowsLeafName,
  validateWorkspaceRelativePath,
  validateWorkspaceTargetName,
  type SaveAsResult,
  type WorkspaceMutationResult,
} from '../../src/shared/file-management';
import { DOCX_MODEL_SCHEMA_VERSION } from '../../src/shared/docx';

/* ======================= Windows 叶名称（§4.3 / WP0 冻结） ======================= */

describe('validateWindowsLeafName', () => {
  it('接受普通中英文/emoji/空格/点号名称', () => {
    expect(validateWindowsLeafName('a.txt')).toBe(true);
    expect(validateWindowsLeafName('A.TXT')).toBe(true);
    expect(validateWindowsLeafName('a b (1).txt')).toBe(true);
    expect(validateWindowsLeafName('中文文档.txt')).toBe(true);
    expect(validateWindowsLeafName('emoji🎉.txt')).toBe(true);
    expect(validateWindowsLeafName('com0.txt')).toBe(true); // 非保留 COM10 系
    expect(validateWindowsLeafName('LPT10.txt')).toBe(true);
    expect(validateWindowsLeafName('a.b.c.txt')).toBe(true);
  });

  it('拒绝空名、. 与 ..', () => {
    expect(validateWindowsLeafName('')).toBe(false);
    expect(validateWindowsLeafName('.')).toBe(false);
    expect(validateWindowsLeafName('..')).toBe(false);
    expect(validateWindowsLeafName(null)).toBe(false);
    expect(validateWindowsLeafName(42)).toBe(false);
  });

  it('拒绝 Windows 非法字符（含反斜杠）', () => {
    for (const ch of ['<', '>', ':', '"', '/', '\\', '|', '?', '*']) {
      expect(validateWindowsLeafName(`a${ch}b.txt`)).toBe(false);
    }
  });

  it('拒绝 NUL 与控制字符', () => {
    expect(validateWindowsLeafName('a\u0000b')).toBe(false);
    expect(validateWindowsLeafName('a\tb')).toBe(false);
    expect(validateWindowsLeafName('a\nb')).toBe(false);
    expect(validateWindowsLeafName('a\u001fb')).toBe(false);
  });

  it('拒绝尾随点/空格（WP0 实测：Node 可创建但 Win32 互操作歧义）', () => {
    expect(validateWindowsLeafName('a.')).toBe(false);
    expect(validateWindowsLeafName('a ')).toBe(false);
    expect(validateWindowsLeafName('trail.txt.')).toBe(false);
    expect(validateWindowsLeafName('trail.txt ')).toBe(false);
  });

  it('拒绝保留设备名及带扩展名形式（大小写不敏感）', () => {
    for (const name of [
      'CON',
      'con',
      'Con.txt',
      'PRN',
      'AUX',
      'NUL',
      'nul.txt',
      'COM1',
      'com9.txt',
      'LPT1',
      'lpt9.txt',
    ]) {
      expect(validateWindowsLeafName(name)).toBe(false);
    }
  });

  it('拒绝超过 255 code unit 的名称', () => {
    expect(validateWindowsLeafName('a'.repeat(255))).toBe(true);
    expect(validateWindowsLeafName('a'.repeat(256))).toBe(false);
  });
});

/* ======================= 相对路径与目标（§4.3） ======================= */

describe('validateWorkspaceRelativePath / validateWorkspaceTargetName', () => {
  it('接受根父目录空串与多级普通父目录', () => {
    expect(validateWorkspaceTargetName({ parentRelativePath: '', name: 'a.txt' })).toBe(true);
    expect(validateWorkspaceTargetName({ parentRelativePath: 'sub/dir', name: 'b.txt' })).toBe(
      true,
    );
  });

  it('拒绝绝对/盘符/UNC/ADS/反斜杠/穿越/空段', () => {
    for (const bad of [
      '/a',
      'a//b',
      'a/./b',
      'a/../b',
      'a\\b',
      'C:/x',
      'C:\\x',
      '\\server\\share',
      'a:b',
    ]) {
      expect(validateWorkspaceRelativePath(bad)).toBe(false);
    }
    expect(validateWorkspaceRelativePath('')).toBe(false);
    expect(validateWorkspaceRelativePath(null)).toBe(false);
    // 目标中的 ADS 由冒号非法字符层拒绝
    expect(validateWindowsLeafName('a.txt:stream')).toBe(false);
    expect(validateWorkspaceTargetName({ parentRelativePath: '', name: 'a.txt:stream' })).toBe(
      false,
    );
    expect(validateWorkspaceTargetName({ parentRelativePath: '../x', name: 'a.txt' })).toBe(false);
  });

  it('拒绝非法叶名称与错误类型', () => {
    expect(validateWorkspaceTargetName({ parentRelativePath: '', name: 'CON' })).toBe(false);
    expect(validateWorkspaceTargetName({ parentRelativePath: '', name: 'a.' })).toBe(false);
    expect(validateWorkspaceTargetName({ parentRelativePath: '', name: '' })).toBe(false);
    expect(validateWorkspaceTargetName({ parentRelativePath: '', name: 1 })).toBe(false);
    expect(validateWorkspaceTargetName(null)).toBe(false);
    expect(validateWorkspaceTargetName('a.txt')).toBe(false);
  });
});

/* ======================= 请求精确形状（拒绝多余字段，§4.2） ======================= */

describe('请求运行时校验', () => {
  it('create：合法请求通过；多余字段/危险开关/错误类型拒绝', () => {
    const valid = { mutationId: 1, kind: 'text' as const, parentRelativePath: '', name: 'a.txt' };
    expect(validateCreateWorkspaceEntryRequest(valid)).toBe(true);
    expect(validateCreateWorkspaceEntryRequest({ ...valid, force: true })).toBe(false);
    expect(validateCreateWorkspaceEntryRequest({ ...valid, overwrite: false })).toBe(false);
    expect(validateCreateWorkspaceEntryRequest({ ...valid, kind: 'directory' })).toBe(true);
    expect(validateCreateWorkspaceEntryRequest({ ...valid, kind: 'docx' })).toBe(true);
    expect(validateCreateWorkspaceEntryRequest({ ...valid, kind: 'file' })).toBe(false);
    expect(validateCreateWorkspaceEntryRequest({ ...valid, name: 'CON' })).toBe(false);
    expect(validateCreateWorkspaceEntryRequest({ ...valid, mutationId: 0 })).toBe(false);
    expect(validateCreateWorkspaceEntryRequest({ ...valid, mutationId: -1 })).toBe(false);
    expect(validateCreateWorkspaceEntryRequest({ ...valid, mutationId: 1.5 })).toBe(false);
    expect(validateCreateWorkspaceEntryRequest({ ...valid, mutationId: '1' })).toBe(false);
    expect(validateCreateWorkspaceEntryRequest({ ...valid, parentRelativePath: 'sub//x' })).toBe(
      false,
    );
  });

  it('relocate：源路径/目标/多余字段校验', () => {
    const valid = {
      mutationId: 2,
      sourceRelativePath: 'a.txt',
      parentRelativePath: 'sub',
      name: 'b.txt',
    };
    expect(validateRelocateWorkspaceEntryRequest(valid)).toBe(true);
    expect(validateRelocateWorkspaceEntryRequest({ ...valid, recursive: true })).toBe(false);
    expect(validateRelocateWorkspaceEntryRequest({ ...valid, sourceRelativePath: '' })).toBe(false);
    expect(
      validateRelocateWorkspaceEntryRequest({ ...valid, sourceRelativePath: 'a/../b.txt' }),
    ).toBe(false);
    expect(validateRelocateWorkspaceEntryRequest({ ...valid, name: 'b.' })).toBe(false);
    expect(validateRelocateWorkspaceEntryRequest({ ...valid, mutationId: undefined })).toBe(false);
  });

  it('trash：相对路径与多余字段', () => {
    expect(validateTrashWorkspaceEntryRequest({ mutationId: 3, relativePath: 'a.txt' })).toBe(true);
    expect(
      validateTrashWorkspaceEntryRequest({ mutationId: 3, relativePath: 'a.txt', force: true }),
    ).toBe(false);
    expect(validateTrashWorkspaceEntryRequest({ mutationId: 3, relativePath: '' })).toBe(false);
    expect(validateTrashWorkspaceEntryRequest({ mutationId: 3, relativePath: '/abs' })).toBe(false);
  });

  it('reveal：根判别值精确形状', () => {
    expect(validateRevealWorkspaceEntryRequest({ revealRoot: true })).toBe(true);
    expect(validateRevealWorkspaceEntryRequest({ revealRoot: false, relativePath: 'a.txt' })).toBe(
      true,
    );
    expect(validateRevealWorkspaceEntryRequest({ revealRoot: false })).toBe(false);
    expect(validateRevealWorkspaceEntryRequest({ revealRoot: true, relativePath: 'x' })).toBe(
      false,
    );
    expect(validateRevealWorkspaceEntryRequest({ revealRoot: 'yes' })).toBe(false);
    expect(validateRevealWorkspaceEntryRequest({ revealRoot: false, relativePath: '' })).toBe(
      false,
    );
  });

  it('save-as（TXT）：两阶段覆盖确认与多余字段', () => {
    const base = {
      mutationId: 4,
      tabId: 'tab-1',
      sourceRelativePath: 'a.txt',
      target: { parentRelativePath: 'sub', name: 'b.txt' },
      content: 'hello',
      expectedSourceRevision: 'r1',
    };
    expect(validateSaveTextDocumentAsRequest(base)).toBe(true);
    expect(
      validateSaveTextDocumentAsRequest({ ...base, expectedTargetRevision: 'target-r1' }),
    ).toBe(true);
    expect(
      validateSaveTextDocumentAsRequest({ ...base, confirmMixedLineEndingNormalization: true }),
    ).toBe(true);
    expect(
      validateSaveTextDocumentAsRequest({ ...base, confirmMixedLineEndingNormalization: false }),
    ).toBe(false);
    expect(validateSaveTextDocumentAsRequest({ ...base, force: true })).toBe(false);
    expect(validateSaveTextDocumentAsRequest({ ...base, tabId: '' })).toBe(false);
    expect(validateSaveTextDocumentAsRequest({ ...base, content: 1 })).toBe(false);
    expect(validateSaveTextDocumentAsRequest({ ...base, expectedTargetRevision: '' })).toBe(false);
    expect(
      validateSaveTextDocumentAsRequest({
        ...base,
        target: { parentRelativePath: '', name: 'CON' },
      }),
    ).toBe(false);
  });

  it('save-as（DOCX）：模型运行时校验与多余字段', () => {
    const model = {
      schemaVersion: DOCX_MODEL_SCHEMA_VERSION,
      blocks: [{ kind: 'paragraph' as const, alignment: null, runs: [] }],
    };
    const base = {
      mutationId: 5,
      tabId: 'tab-2',
      sourceRelativePath: 'a.docx',
      target: { parentRelativePath: '', name: 'b.docx' },
      model,
      expectedSourceRevision: 'r1',
    };
    expect(validateSaveDocxDocumentAsRequest(base)).toBe(true);
    expect(validateSaveDocxDocumentAsRequest({ ...base, skipBackup: true })).toBe(false);
    expect(
      validateSaveDocxDocumentAsRequest({
        ...base,
        model: { schemaVersion: 99, blocks: [] },
      }),
    ).toBe(false);
    expect(
      validateSaveDocxDocumentAsRequest({
        ...base,
        compatibilityConfirmationRevision: 'r1',
        expectedTargetRevision: 'tr',
      }),
    ).toBe(true);
  });
});

/* ======================= 稳定错误（§5.2） ======================= */

describe('稳定错误码与结构化克隆', () => {
  it('全部冻结错误码都有非空稳定文案', () => {
    for (const code of FILE_MANAGEMENT_ERROR_CODES) {
      const message = FILE_MANAGEMENT_ERROR_MESSAGES[code];
      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    }
    // §5.2 必须冻结的核心集合
    for (const required of [
      'NO_WORKSPACE',
      'INVALID_REQUEST',
      'INVALID_PATH',
      'INVALID_NAME',
      'OUTSIDE_WORKSPACE',
      'NOT_FOUND',
      'NOT_FILE',
      'NOT_DIRECTORY',
      'LINK_NOT_ALLOWED',
      'ROOT_OPERATION_NOT_ALLOWED',
      'TARGET_EXISTS',
      'CONFLICT',
      'DIRECTORY_INTO_DESCENDANT',
      'TYPE_CHANGE_NOT_ALLOWED',
      'COMPATIBILITY_CONFIRMATION_REQUIRED',
      'BACKUP_FAILED',
      'VERIFICATION_FAILED',
      'ACCESS_DENIED',
      'WRITE_FAILED',
      'TRASH_FAILED',
      'REVEAL_FAILED',
      'PARTIAL_FAILURE',
    ]) {
      expect(FILE_MANAGEMENT_ERROR_CODES).toContain(required);
    }
  });

  it('fileManagementError 是纯数据：无函数/原型泄漏，可 JSON 与 structuredClone 往返', () => {
    const err = fileManagementError('TARGET_EXISTS');
    expect(Object.getPrototypeOf(err)).toBe(Object.prototype);
    expect(Object.keys(err).sort()).toEqual(['code', 'message']);
    const cloned = structuredClone(err);
    expect(cloned).toEqual(err);
    expect(JSON.parse(JSON.stringify(err))).toEqual(err);
  });

  it('请求/结果模型可 structured clone（无 Error/句柄/函数）', () => {
    const mutation: WorkspaceMutationResult = {
      status: 'succeeded',
      mutationId: 7,
      relativePath: 'sub/a.txt',
      kind: 'text',
    };
    expect(structuredClone(mutation)).toEqual(mutation);
    expect(JSON.parse(JSON.stringify(mutation))).toEqual(mutation);

    const saveAs: SaveAsResult = {
      status: 'target-exists',
      mutationId: 8,
      targetRevision: 'abc123',
    };
    expect(structuredClone(saveAs)).toEqual(saveAs);
  });
});

/* ======================= 路径纯函数（§4.8 / §6.2） ======================= */

describe('路径纯函数', () => {
  it('isSameOrDescendantPath：段边界不误命中', () => {
    expect(isSameOrDescendantPath('a', 'a')).toBe(true);
    expect(isSameOrDescendantPath('a', 'a/b')).toBe(true);
    expect(isSameOrDescendantPath('a/b', 'a/b/c.txt')).toBe(true);
    expect(isSameOrDescendantPath('a', 'a2')).toBe(false);
    expect(isSameOrDescendantPath('a/b', 'a/b2.txt')).toBe(false);
    expect(isSameOrDescendantPath('a/b', 'a.txt')).toBe(false);
    expect(isSameOrDescendantPath('a/b', 'ab/c')).toBe(false);
  });

  it('pathsEqualInsensitive / isCaseOnlyRename', () => {
    expect(pathsEqualInsensitive('a.txt', 'A.TXT')).toBe(true);
    expect(pathsEqualInsensitive('sub/a.txt', 'SUB/A.TXT')).toBe(true);
    expect(pathsEqualInsensitive('a.txt', 'b.txt')).toBe(false);
    expect(isCaseOnlyRename('a.txt', 'A.txt')).toBe(true);
    expect(isCaseOnlyRename('sub/a.txt', 'SUB/a.txt')).toBe(true);
    expect(isCaseOnlyRename('a.txt', 'a.txt')).toBe(false);
    expect(isCaseOnlyRename('a.txt', 'b.txt')).toBe(false);
  });

  it('isInternalWorkspaceName：.wenshu.bak 与 .wenshu-*（大小写不敏感）', () => {
    expect(isInternalWorkspaceName('.wenshu.bak')).toBe(true);
    expect(isInternalWorkspaceName('a.docx.wenshu.bak')).toBe(true);
    expect(isInternalWorkspaceName('A.DOCX.WENSHU.BAK')).toBe(true);
    expect(isInternalWorkspaceName('.wenshu-abc.tmp')).toBe(true);
    expect(isInternalWorkspaceName('.WENSHU-X.TMP')).toBe(true);
    expect(isInternalWorkspaceName('a.wenshu-xyz')).toBe(false);
    expect(isInternalWorkspaceName('a.wenshu-bak')).toBe(false);
    expect(isInternalWorkspaceName('a.txt')).toBe(false);
  });
});
