import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { initUiScale } from './uiScale';
import '@fontsource/opendyslexic/400.css';
import '@fontsource/opendyslexic/700.css';
import './styles.css';

initUiScale();
(window as any).__BUILD_TAG = 'com-v1-ondevice';   // bumps the bundle hash so the CDN serves a fresh asset URL
// The model (about 520 MB) is fetched from the welcome screen, not here: downloading it behind the sign-in
// screen made the whole page unresponsive before the parent had even signed in.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
);
