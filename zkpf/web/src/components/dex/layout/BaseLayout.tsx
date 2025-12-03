import { type FC, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Scaffold, type ScaffoldProps } from "@orderly.network/ui-scaffold";
import { PathEnum } from "../constant";
import { useNav } from "../hooks/useNav";
import { useOrderlyConfig } from "../hooks/useOrderlyConfig";
import { FaucetButton } from "../components/faucet";
import "./BaseLayout.css";

export type BaseLayoutProps = {
  children: React.ReactNode;
  initialMenu?: string;
  classNames?: ScaffoldProps["classNames"];
};
export const BaseLayout: FC<BaseLayoutProps> = (props) => {
  const config = useOrderlyConfig();
  const { onRouteChange } = useNav();
  const [faucetContainer, setFaucetContainer] = useState<HTMLElement | null>(null);

  // Hide all navbar buttons except connect button
  useEffect(() => {
    const hideNavbarButtons = () => {
      // More aggressive approach: find all buttons in the entire header area
      const allButtons = document.querySelectorAll('header button, [class*="header"] button, [class*="Header"] button, [class*="toolbar"] button, [class*="oui-header"] button');
      
      allButtons.forEach((button) => {
        const element = button as HTMLElement;
        
        // Skip if already hidden by our previous logic
        if (element.style.display === 'none' && element.dataset.dexHidden === 'true') {
          return;
        }
        
        const classList = Array.from(element.classList);
        const text = element.textContent?.toLowerCase() || '';
        const dataTestId = element.getAttribute('data-testid') || '';
        const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
        const title = element.getAttribute('title')?.toLowerCase() || '';
        const id = element.id?.toLowerCase() || '';
        
        // Check if this is a connect/wallet button - be more specific
        const isConnectButton = 
          classList.some(cls => 
            cls.includes('wallet') || 
            cls.includes('connect') ||
            cls.includes('account-info') && !cls.includes('language')
          ) ||
          text.includes('connect') && !text.includes('language') ||
          text.includes('wallet') ||
          dataTestId.includes('wallet') ||
          dataTestId.includes('connect') ||
          ariaLabel.includes('wallet') ||
          ariaLabel.includes('connect') ||
          element.closest('[class*="wallet-connector"]') !== null ||
          element.closest('[class*="connect-wallet"]') !== null ||
          element.closest('[class*="account-info"]') !== null && !element.closest('[class*="language"]');
        
        // Check if this is a language/locale switcher button (should be hidden)
        const isLanguageButton = 
          classList.some(cls => 
            cls.includes('language') || 
            cls.includes('locale') || 
            cls.includes('lang') || 
            cls.includes('i18n')
          ) ||
          (text.match(/\b(en|zh|ja|ko|fr|de|es|pt|ru|it|tr|vi|th|id|hi)\b/) && text.length < 10) ||
          element.closest('[class*="language"]') !== null ||
          element.closest('[class*="locale"]') !== null ||
          ariaLabel.includes('language') ||
          ariaLabel.includes('locale') ||
          title.includes('language') ||
          title.includes('locale') ||
          id.includes('language') ||
          id.includes('locale');
        
        // Check if this is a QR code scanner button (should be hidden)
        const isQRCodeButton = 
          classList.some(cls => 
            cls.includes('qr') || 
            cls.includes('scan') || 
            cls.includes('camera') ||
            cls.includes('qrcode')
          ) ||
          text.includes('qr') ||
          text.includes('scan') ||
          text.includes('camera') ||
          dataTestId.includes('qr') ||
          dataTestId.includes('scan') ||
          ariaLabel.includes('qr') ||
          ariaLabel.includes('scan') ||
          title.includes('qr') ||
          title.includes('scan') ||
          id.includes('qr') ||
          id.includes('scan') ||
          element.closest('[class*="qr"]') !== null ||
          element.closest('[class*="scan"]') !== null ||
          element.querySelector('svg[class*="qr"], svg[class*="scan"], svg[class*="camera"], svg[viewBox*="24"]') !== null;
        
        // Hide if it's a language button, QR button, or NOT a connect button
        if (isLanguageButton || isQRCodeButton || !isConnectButton) {
          element.style.display = 'none';
          element.style.visibility = 'hidden';
          element.style.opacity = '0';
          element.style.height = '0';
          element.style.width = '0';
          element.style.padding = '0';
          element.style.margin = '0';
          element.style.overflow = 'hidden';
          element.style.pointerEvents = 'none';
          element.dataset.dexHidden = 'true';
        } else {
          // Ensure connect button is visible
          element.style.display = '';
          element.style.visibility = '';
          element.style.opacity = '';
          element.style.height = '';
          element.style.width = '';
          element.style.padding = '';
          element.style.margin = '';
          element.style.overflow = '';
          element.style.pointerEvents = '';
          delete element.dataset.dexHidden;
        }
      });
    };

    // Run immediately and on intervals
    hideNavbarButtons();
    const timeout1 = setTimeout(() => {
      console.log('[DEX] Hiding navbar buttons - attempt 1');
      hideNavbarButtons();
    }, 100);
    const timeout2 = setTimeout(() => {
      console.log('[DEX] Hiding navbar buttons - attempt 2');
      hideNavbarButtons();
    }, 500);
    const timeout3 = setTimeout(() => {
      console.log('[DEX] Hiding navbar buttons - attempt 3');
      hideNavbarButtons();
    }, 1000);
    const timeout4 = setTimeout(() => {
      console.log('[DEX] Hiding navbar buttons - attempt 4');
      hideNavbarButtons();
    }, 2000);

    // Use MutationObserver to catch dynamically added buttons
    const observer = new MutationObserver(() => {
      hideNavbarButtons();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-testid'],
    });

    return () => {
      clearTimeout(timeout1);
      clearTimeout(timeout2);
      clearTimeout(timeout3);
      clearTimeout(timeout4);
      observer.disconnect();
    };
  }, []);

  // Find or create container for faucet button in header
  useEffect(() => {
    let isInitialized = false;
    let observer: MutationObserver | null = null;
    const timeouts: NodeJS.Timeout[] = [];

    const findOrCreateContainer = () => {
      // Skip if already initialized and container exists
      if (isInitialized && document.getElementById('dex-faucet-button-container')) {
        return;
      }

      // Try to find existing container
      let container = document.getElementById('dex-faucet-button-container');
      
      if (!container) {
        // More aggressive search for Orderly UI elements
        // Orderly uses "oui-" prefix for their classes
        const possibleHeaders = [
          document.querySelector('[class*="oui-header"]'),
          document.querySelector('[class*="scaffold"] [class*="header"]'),
          document.querySelector('[class*="Header"]'),
          document.querySelector('header'),
          document.querySelector('[class*="toolbar"]'),
          document.querySelector('[class*="nav"]'),
        ].filter(Boolean) as HTMLElement[];

        // Find wallet/connect button - Orderly uses specific patterns
        const connectButtonSelectors = [
          '[class*="wallet-connector"]',
          '[class*="connect-wallet"]',
          '[class*="account-info"]',
          'button[class*="wallet"]',
          '[class*="oui-button"][class*="wallet"]',
          '[data-testid*="wallet"]',
          '[data-testid*="connect"]',
        ];

        let connectButton: Element | null = null;
        for (const selector of connectButtonSelectors) {
          connectButton = document.querySelector(selector);
          if (connectButton) break;
        }

        // Try to find the right container
        let targetParent: HTMLElement | null = null;

        // Strategy 1: Find parent of connect button
        if (connectButton?.parentElement) {
          targetParent = connectButton.parentElement;
        }
        // Strategy 2: Find header with flex/right alignment
        else if (possibleHeaders.length > 0) {
          for (const header of possibleHeaders) {
            // Look for flex containers that might hold buttons
            const flexContainers = header.querySelectorAll('[style*="flex"], [class*="flex"]');
            for (const flex of flexContainers) {
              const style = window.getComputedStyle(flex);
              if (style.display === 'flex' && (style.justifyContent?.includes('end') || style.justifyContent?.includes('right'))) {
                targetParent = flex as HTMLElement;
                break;
              }
            }
            if (targetParent) break;
          }
          if (!targetParent) {
            targetParent = possibleHeaders[0];
          }
        }
        // Strategy 3: Create a fixed position container
        else {
          targetParent = document.body;
        }

        if (targetParent) {
          container = document.createElement('div');
          container.id = 'dex-faucet-button-container';
          container.className = 'dex-faucet-button-wrapper';

          if (connectButton && connectButton.parentElement === targetParent) {
            // Insert before connect button
            targetParent.insertBefore(container, connectButton);
          } else if (connectButton?.parentElement) {
            // Insert in connect button's parent, before the button
            connectButton.parentElement.insertBefore(container, connectButton);
          } else {
            // Append to target parent
            targetParent.appendChild(container);
          }

          setFaucetContainer(container);
          isInitialized = true;
        }
      } else {
        setFaucetContainer(container);
        isInitialized = true;
      }
    };

    // Try multiple times as scaffold renders asynchronously
    timeouts.push(setTimeout(findOrCreateContainer, 100));
    timeouts.push(setTimeout(findOrCreateContainer, 500));
    timeouts.push(setTimeout(findOrCreateContainer, 1000));
    timeouts.push(setTimeout(findOrCreateContainer, 2000));

    // Use MutationObserver to catch when header is added, but throttle it
    let lastCheck = 0;
    const throttleDelay = 500; // Only check every 500ms

    observer = new MutationObserver(() => {
      const now = Date.now();
      if (now - lastCheck < throttleDelay) {
        return;
      }
      lastCheck = now;
      findOrCreateContainer();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      timeouts.forEach(clearTimeout);
      observer?.disconnect();
    };
  }, []);

  // Attach click handlers to ZKPF logo and p2p link
  useEffect(() => {
    let zkpfAttached = false;
    let p2pAttached = false;
    let observer: MutationObserver | null = null;
    const timeouts: NodeJS.Timeout[] = [];

    const attachLogoClickHandlers = () => {
      // Only search within header elements to avoid performance issues
      const headers = document.querySelectorAll('header, [class*="header"], [class*="Header"], [class*="logo"], [class*="Logo"]');
      
      for (const header of headers) {
        // Search for elements containing "ZKPF" text within header
        if (!zkpfAttached) {
          const zkpfWalker = document.createTreeWalker(
            header,
            NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
            {
              acceptNode: (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                  return node.textContent?.trim() === 'ZKPF' 
                    ? NodeFilter.FILTER_ACCEPT 
                    : NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_SKIP;
              }
            }
          );

          let zkpfTextNode = zkpfWalker.nextNode();
          if (zkpfTextNode && zkpfTextNode.parentElement) {
            const zkpfElement = zkpfTextNode.parentElement;
            
            // Check if handler already attached
            if (zkpfElement.dataset.zkpfLinkAttached !== 'true') {
              // Mark as attached
              zkpfElement.dataset.zkpfLinkAttached = 'true';
              zkpfElement.style.cursor = 'pointer';

              // Attach click handler
              const zkpfClickHandler = (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                window.location.href = '/';
              };

              zkpfElement.addEventListener('click', zkpfClickHandler, true);
              zkpfAttached = true;
            }
          }
        }

        // Search for elements containing "p2p" text within header
        if (!p2pAttached) {
          const p2pWalker = document.createTreeWalker(
            header,
            NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
            {
              acceptNode: (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                  const text = node.textContent?.trim().toLowerCase();
                  return text === 'p2p' 
                    ? NodeFilter.FILTER_ACCEPT 
                    : NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_SKIP;
              }
            }
          );

          let p2pTextNode = p2pWalker.nextNode();
          if (p2pTextNode && p2pTextNode.parentElement) {
            const p2pElement = p2pTextNode.parentElement;
            
            // Check if handler already attached
            if (p2pElement.dataset.p2pLinkAttached !== 'true') {
              // Mark as attached
              p2pElement.dataset.p2pLinkAttached = 'true';
              p2pElement.style.cursor = 'pointer';

              // Attach click handler
              const p2pClickHandler = (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                window.location.href = '/p2p';
              };

              p2pElement.addEventListener('click', p2pClickHandler, true);
              p2pAttached = true;
            }
          }
        }

        // Break if both are attached
        if (zkpfAttached && p2pAttached) {
          break;
        }
      }
    };

    // Try multiple times as scaffold renders asynchronously
    timeouts.push(setTimeout(attachLogoClickHandlers, 500));
    timeouts.push(setTimeout(attachLogoClickHandlers, 1500));
    timeouts.push(setTimeout(attachLogoClickHandlers, 3000));

    // Use MutationObserver with throttling
    let lastCheck = 0;
    const throttleDelay = 1000;

    observer = new MutationObserver(() => {
      const now = Date.now();
      if (now - lastCheck < throttleDelay) {
        return;
      }
      lastCheck = now;
      if (!zkpfAttached || !p2pAttached) {
        attachLogoClickHandlers();
      }
    });

    // Only observe header areas, not entire body
    const header = document.querySelector('header, [class*="header"]');
    if (header) {
      observer.observe(header, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    return () => {
      timeouts.forEach(clearTimeout);
      observer?.disconnect();
    };
  }, []);

  return (
    <div style={{ position: "relative" }}>
      <Scaffold
        mainNavProps={{
          ...config.scaffold.mainNavProps,
          initialMenu: props.initialMenu || PathEnum.Root,
        }}
        footerProps={config.scaffold.footerProps}
        routerAdapter={{
          onRouteChange,
        }}
        classNames={props.classNames}
      >
        {props.children}
      </Scaffold>
      {/* Render faucet button - try portal first, fallback to fixed position */}
      {faucetContainer ? (
        createPortal(<FaucetButton />, faucetContainer)
      ) : (
        <div className="dex-faucet-button-fallback" style={{ display: 'block' }}>
          <FaucetButton />
        </div>
      )}
    </div>
  );
};

