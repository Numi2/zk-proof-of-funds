import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { ThemeProvider } from './context/ThemeContext';
import { WebZjsProvider } from './context/WebzjsContext';
import { MetaMaskProvider } from './hooks/MetaMaskContext';
import { AuthProvider } from './context/AuthContext';
import { LoginModal } from './components/auth';
import App from './App.tsx';

const queryClient = new QueryClient();

// Hide TradingView license message component
const hideTradingViewMessage = () => {
  const checkAndHide = () => {
    // Find all elements that might contain the TradingView license message
    const allElements = document.querySelectorAll('div');
    allElements.forEach((el) => {
      const text = el.textContent || '';
      if (
        text.includes("Due to TradingView's policy") ||
        text.includes("TradingView Advanced Chart license") ||
        text.includes("orderly.network to set up")
      ) {
        // Check if it has the oui classes
        if (
          el.classList.contains('oui-absolute') &&
          el.classList.contains('oui-inset-0')
        ) {
          el.style.display = 'none';
          el.style.visibility = 'hidden';
          el.style.opacity = '0';
          el.style.height = '0';
          el.style.overflow = 'hidden';
          el.style.pointerEvents = 'none';
        }
      }
    });
  };

  // Run immediately
  checkAndHide();

  // Also run after a delay to catch dynamically rendered content
  setTimeout(checkAndHide, 1000);
  setTimeout(checkAndHide, 3000);
  setTimeout(checkAndHide, 5000);

  // Use MutationObserver to catch dynamically added content
  const observer = new MutationObserver(checkAndHide);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
};

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hideTradingViewMessage);
} else {
  hideTradingViewMessage();
}

// Global error handler for unhandled module loading errors
window.addEventListener('error', (event) => {
  // Check if this is a module loading error (Unexpected token '<' usually means HTML was returned)
  if (event.error && event.error.message && event.error.message.includes("Unexpected token '<'")) {
    console.error('[Module Load Error] Failed to load module:', event.filename || event.target);
    console.error('[Module Load Error] This usually means a 404 HTML page was returned instead of JavaScript');
    // Don't prevent default - let error boundary handle it
  }
}, true);

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
    <ThemeProvider>
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
    </ThemeProvider>
  </StrictMode>,
);
