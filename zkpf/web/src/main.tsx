import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { WebZjsProvider } from './context/WebzjsContext';
import { MetaMaskProvider } from './hooks/MetaMaskContext';
import { AuthProvider } from './context/AuthContext';
import { LoginModal } from './components/auth';
import App from './App.tsx';

const queryClient = new QueryClient();

// Register PWA service worker for offline capability
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.log('ServiceWorker registration failed:', err);
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <MetaMaskProvider>
            <WebZjsProvider>
              <App />
              <LoginModal />
            </WebZjsProvider>
          </MetaMaskProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
