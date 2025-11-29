# @zkpf/pczt-transparent

**PCZT library for transparent-only wallets sending to shielded (Orchard) recipients.**

[![npm version](https://img.shields.io/npm/v/@zkpf/pczt-transparent.svg)](https://www.npmjs.com/package/@zkpf/pczt-transparent)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

This library implements the [PCZT (Partially Constructed Zcash Transaction)](https://zips.z.cash/zip-0374) format defined in ZIP 374, enabling Bitcoin-derived transparent-only Zcash wallets to send transactions to shielded (Orchard) addresses.

## Features

- ✅ **ZIP 374 Compliant** - Full PCZT format support
- ✅ **Hardware Wallet Ready** - Separation of roles for Ledger/Trezor integration
- ✅ **Web & Node.js** - Works in browsers and Node.js
- ✅ **Web Worker Support** - Non-blocking proof generation
- ✅ **ZIP 317 Fees** - Standard fee calculation

## Installation

```bash
npm install @zkpf/pczt-transparent
# or
yarn add @zkpf/pczt-transparent
# or
pnpm add @zkpf/pczt-transparent
```

## Quick Start

```typescript
import {
  proposeTransaction,
  proveTransaction,
  getSighash,
  appendSignature,
  finalizeAndExtract,
  WasmTransparentInput,
  WasmPayment,
  WasmPaymentRequest,
  WasmNetwork,
} from '@zkpf/pczt-transparent';

// 1. Create inputs and payment request
const input = new WasmTransparentInput(
  'abc123...', // txid (32 bytes hex)
  0,           // vout
  100000n,     // value in zatoshis
  '76a914...88ac', // scriptPubKey
).with_derivation("m/44'/133'/0'/0/0", '03abc...');

const payment = new WasmPayment('u1...', 50000n); // Unified address
const request = new WasmPaymentRequest([payment]);

// 2. Propose transaction
const pczt = proposeTransaction([input], request, WasmNetwork.Mainnet);

// 3. Add Orchard proofs (MUST be done in WASM - takes 30-60 seconds)
const provenPczt = proveTransaction(pczt);

// 4. Sign transparent inputs (with hardware wallet or software key)
const sighash = getSighash(provenPczt, 0);
const signature = await myWallet.sign(sighash.hash()); // Your signing logic
const publicKey = await myWallet.getPublicKey();
const signedPczt = appendSignature(
  provenPczt,
  0,
  signatureToHex(signature),
  publicKeyToHex(publicKey),
);

// 5. Finalize and broadcast
const tx = finalizeAndExtract(signedPczt);
console.log('Transaction ID:', tx.txid);
await broadcast(tx.bytes());
```

## Hardware Wallet Integration

### Ledger Example

```typescript
import { signAllInputs } from '@zkpf/pczt-transparent/helpers';

// Implement ExternalSigner for your hardware wallet
const ledgerSigner = {
  async sign(hash: Uint8Array, derivationPath: string): Promise<Uint8Array> {
    return await ledger.signHash(derivationPath, hash);
  },
  async getPublicKey(derivationPath: string): Promise<Uint8Array> {
    return await ledger.getPublicKey(derivationPath);
  },
};

// Sign all inputs at once
const signedPczt = await signAllInputs(provenPczt, inputs, ledgerSigner);
const tx = finalizeAndExtract(signedPczt);
```

### Trezor Example

```typescript
const trezorSigner = {
  async sign(hash: Uint8Array, derivationPath: string): Promise<Uint8Array> {
    const result = await TrezorConnect.signMessage({
      path: derivationPath,
      message: Buffer.from(hash).toString('hex'),
      coin: 'zcash',
    });
    return hexToBytes(result.payload.signature);
  },
  async getPublicKey(derivationPath: string): Promise<Uint8Array> {
    const result = await TrezorConnect.getPublicKey({
      path: derivationPath,
      coin: 'zcash',
    });
    return hexToBytes(result.payload.publicKey);
  },
};
```

## Web Worker Support

For non-blocking proof generation in web applications:

```typescript
import { proveInWorker, serializePczt, parsePczt } from '@zkpf/pczt-transparent';

// Serialize PCZT
const pcztBytes = serializePczt(pczt);

// Prove in worker (won't block main thread)
const provenBytes = await proveInWorker(pcztBytes, (progress) => {
  console.log(`${progress.phase}: ${progress.progress}%`);
  updateProgressBar(progress.progress);
});

// Parse result
const provenPczt = parsePczt(provenBytes);
```

## API Reference

### Transaction Creation

| Function | Role | Description |
|----------|------|-------------|
| `proposeTransaction` | Creator, Constructor, IO Finalizer | Create PCZT from inputs and payment request |
| `proveTransaction` | Prover | Add Orchard proofs (**MUST use WASM**) |
| `getSighash` | Signer | Get ZIP 244 sighash for transparent input |
| `appendSignature` | Signer | Apply signature to transparent input |
| `verifyBeforeSigning` | - | Verify PCZT matches original intent |
| `combine` | Combiner | Merge multiple PCZTs of same transaction |
| `finalizeAndExtract` | Spend Finalizer, TX Extractor | Extract final transaction bytes |

### Serialization

| Function | Description |
|----------|-------------|
| `parsePczt` | Parse PCZT from bytes |
| `serializePczt` | Serialize PCZT to bytes |

### Helper Functions

| Function | Description |
|----------|-------------|
| `signAllInputs` | Sign all inputs with an ExternalSigner |
| `proveInWorker` | Non-blocking proof generation |
| `getAllSighashes` | Get sighashes for all inputs at once |
| `estimateFee` | ZIP 317 fee estimation |

## Workflow

```
proposeTransaction → proveTransaction → getSighash/appendSignature → finalizeAndExtract
                                      ↓
                           (optionally) verifyBeforeSigning
```

## Security Considerations

1. **Proving MUST be done in Rust/WASM** - The Orchard proving algorithm cannot be feasibly implemented in JavaScript.

2. **Verify before signing** - If the PCZT came from an untrusted source, always call `verifyBeforeSigning` before signing.

3. **ZIP 317 fees** - The library enforces ZIP 317 fee rules to prevent fee manipulation attacks.

4. **Hardware wallet confirmation** - Users should always confirm transaction details on their hardware wallet display.

## Requirements

- **Browser**: Modern browsers with WebAssembly support (Chrome 57+, Firefox 53+, Safari 11+, Edge 16+)
- **Node.js**: 16.0.0 or higher
- **Hardware wallets**: Ledger or Trezor with Zcash app

## Building from Source

```bash
# Install wasm-pack
cargo install wasm-pack

# Build WASM
cd zkpf/zkpf-pczt-transparent
wasm-pack build --target web --release

# Package includes TypeScript definitions
```

## Related

- [ZIP 374: Partially Constructed Zcash Transactions](https://zips.z.cash/zip-0374)
- [ZIP 317: Proportional Transfer Fee Mechanism](https://zips.z.cash/zip-0317)
- [ZIP 244: Transaction Identifier Non-Malleability](https://zips.z.cash/zip-0244)
- [ZIP 321: Payment Request URIs](https://zips.z.cash/zip-0321)

## License

MIT

