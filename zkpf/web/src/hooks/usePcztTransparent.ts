/**
 * Hook for PCZT Transparent-to-Shielded transactions.
 * 
 * This hook provides the UI flow for PCZT (ZIP 374) transactions.
 * When the WASM module is built, it will use the full PCZT library.
 * For now, it provides stub implementations that demonstrate the flow.
 * 
 * Based on ZIP 374 PCZT format.
 */

import { useState, useCallback, useRef } from 'react';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES (inline to avoid dependency on unbuilt module)
// ═══════════════════════════════════════════════════════════════════════════════

export const Network = {
  Mainnet: 'mainnet',
  Testnet: 'testnet',
  Regtest: 'regtest',
} as const;
export type Network = typeof Network[keyof typeof Network];

export interface TransparentInput {
  txid: string;
  vout: number;
  value: bigint;
  scriptPubKey: string;
  redeemScript?: string;
  derivationPath?: string;
  publicKey?: string;
}

export interface Payment {
  address: string;
  amount: bigint;
  memo?: string;
  label?: string;
  message?: string;
}

export interface PaymentRequest {
  payments: Payment[];
}

export interface SigHash {
  hash: Uint8Array;
  inputIndex: number;
  sighashType: number;
}

export interface TransparentSignature {
  signature: Uint8Array;
  publicKey: Uint8Array;
}

export interface TransactionBytes {
  bytes: Uint8Array;
  txid: string;
}

export interface ExpectedChange {
  transparent: { value: bigint; scriptPubKey: string; address?: string }[];
  shieldedValue: bigint;
}

export interface ProverProgress {
  phase: 'loading' | 'preparing' | 'proving' | 'verifying' | 'complete';
  progress: number;
  estimatedRemainingMs?: number;
}

export const PcztErrorType = {
  ProposalError: 'PROPOSAL_ERROR',
  ProverError: 'PROVER_ERROR',
  SignatureError: 'SIGNATURE_ERROR',
  SighashError: 'SIGHASH_ERROR',
  VerificationError: 'VERIFICATION_ERROR',
  CombineError: 'COMBINE_ERROR',
  FinalizationError: 'FINALIZATION_ERROR',
  ParseError: 'PARSE_ERROR',
  InvalidAddress: 'INVALID_ADDRESS',
  InsufficientFunds: 'INSUFFICIENT_FUNDS',
  NetworkError: 'NETWORK_ERROR',
} as const;
export type PcztErrorType = typeof PcztErrorType[keyof typeof PcztErrorType];

export class PcztError extends Error {
  public readonly type: PcztErrorType;
  public readonly details?: unknown;
  
  constructor(
    type: PcztErrorType,
    message: string,
    details?: unknown
  ) {
    super(message);
    this.type = type;
    this.details = details;
    this.name = 'PcztError';
  }
}

export interface ExternalSigner {
  sign(hash: Uint8Array, derivationPath: string): Promise<Uint8Array>;
  getPublicKey(derivationPath: string): Promise<Uint8Array>;
}

