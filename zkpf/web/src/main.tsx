import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { WebZjsProvider } from './context/WebzjsContext';
import { MetaMaskProvider } from './hooks/MetaMaskContext';
import App from './App.tsx';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <MetaMaskProvider>
          <WebZjsProvider>
            <App />
          </WebZjsProvider>
        </MetaMaskProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
