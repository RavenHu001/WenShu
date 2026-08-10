/**
 * 同目录安全写入内部 helper —— TXT 与 DOCX 保存共用（TASK-007 WP3 提取）。
 *
 * 只被主进程 document / docx 模块导入，不暴露给 preload 或 renderer。
 * 提供排他临时文件创建、完整写入（循环处理短写）、刷盘、关闭、同文件系统替换
 * 与尽力清理原语；语义与既有 TXT 保存器逐字一致。
 */

import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { open, rename, rm } from 'node:fs/promises';

/** `FileHandle.write` 的最小写入契约，便于确定性测试短写。 */
export interface WritableFileHandle {
  readonly write: (
    buffer: Uint8Array,
    offset: number,
    length: number,
  ) => Promise<{ readonly bytesWritten: number }>;
}

/** 排他创建的临时写入句柄：完整写入、刷盘、关闭。 */
export interface TempWriteHandle {
  /** 临时文件绝对路径（与目标同目录），只供保存器内部使用，绝不进入跨进程结果。 */
  readonly tempPath: string;
  /** 完整写入全部字节；实现必须循环处理短写。 */
  write(bytes: Uint8Array): Promise<void>;
  /** 刷盘到持久存储。 */
  sync(): Promise<void>;
  /** 关闭句柄。 */
  close(): Promise<void>;
}

/** 临时文件创建工厂：在目标文件同一目录排他创建不可预测名称的临时文件。 */
export interface TempWriteFactory {
  readonly create: (targetPath: string) => Promise<TempWriteHandle>;
}

/**
 * 循环写入直至全部字节写完或失败。
 * 单次 `FileHandle.write` 允许短写，不能把一次返回不足误判为结束。
 */
export async function writeAllBytes(handle: WritableFileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset);
    if (bytesWritten <= 0) {
      throw new Error('wenshu: 临时文件写入无进展');
    }
    offset += bytesWritten;
  }
}

/** 生产环境默认临时文件工厂：同目录 `.wenshu-<uuid>.tmp` 排他创建（`wx`）。 */
export const defaultTempWriteFactory: TempWriteFactory = Object.freeze({
  create: async (targetPath: string) => {
    const tempPath = join(dirname(targetPath), `.wenshu-${randomUUID()}.tmp`);
    const handle = await open(tempPath, 'wx');
    return {
      tempPath,
      write: (bytes: Uint8Array) => writeAllBytes(handle, bytes),
      sync: () => handle.sync(),
      close: () => handle.close(),
    };
  },
});

/**
 * 同文件系统替换：临时文件替换为目标文件。
 * Windows 上由 libuv 的 MoveFileExW(MOVEFILE_REPLACE_EXISTING) 提供替换语义，
 * 不先删除、不先截断目标。
 */
export async function replaceFile(tempPath: string, targetPath: string): Promise<void> {
  await rename(tempPath, targetPath);
}

/** 尽力清理临时文件；`ENOENT` 视为成功。 */
export async function removeTempFile(tempPath: string): Promise<void> {
  await rm(tempPath, { force: true });
}
