import { defaultSettings, defaultState } from '../../src/shared/app-state';
import type { SettingsLoad } from '../../src/renderer/lib/use-app-settings';

/** Existing editor/search tests start with loaded preferences, as the production entry does.
 * Blank mode isolates their manual workspace lifecycle from automatic startup/recording.
 * Restore modes and persistence are covered by startup-restore and real Electron tests.
 */
export const blankStartup: SettingsLoad = {
  status: 'ok',
  snapshot: {
    settings: { ...defaultSettings(), startupMode: 'blank' },
    effectiveStartupMode: 'blank',
    state: defaultState(),
    workspaceSessionId: null,
    dataDirectory: { path: '/isolated-test-data', mode: 'test', canReselect: false },
    files: {
      settings: { status: 'valid', pending: false, error: null },
      state: { status: 'missing', pending: false, error: null },
    },
  },
};
