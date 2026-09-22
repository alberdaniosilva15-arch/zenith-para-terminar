import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import AdminApp from '../src/admin/AdminApp';
import ErrorBoundary from '../src/components/ErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AdminApp />
    </ErrorBoundary>
  </StrictMode>,
);
