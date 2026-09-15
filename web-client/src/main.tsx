import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { initUiScale } from './uiScale';
import { engine } from './engine/model';
import '@fontsource/opendyslexic/400.css';
import '@fontsource/opendyslexic/700.css';
import './styles.css';

initUiScale();
(window as any).__BUILD_TAG = 'com-v1-ondevice';   // bumps the bundle hash so the CDN serves a fresh asset URL
// Start fetching the on-device model right away so the first session starts quickly.
engine.load().catch(err => console.error('model load failed', err));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
);
