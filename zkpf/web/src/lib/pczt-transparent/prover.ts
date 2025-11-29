/**
 * Prover role utilities.
 *
 * This module provides helpers for the proving phase of PCZT construction.
 * Note that actual proof generation MUST be done in Rust/WASM.
 */

import type { ProverProgress } from './types';

/**
 * Run the prover in a Web Worker for non-blocking proof generation.
 *
 * This is the recommended approach for UI applications to avoid
 * blocking the main thread during proof generation.
 *
 * @param pcztBytes - The serialized PCZT bytes
 * @param onProgress - Optional progress callback
 * @returns Promise that resolves to the proven PCZT bytes
 *
 * @example
 * ```typescript
 * import { serializePczt, parsePczt, proveInWorker } from '@zkpf/pczt-transparent';
 *
 * const pcztBytes = serializePczt(pczt);
 *
 * const provenBytes = await proveInWorker(pcztBytes, (progress) => {
 *   updateUI(`Proving: ${progress.progress}%`);
 * });
 *
 * const provenPczt = await parsePczt(provenBytes);
 * ```
 */
export async function proveInWorker(
  pcztBytes: Uint8Array,
  onProgress?: (progress: ProverProgress) => void
): Promise<Uint8Array> {
  // Check if Web Workers are available
  if (typeof Worker === 'undefined') {
    throw new Error('Web Workers are not available in this environment');
  }

  return new Promise((resolve, reject) => {
    // Create a blob URL for the worker script
    const workerScript = `
      import init, { prove_transaction, parse_pczt, serialize_pczt } from '@zkpf/pczt-transparent-wasm';

      self.onmessage = async (e) => {
        try {
          await init();

          self.postMessage({ type: 'progress', phase: 'loading', progress: 0 });

          const pcztBytes = new Uint8Array(e.data.pcztBytes);
          const pczt = parse_pczt(pcztBytes);

          self.postMessage({ type: 'progress', phase: 'proving', progress: 20 });

          const provenPczt = prove_transaction(pczt);

          self.postMessage({ type: 'progress', phase: 'complete', progress: 100 });

          const resultBytes = serialize_pczt(provenPczt);
          self.postMessage({ type: 'result', bytes: resultBytes });
        } catch (error) {
          self.postMessage({ type: 'error', error: error.message });
        }
      };
    `;

    const blob = new Blob([workerScript], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl, { type: 'module' });

    worker.onmessage = (e) => {
      const { type } = e.data;

      switch (type) {
        case 'progress':
          onProgress?.({
            phase: e.data.phase,
            progress: e.data.progress,
            estimatedRemainingMs: e.data.estimatedRemainingMs,
          });
          break;
        case 'result':
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          resolve(new Uint8Array(e.data.bytes));
          break;
        case 'error':
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          reject(new Error(e.data.error));
          break;
      }
    };

    worker.onerror = (error) => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      reject(error);
    };

    // Start the worker
    worker.postMessage({ pcztBytes: Array.from(pcztBytes) });
  });
}

/**
 * Estimate the time required for proof generation.
 *
 * This is a rough estimate based on the number of Orchard actions
 * and typical proving times on consumer hardware.
 *
 * @param orchardActionCount - The number of Orchard actions to prove
 * @returns Estimated time in milliseconds
 */
export function estimateProvingTime(orchardActionCount: number): number {
  // Base time for setup and verification
  const baseTimeMs = 2000;

  // Time per Orchard action (roughly 1-2 seconds each)
  const perActionTimeMs = 1500;

  return baseTimeMs + orchardActionCount * perActionTimeMs;
}

/**
 * Check if the current environment supports efficient proving.
 *
 * Efficient proving requires:
 * - WASM SIMD support
 * - Sufficient memory (at least 2GB recommended)
 * - Web Workers for non-blocking operation
 *
 * @returns Object indicating environment capabilities
 */
export function checkProvingCapabilities(): {
  wasmSimd: boolean;
  webWorkers: boolean;
  sufficient: boolean;
  recommendations: string[];
} {
  const recommendations: string[] = [];

  // Check WASM SIMD support
  let wasmSimd = false;
  try {
    // Test for WASM SIMD by checking for specific feature
    wasmSimd = WebAssembly.validate(
      new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, // WASM magic
        0x01, 0x00, 0x00, 0x00, // Version
        0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, // Type section with v128
        0x03, 0x02, 0x01, 0x00, // Function section
        0x0a, 0x0a, 0x01, 0x08, 0x00, 0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x0b, // Code with v128.const
      ])
    );
  } catch {
    wasmSimd = false;
  }

  if (!wasmSimd) {
    recommendations.push(
      'WASM SIMD is not supported. Proving will be slower. Consider using a modern browser.'
    );
  }

  // Check Web Workers
  const webWorkers = typeof Worker !== 'undefined';
  if (!webWorkers) {
    recommendations.push(
      'Web Workers are not available. Proving will block the main thread.'
    );
  }

  // Memory check is not directly available, but we can make recommendations
  recommendations.push(
    'Ensure at least 2GB of available memory for optimal proving performance.'
  );

  return {
    wasmSimd,
    webWorkers,
    sufficient: wasmSimd,
    recommendations: recommendations.filter((r) => r.length > 0),
  };
}

/**
 * Create a progress tracker for multi-step operations.
 *
 * @param steps - The steps to track
 * @param onProgress - Callback for progress updates
 * @returns Object with methods to advance through steps
 */
export function createProgressTracker(
  steps: string[],
  onProgress: (progress: ProverProgress) => void
): {
  advance: () => void;
  complete: () => void;
  fail: (error: string) => void;
} {
  let currentStep = 0;
  const totalSteps = steps.length;

  const phases: Record<number, ProverProgress['phase']> = {
    0: 'loading',
    1: 'preparing',
    2: 'proving',
    3: 'verifying',
  };

  const reportProgress = () => {
    const progress = Math.round((currentStep / totalSteps) * 100);
    const phase = phases[Math.min(currentStep, 3)] ?? 'proving';
    const remainingSteps = totalSteps - currentStep;
    const estimatedRemainingMs = remainingSteps * 1000; // 1 second per step estimate

    onProgress({
      phase,
      progress,
      estimatedRemainingMs,
    });
  };

  return {
    advance: () => {
      currentStep++;
      reportProgress();
    },
    complete: () => {
      currentStep = totalSteps;
      onProgress({
        phase: 'complete',
        progress: 100,
      });
    },
    fail: (_error: string) => {
      // Progress tracking doesn't handle errors, but we stop advancing
    },
  };
}

