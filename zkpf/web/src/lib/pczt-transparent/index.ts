/**
 * PCZT Transparent-to-Shielded Library
 *
 * This library enables transparent-only Zcash wallets to send transactions
 * to shielded (Orchard) recipients using the PCZT (Partially Constructed
 * Zcash Transaction) format defined in ZIP 374.
 *
 * ## Overview
 *
 * The PCZT format allows separation of transaction construction, proving,
 * signing, and finalization - enabling flexible workflows where different
 * parties or systems can handle different parts of the process.
 *
 * ## Workflow
 *
 * ```typescript
 * // 1. Propose the transaction
 * const pczt = await proposeTransaction(inputs, request, network);
 *
 * // 2. Get sighash and sign (can be done externally)
 * const sighash = await getSighash(pczt, 0);
 * const signature = await myWallet.sign(sighash);
 *
 * // 3. Apply signature and prove (proving in parallel if desired)
 * const signedPczt = await appendSignature(pczt, 0, signature);
 * const provenPczt = await proveTransaction(signedPczt);
 *
 * // 4. Finalize and extract
 * const tx = await finalizeAndExtract(provenPczt);
 * await broadcast(tx.bytes);
 * ```
 *
 * @packageDocumentation
 */

export * from './types';
export * from './pczt';
export * from './proposal';
export * from './prover';
export * from './signer';
export * from './verifier';

// Re-export commonly used types at top level
export type {
  TransparentInput,
  Payment,
  PaymentRequest,
  SigHash,
  TransactionBytes,
  ExpectedChange,
  Network,
} from './types';

export {
  proposeTransaction,
  proveTransaction,
  getSighash,
  appendSignature,
  verifyBeforeSigning,
  combine,
  finalizeAndExtract,
  parsePczt,
  serializePczt,
} from './pczt';

