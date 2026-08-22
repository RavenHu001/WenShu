import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/common.css';
import './styles/app.css';
import './styles/shell.css';
import './styles/workspace.css';
import './styles/document.css';
import './styles/search.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Renderer root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
