import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const iconPath = resolve('build/icon.ico');
const sourcePath = resolve('build/icon.png');
const expectedSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];

describe('Windows 图标资源', () => {
  it('保留 PNG 源文件和多分辨率 32 位 ICO', async () => {
    const [source, icon] = await Promise.all([readFile(sourcePath), readFile(iconPath)]);

    expect(source.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(icon.readUInt16LE(0)).toBe(0);
    expect(icon.readUInt16LE(2)).toBe(1);
    expect(icon.readUInt16LE(4)).toBe(expectedSizes.length);

    const entries = Array.from({ length: expectedSizes.length }, (_, index) => {
      const offset = 6 + index * 16;
      const width = icon[offset] === 0 ? 256 : icon[offset];
      const height = icon[offset + 1] === 0 ? 256 : icon[offset + 1];
      return {
        width,
        height,
        bitCount: icon.readUInt16LE(offset + 6),
        byteLength: icon.readUInt32LE(offset + 8),
        imageOffset: icon.readUInt32LE(offset + 12),
      };
    });

    expect(
      entries.map((entry) => entry.width).sort((left, right) => (left ?? 0) - (right ?? 0)),
    ).toEqual(expectedSizes);
    expect(entries.every((entry) => entry.width === entry.height)).toBe(true);
    expect(entries.every((entry) => entry.bitCount === 32)).toBe(true);
    expect(entries.every((entry) => entry.byteLength > 0 && entry.imageOffset < icon.length)).toBe(
      true,
    );
  });
});
