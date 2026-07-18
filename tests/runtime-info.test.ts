import { describe, expect, it } from 'vitest';
import { formatRuntimeInfo } from '../src/renderer/lib/runtime-info';

describe('formatRuntimeInfo', () => {
  it('uses the friendly Windows label for the preload platform value', () => {
    expect(formatRuntimeInfo({ platform: 'win32', electronVersion: '37.2.0' })).toBe(
      'Windows · Electron 37.2.0',
    );
  });

  it('keeps an unknown platform visible instead of hiding environment information', () => {
    expect(formatRuntimeInfo({ platform: 'future-os', electronVersion: '1.0.0' })).toBe(
      'future-os · Electron 1.0.0',
    );
  });
});
