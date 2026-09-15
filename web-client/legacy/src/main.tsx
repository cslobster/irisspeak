import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { store } from './store';
import { initUiScale } from './uiScale';
import '@fontsource/opendyslexic/400.css';
import '@fontsource/opendyslexic/700.css';
import './styles.css';

// Apply the persisted accessibility text/card-size setting before first paint.
initUiScale();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Provider>
  </StrictMode>
);
