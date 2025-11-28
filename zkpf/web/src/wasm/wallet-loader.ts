/**
 * Runtime WASM loader for WebZjs wallet
 * 
 * Automatically selects the appropriate WASM bundle based on browser capabilities:
 * - Threaded build (pkg-threads): For browsers with SharedArrayBuffer + cross-origin isolation
 * - Single-threaded build (pkg-single): For all other browsers (slower but works everywhere)
 * 
 * Based on the dual-build pattern from wasm-bindgen-rayon docs.
 */

import type { WalletSummary, WebWallet } from '@chainsafe/webzjs-wallet';

// Track which variant was loaded
let loadedVariant: 'threads' | 'single' | null = null;
let wasmModule: WasmModule | null = null;

interface WasmModule {
  default: () => Promise<void>;
  initThreadPool?: (numThreads: number) => Promise<void>;
  WebWallet: typeof WebWallet;
}

/**
 * Check if the browser supports SharedArrayBuffer with cross-origin isolation
 */
export function supportsSharedArrayBuffer(): boolean {
  try {
    // Must have SharedArrayBuffer API
    if (typeof SharedArrayBuffer === 'undefined') {
      return false;
    }
    
    // Must be cross-origin isolated (COOP/COEP headers set correctly)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((self as any).crossOriginIsolated !== true) {
      return false;
    }
    
    // Quick functional test - create a small SharedArrayBuffer and use Atomics
    const sab = new SharedArrayBuffer(4);
    const view = new Int32Array(sab);
    Atomics.store(view, 0, 42);
    return Atomics.load(view, 0) === 42;
  } catch {
    return false;
  }
}

/**
 * Get diagnostic info about the current environment
 */
export function getWasmEnvironmentInfo(): {
  supportsThreads: boolean;
  hasSAB: boolean;
  isCrossOriginIsolated: boolean;
  loadedVariant: 'threads' | 'single' | null;
  hardwareConcurrency: number;
} {
  return {
    supportsThreads: supportsSharedArrayBuffer(),
    hasSAB: typeof SharedArrayBuffer !== 'undefined',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    isCrossOriginIsolated: (self as any).crossOriginIsolated === true,
    loadedVariant,
    hardwareConcurrency: navigator.hardwareConcurrency || 4,
  };
}

/**
 * Load the appropriate WASM module based on browser capabilities
 * 
 * @returns The loaded WASM module with WebWallet class and init functions
 */
export async function loadWalletWasm(): Promise<WasmModule> {
  // Return cached module if already loaded
  if (wasmModule) {
    return wasmModule;
  }

  const canUseThreads = supportsSharedArrayBuffer();
  
  console.info(`[WASM Loader] Environment check:
    SharedArrayBuffer: ${typeof SharedArrayBuffer !== 'undefined'}
    crossOriginIsolated: ${typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : 'undefined'}
    Can use threads: ${canUseThreads}
    Hardware concurrency: ${navigator.hardwareConcurrency || 'unknown'}`);

  if (canUseThreads) {
    // Load threaded variant
    console.info('[WASM Loader] Loading THREADED wallet (SharedArrayBuffer available)');
    
    try {
      // Dynamic import of threaded build
      // Note: Path is relative to the web app's module resolution
      const wasm = await import('@chainsafe/webzjs-wallet') as WasmModule;
      
      // Initialize WASM
      await wasm.default();
      
      // Initialize thread pool
      if (typeof wasm.initThreadPool === 'function') {
        const threads = navigator.hardwareConcurrency || 4;
        console.info(`[WASM Loader] Initializing thread pool with ${threads} workers...`);
        try {
          await wasm.initThreadPool(threads);
          console.info(`[WASM Loader] ✅ Thread pool ready (${threads} workers)`);
        } catch (threadErr) {
          console.warn('[WASM Loader] Thread pool init failed, continuing single-threaded:', threadErr);
        }
      }
      
      loadedVariant = 'threads';
      wasmModule = wasm;
      return wasm;
    } catch (err) {
      console.warn('[WASM Loader] Failed to load threaded variant, falling back to single-threaded:', err);
      // Fall through to single-threaded
    }
  }

  // Load single-threaded variant
  console.info('[WASM Loader] Loading SINGLE-THREADED wallet (no SharedArrayBuffer)');
  
  try {
    // Try to load single-threaded variant
    // This path needs to be configured in vite.config.ts aliases
    const wasm = await import('@chainsafe/webzjs-wallet-single') as WasmModule;
    
    // Initialize WASM (no thread pool needed)
    await wasm.default();
    
    loadedVariant = 'single';
    wasmModule = wasm;
    console.info('[WASM Loader] ✅ Single-threaded wallet loaded');
    return wasm;
  } catch (err) {
    // If single-threaded variant isn't available, try the main one anyway
    // (it will fail later if SAB is truly unavailable)
    console.warn('[WASM Loader] Single-threaded variant not found, trying main module:', err);
    
    const wasm = await import('@chainsafe/webzjs-wallet') as WasmModule;
    await wasm.default();
    loadedVariant = 'single'; // Best effort
    wasmModule = wasm;
    return wasm;
  }
}

/**
 * Create a new WebWallet instance using the appropriate WASM variant
 */
export async function createWebWallet(
  network: string,
  lightwalletdUrl: string,
  birthdayHeight: number,
  serializedDb?: Uint8Array
): Promise<WebWallet> {
  const wasm = await loadWalletWasm();
  
  if (serializedDb) {
    return new wasm.WebWallet(network, lightwalletdUrl, birthdayHeight, serializedDb);
  } else {
    return new wasm.WebWallet(network, lightwalletdUrl, birthdayHeight);
  }
}

/**
 * Get the variant that was loaded
 */
export function getLoadedVariant(): 'threads' | 'single' | null {
  return loadedVariant;
}

/**
 * Check if we're running in threaded mode
 */
export function isThreadedMode(): boolean {
  return loadedVariant === 'threads';
}

