import type { DesktopRuntimeInfo } from '../../shared/desktop-api';

const platformLabels: Readonly<Record<string, string>> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
};

/** 将桥接层的原始值转换为稳定、可测试的界面文案。 */
export const formatRuntimeInfo = (runtime: DesktopRuntimeInfo): string => {
  const platform = platformLabels[runtime.platform] ?? runtime.platform;
  return `${platform} · Electron ${runtime.electronVersion}`;
};
