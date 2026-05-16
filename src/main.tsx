import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bootstrapDefaultProfile } from './db/bootstrap';
import { registerCoverFetchListeners } from './features/series/coverFetchRunner';
// Vendored fonts — satisfies "no network dependency after install" spec requirement.
import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/cormorant-garamond/300.css';
import '@fontsource/cormorant-garamond/300-italic.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/cormorant-garamond/500.css';
import './ui/tokens.css';
import './ui/global.css';
import './ui/typography.css';
import './ui/animations.css';

async function start(): Promise<void> {
  await bootstrapDefaultProfile();
  registerCoverFetchListeners();
  const rootEl = document.getElementById('root');
  if (!rootEl) {
    throw new Error('Missing #root element');
  }
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
