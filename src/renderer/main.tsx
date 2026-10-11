import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyDisplayPreferences, loadAppSettings } from './lib/use-app-settings';
import { defaultSettings } from '../shared/app-state';
import './styles/tokens.css';
import './styles/common.css';
import './styles/app.css';
import './styles/shell.css';
import './styles/workspace.css';
import './styles/document.css';
import './styles/search.css';
import './styles/settings.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Renderer root element was not found.');
}

// Read the real main-process service before the first application render.
void loadAppSettings().then((initialSettings) => {
  applyDisplayPreferences(
    initialSettings.status === 'ok' ? initialSettings.snapshot.settings : defaultSettings(),
  );
  createRoot(rootElement).render(
    <StrictMode>
      <App initialSettings={initialSettings} />
    </StrictMode>,
  );
});
