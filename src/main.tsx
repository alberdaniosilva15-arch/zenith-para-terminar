import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);

// FIX: Remover splash screen nativo quando React monta
requestAnimationFrame(() => {
  const splash = document.getElementById('zenith-splash');
  if (splash) {
    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 500);
  }
});

// FIX: Remover registo de SW inexistente (sw.js não existe — causa erro 404 silencioso)
// Service Worker será implementado correctamente na Fase 6
