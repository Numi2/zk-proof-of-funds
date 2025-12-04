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

console.log('[App] main.tsx loaded successfully');

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
  // Log all errors for debugging
  console.error('[Global Error Handler]', event.error || event.message, event.filename || event.target);
}, true);

// Handle unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Promise Rejection]', event.reason);
});

// Register PWA service worker for offline capability
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.log('ServiceWorker registration failed:', err);
    });
  });
}

// Track if mount has been attempted to prevent double mounting
let mountAttempted = false;

// Mount the app with error handling
function mountApp() {
  if (mountAttempted) {
    console.log('[App] mountApp already attempted, skipping...');
    return;
  }
  mountAttempted = true;
  
  const rootElement = document.getElementById('root');
  
  if (!rootElement) {
    console.error('[Mount Error] Root element not found!');
    document.body.innerHTML = `
      <div style="padding: 2rem; text-align: center; font-family: system-ui;">
        <h1 style="color: #ef4444;">Application Error</h1>
        <p>Root element (#root) not found. Please check the HTML structure.</p>
      </div>
    `;
    return;
  }

  try {
    console.log('[App] Mounting React application...');
    const root = createRoot(rootElement);
    
    root.render(
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
    console.log('[App] React application mounted successfully');
  } catch (error) {
    console.error('[Mount Error] Failed to mount React application:', error);
    rootElement.innerHTML = `
      <div style="padding: 2rem; text-align: center; font-family: system-ui; background: #1a1a2e; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center;">
        <div>
          <h1 style="color: #ef4444; margin-bottom: 1rem;">Application Error</h1>
          <p style="color: #888; margin-bottom: 1.5rem;">Failed to mount the application.</p>
          <pre style="background: rgba(0,0,0,0.3); padding: 1rem; border-radius: 8px; text-align: left; overflow: auto; max-width: 600px;">
            ${error instanceof Error ? error.message : String(error)}
          </pre>
          <button 
            onclick="window.location.reload()" 
            style="margin-top: 1rem; padding: 0.75rem 1.5rem; background: #f59e0b; color: #0a0a14; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">
            Reload Page
          </button>
        </div>
      </div>
    `;
  }
}

// Wait for DOM to be ready before mounting
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountApp);
} else {
  // DOM is already ready
  mountApp();
}

// Fallback: Ensure app mounts even if there are timing issues
// This helps catch cases where scripts load but mountApp doesn't run
setTimeout(() => {
  const rootElement = document.getElementById('root');
  if (rootElement && rootElement.children.length === 0 && !mountAttempted) {
    console.warn('[App] Root element is empty after timeout, attempting to mount...');
    mountAttempted = true;
    mountApp();
  }
}, 2000);