// Mock PCZT type for now
export interface Pczt {
  transparentInputCount: number;
  transparentOutputCount: number;
  hasOrchard: boolean;
  orchardActionCount: number;
  serialize(): Uint8Array;
  toJSON(): unknown;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export function zatoshisToZec(zatoshis: bigint): string {
  const zec = Number(zatoshis) / 100_000_000;
  return zec.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
}

export function zecToZatoshis(zec: number): bigint {
  return BigInt(Math.round(zec * 100_000_000));
}

export function isTransparentAddress(address: string): boolean {
  return address.startsWith('t1') || address.startsWith('tm');
}

export function isOrchardAddress(address: string): boolean {
  return address.startsWith('u1') || address.startsWith('utest');
}

export function createTransparentInput(
  txid: string,
  vout: number,
  value: bigint,
  scriptPubKey: string,
  derivationPath?: string,
  publicKey?: string
): TransparentInput {
  return { txid, vout, value, scriptPubKey, derivationPath, publicKey };
}

export function createPayment(
  address: string,
  amount: bigint,
  memo?: string
): Payment {
  return { address, amount, memo };
}

export function createPaymentRequest(payments: Payment[]): PaymentRequest {
  return { payments };
}

/** ZIP 317 fee estimation */
export function estimateFee(
  inputs: TransparentInput[],
  request: PaymentRequest
): bigint {
  const BASE_FEE = 10_000n;
  const MARGINAL_FEE = 5_000n;
  const GRACE_ACTIONS = 2;

  const transparentInputs = inputs.length;
  const transparentOutputs = request.payments.filter(p => isTransparentAddress(p.address)).length;
  const orchardOutputs = request.payments.filter(p => isOrchardAddress(p.address)).length;

  const logicalActions = Math.max(
    transparentInputs,
    transparentOutputs + orchardOutputs * 2
  );

  const fee = BASE_FEE + MARGINAL_FEE * BigInt(Math.max(0, logicalActions - GRACE_ACTIONS));
  return fee;
}

export function validateSufficientFunds(
  inputs: TransparentInput[],
  request: PaymentRequest
): void {
  const totalInput = inputs.reduce((sum, i) => sum + i.value, 0n);
  const totalOutput = request.payments.reduce((sum, p) => sum + p.amount, 0n);
  const fee = estimateFee(inputs, request);
  const required = totalOutput + fee;

  if (totalInput < required) {
    throw new PcztError(
      PcztErrorType.InsufficientFunds,
      `Insufficient funds: available ${zatoshisToZec(totalInput)} ZEC, required ${zatoshisToZec(required)} ZEC`
    );
  }
}

export function calculateChange(
  inputs: TransparentInput[],
  request: PaymentRequest,
  fee?: bigint
): bigint {
  const totalInput = inputs.reduce((sum, i) => sum + i.value, 0n);
  const totalOutput = request.payments.reduce((sum, p) => sum + p.amount, 0n);
  const actualFee = fee ?? estimateFee(inputs, request);
  return totalInput - totalOutput - actualFee;
}

export function parseZip321Uri(uri: string): PaymentRequest {
  if (!uri.startsWith('zcash:')) {
    throw new PcztError(PcztErrorType.ParseError, 'Invalid ZIP 321 URI');
  }

  const [addressPart, queryPart] = uri.slice(6).split('?');
  if (!addressPart) {
    throw new PcztError(PcztErrorType.ParseError, 'Missing address in URI');
  }

  const params = new URLSearchParams(queryPart || '');
  const amountStr = params.get('amount');
  if (!amountStr) {
    throw new PcztError(PcztErrorType.ParseError, 'Missing amount in URI');
  }

  const amountZec = parseFloat(amountStr);
  if (isNaN(amountZec) || amountZec <= 0) {
    throw new PcztError(PcztErrorType.ParseError, `Invalid amount: ${amountStr}`);
  }

  const payment: Payment = {
    address: addressPart,
    amount: zecToZatoshis(amountZec),
  };

  if (params.get('memo')) {
    payment.memo = decodeURIComponent(params.get('memo')!);
  }

  return { payments: [payment] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type PcztStep = 
  | 'idle'
  | 'input'
  | 'proposed'
  | 'signing'
  | 'proving'
  | 'finalizing'
  | 'complete'
  | 'error';

export interface PcztState {
  step: PcztStep;
  pczt: Pczt | null;
  pcztBytes: Uint8Array | null;
  inputs: TransparentInput[];
  paymentRequest: PaymentRequest | null;
  network: Network;
  estimatedFee: bigint;
  changeAmount: bigint;
  sighashes: SigHash[];
  proverProgress: ProverProgress | null;
  transaction: TransactionBytes | null;
  error: string | null;
  loading: boolean;
  wasmReady: boolean;
}

const initialState: PcztState = {
  step: 'idle',
  pczt: null,
  pcztBytes: null,
  inputs: [],
  paymentRequest: null,
  network: Network.Mainnet,
  estimatedFee: 0n,
  changeAmount: 0n,
  sighashes: [],
  proverProgress: null,
  transaction: null,
  error: null,
  loading: false,
  wasmReady: false,
};

// ═══════════════════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════════════════

export function usePcztTransparent() {
  const [state, setState] = useState<PcztState>(initialState);
  const externalSignerRef = useRef<ExternalSigner | null>(null);

  // Initialize (mock WASM - will be real when built)
  const initWasm = useCallback(async () => {
    if (state.wasmReady) return true;

    try {
      setState(s => ({ ...s, loading: true, error: null }));
      // Simulate WASM loading
      await new Promise(resolve => setTimeout(resolve, 500));
      setState(s => ({ ...s, wasmReady: true, loading: false }));
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load PCZT WASM';
      setState(s => ({ 
        ...s, 
        loading: false, 
        error: message,
        step: 'error',
      }));
      return false;
    }
  }, [state.wasmReady]);

  const setNetwork = useCallback((network: Network) => {
    setState(s => ({ ...s, network }));
  }, []);

  const addInput = useCallback((input: TransparentInput) => {
    setState(s => ({
      ...s,
      inputs: [...s.inputs, input],
      step: 'input',
    }));
  }, []);

  const removeInput = useCallback((index: number) => {
    setState(s => ({
      ...s,
      inputs: s.inputs.filter((_, i) => i !== index),
    }));
  }, []);

  const clearInputs = useCallback(() => {
    setState(s => ({ ...s, inputs: [] }));
  }, []);

  const setPaymentRequest = useCallback((request: PaymentRequest) => {
    setState(s => {
      const fee = s.inputs.length > 0 ? estimateFee(s.inputs, request) : 0n;
      const change = s.inputs.length > 0 ? calculateChange(s.inputs, request, fee) : 0n;
      return {
        ...s,
        paymentRequest: request,
        estimatedFee: fee,
        changeAmount: change,
        step: 'input',
      };
    });
  }, []);

  const parsePaymentUri = useCallback((uri: string): PaymentRequest | null => {
    try {
      return parseZip321Uri(uri);
    } catch (err) {
      const message = err instanceof PcztError ? err.message : 'Invalid payment URI';
      setState(s => ({ ...s, error: message }));
      return null;
    }
  }, []);

  // Propose transaction (stub implementation)
  const propose = useCallback(async (): Promise<boolean> => {
    if (!state.wasmReady) {
      const ready = await initWasm();
      if (!ready) return false;
    }

    if (state.inputs.length === 0) {
      setState(s => ({ ...s, error: 'No inputs to spend' }));
      return false;
    }

    if (!state.paymentRequest || state.paymentRequest.payments.length === 0) {
      setState(s => ({ ...s, error: 'No payment request' }));
      return false;
    }

    try {
      validateSufficientFunds(state.inputs, state.paymentRequest);
    } catch (err) {
      const message = err instanceof PcztError ? err.message : 'Validation failed';
      setState(s => ({ ...s, error: message }));
      return false;
    }

    setState(s => ({ ...s, loading: true, error: null }));

    try {
      // Simulate PCZT creation
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Generate mock sighashes
      const sighashes: SigHash[] = state.inputs.map((_, i) => ({
        hash: crypto.getRandomValues(new Uint8Array(32)),
        inputIndex: i,
        sighashType: 0x01,
      }));

      // Mock PCZT
      const pczt: Pczt = {
        transparentInputCount: state.inputs.length,
        transparentOutputCount: state.paymentRequest.payments.filter(p => isTransparentAddress(p.address)).length + 1,
        hasOrchard: state.paymentRequest.payments.some(p => isOrchardAddress(p.address)),
        orchardActionCount: state.paymentRequest.payments.filter(p => isOrchardAddress(p.address)).length,
        serialize: () => new Uint8Array(256),
        toJSON: () => ({ mock: true }),
      };

      setState(s => ({
        ...s,
        pczt,
        pcztBytes: pczt.serialize(),
        sighashes,
        step: 'proposed',
        loading: false,
      }));

      return true;
    } catch (err) {
      const message = err instanceof PcztError ? err.message : 'Failed to propose transaction';
      setState(s => ({ 
        ...s, 
        loading: false, 
        error: message,
        step: 'error',
      }));
      return false;
    }
  }, [state.wasmReady, state.inputs, state.paymentRequest, initWasm]);

  const setExternalSigner = useCallback((signer: ExternalSigner) => {
    externalSignerRef.current = signer;
  }, []);

  const signWithExternalSigner = useCallback(async (): Promise<boolean> => {
    if (!state.pczt) {
      setState(s => ({ ...s, error: 'No PCZT to sign' }));
      return false;
    }

    if (!externalSignerRef.current) {
      setState(s => ({ ...s, error: 'No external signer configured' }));
      return false;
    }

    setState(s => ({ ...s, loading: true, step: 'signing', error: null }));

    try {
      // Simulate signing with external signer
      await new Promise(resolve => setTimeout(resolve, 2000));
      setState(s => ({ ...s, loading: false }));
      return true;
    } catch (err) {
      const message = err instanceof PcztError ? err.message : 'Signing failed';
      setState(s => ({ ...s, loading: false, error: message, step: 'error' }));
      return false;
    }
  }, [state.pczt]);

  const applySignature = useCallback(async (
    inputIndex: number,
    signature: TransparentSignature,
  ): Promise<boolean> => {
    if (!state.pczt) {
      setState(s => ({ ...s, error: 'No PCZT to sign' }));
      return false;
    }

    setState(s => ({ ...s, loading: true, error: null }));

    try {
      // Simulate signature application
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log(`[PCZT] Applied signature for input ${inputIndex}:`, {
        signatureLength: signature.signature.length,
        publicKeyLength: signature.publicKey.length,
      });
      setState(s => ({ ...s, loading: false }));
      return true;
    } catch (err) {
      const message = err instanceof PcztError ? err.message : 'Failed to apply signature';
      setState(s => ({ ...s, loading: false, error: message }));
      return false;
    }
  }, [state.pczt]);

  const prove = useCallback(async (): Promise<boolean> => {
    if (!state.pczt) {
      setState(s => ({ ...s, error: 'No PCZT to prove' }));
      return false;
    }

    if (!state.pczt.hasOrchard) {
      return true;
    }

    setState(s => ({ 
      ...s, 
      loading: true, 
      step: 'proving', 
      error: null,
      proverProgress: { phase: 'loading', progress: 0 },
    }));

    try {
      // Simulate proving phases
      const phases: ProverProgress['phase'][] = ['loading', 'preparing', 'proving', 'verifying', 'complete'];
      for (let i = 0; i < phases.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 800));
        setState(s => ({
          ...s,
          proverProgress: {
            phase: phases[i],
            progress: Math.min(100, (i + 1) * 25),
          },
        }));
      }

      setState(s => ({
        ...s,
        loading: false,
        proverProgress: { phase: 'complete', progress: 100 },
      }));

      return true;
    } catch (err) {
      const message = err instanceof PcztError ? err.message : 'Proof generation failed';
      setState(s => ({ 
        ...s, 
        loading: false, 
        error: message,
        step: 'error',
        proverProgress: null,
      }));
      return false;
    }
  }, [state.pczt]);

  const finalize = useCallback(async (): Promise<TransactionBytes | null> => {
    if (!state.pczt) {
      setState(s => ({ ...s, error: 'No PCZT to finalize' }));
      return null;
    }

    setState(s => ({ ...s, loading: true, step: 'finalizing', error: null }));

    try {
      // Simulate finalization
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Generate mock transaction
      const txBytes = crypto.getRandomValues(new Uint8Array(512));
      const txidBytes = crypto.getRandomValues(new Uint8Array(32));
      const txid = Array.from(txidBytes).map(b => b.toString(16).padStart(2, '0')).join('');

      const tx: TransactionBytes = {
        bytes: txBytes,
        txid,
      };

      setState(s => ({
        ...s,
        transaction: tx,
        step: 'complete',
        loading: false,
      }));

      return tx;
    } catch (err) {
      const message = err instanceof PcztError ? err.message : 'Finalization failed';
      setState(s => ({ 
        ...s, 
        loading: false, 
        error: message,
        step: 'error',
      }));
      return null;
    }
  }, [state.pczt]);

  const executeFullFlow = useCallback(async (): Promise<TransactionBytes | null> => {
    const proposed = await propose();
    if (!proposed) return null;

    if (externalSignerRef.current) {
      const signed = await signWithExternalSigner();
      if (!signed) return null;
    }

    const proven = await prove();
    if (!proven) return null;

    return finalize();
  }, [propose, signWithExternalSigner, prove, finalize]);

  const reset = useCallback(() => {
    setState({ ...initialState, wasmReady: state.wasmReady });
  }, [state.wasmReady]);

  const importPczt = useCallback(async (bytes: Uint8Array): Promise<boolean> => {
    if (!state.wasmReady) {
      const ready = await initWasm();
      if (!ready) return false;
    }

    try {
      // Mock import
      const pczt: Pczt = {
        transparentInputCount: 1,
        transparentOutputCount: 2,
        hasOrchard: true,
        orchardActionCount: 1,
        serialize: () => bytes,
        toJSON: () => ({ imported: true }),
      };
      setState(s => ({
        ...s,
        pczt,
        pcztBytes: bytes,
        step: 'proposed',
      }));
      return true;
    } catch (err) {
      const message = err instanceof PcztError ? err.message : 'Failed to import PCZT';
      setState(s => ({ ...s, error: message }));
      return false;
    }
  }, [state.wasmReady, initWasm]);

  const exportPczt = useCallback((): Uint8Array | null => {
    return state.pcztBytes;
  }, [state.pcztBytes]);

  const verify = useCallback(() => {
    if (!state.pczt || !state.paymentRequest) {
      return { valid: false, checks: [], warnings: ['No PCZT or payment request'] };
    }
    return { valid: true, checks: [], warnings: [] };
  }, [state.pczt, state.paymentRequest]);

  const getSummary = useCallback(() => {
    if (!state.pczt) return null;
    return {
      inputCount: state.pczt.transparentInputCount,
      outputCount: state.pczt.transparentOutputCount,
      hasOrchard: state.pczt.hasOrchard,
      orchardActionCount: state.pczt.orchardActionCount,
    };
  }, [state.pczt]);

  return {
    state,
    initWasm,
    setNetwork,
    addInput,
    removeInput,
    clearInputs,
    setPaymentRequest,
    parsePaymentUri,
    propose,
    setExternalSigner,
    signWithExternalSigner,
    applySignature,
    prove,
    finalize,
    executeFullFlow,
    importPczt,
    exportPczt,
    verify,
    getSummary,
    reset,
    createTransparentInput,
    createPayment,
    createPaymentRequest,
    zatoshisToZec,
    zecToZatoshis,
    isTransparentAddress,
    isOrchardAddress,
    estimateFee,
  };
}
