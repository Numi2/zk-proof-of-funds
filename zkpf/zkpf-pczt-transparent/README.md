# PCZT Transparent-to-Shielded Library

A Rust/WASM library that enables transparent-only Zcash wallets to send transactions to shielded (Orchard) recipients using the PCZT (Partially Constructed Zcash Transaction) format defined in [ZIP 374](https://zips.z.cash/zip-0374).

## Overview

This library allows Bitcoin-derived, transparent-only Zcash wallets to create transactions that send to Orchard shielded addresses while using only transparent inputs. The API is designed around the PCZT format which allows separation of transaction construction, proving, signing, and finalization.

## API

### Core Functions

| Function | Roles | Description |
|----------|-------|-------------|
| `propose_transaction` | Creator, Constructor, IO Finalizer | Create a PCZT from transparent inputs and payment request |
| `prove_transaction` | Prover | Add Orchard proofs to the PCZT (MUST use Rust/WASM) |
| `get_sighash` | Signer | Get ZIP 244 signature hash for a transparent input |
| `append_signature` | Signer | Apply a signature to a transparent input |
| `verify_before_signing` | - | Verify PCZT matches original intent before signing |
| `combine` | Combiner | Merge multiple PCZTs of the same transaction |
| `finalize_and_extract` | Spend Finalizer, TX Extractor | Extract final transaction bytes |
| `parse_pczt` | - | Parse PCZT from bytes |
| `serialize_pczt` | - | Serialize PCZT to bytes |

### Workflow

```
propose_transaction → prove_transaction → get_sighash/append_signature → finalize_and_extract
                                        ↓
                             (optionally) verify_before_signing
```

## Usage

### Rust

```rust
use zkpf_pczt_transparent::*;

// 1. Create the proposal
let inputs = vec![
    TransparentInput::new(
        "abc123...".to_string(),  // txid
        0,                         // vout
        100_000,                   // value in zatoshis
        "76a914...88ac".to_string(), // scriptPubKey
    ),
];

let request = PaymentRequest::new(vec![
    Payment::new("u1...".to_string(), 50_000), // Unified address with Orchard
]);

let pczt = propose_transaction(inputs, request, Network::Mainnet, None)?;

// 2. Add proofs (for Orchard outputs)
let proven_pczt = prove_transaction(pczt)?;

// 3. Sign each transparent input
for i in 0..inputs.len() {
    let sighash = get_sighash(&proven_pczt, i)?;
    // Sign with your signing infrastructure
    let signature = my_wallet.sign(&sighash.hash)?;
    let signed_pczt = append_signature(proven_pczt, i, signature)?;
}

// 4. Finalize and extract
let tx = finalize_and_extract(signed_pczt)?;

// 5. Broadcast
broadcast(&tx.bytes)?;
println!("Transaction ID: {}", tx.txid);
```

### TypeScript

```typescript
import {
  proposeTransaction,
  proveTransaction,
  getSighash,
  appendSignature,
  finalizeAndExtract,
  createTransparentInput,
  createPaymentRequest,
  createPayment,
  Network,
} from '@zkpf/pczt-transparent';

// 1. Create the proposal
const inputs = [
  createTransparentInput(
    'abc123...',      // txid
    0,                // vout
    100000n,          // value in zatoshis
    '76a914...88ac',  // scriptPubKey
    "m/44'/133'/0'/0/0", // derivation path
    '03abc...',       // public key
  ),
];

const request = createPaymentRequest([
  createPayment('u1...', 50000n), // Unified address with Orchard
]);

const pczt = await proposeTransaction(inputs, request, Network.Mainnet);

// 2. Add proofs (with progress callback)
const provenPczt = await proveTransaction(pczt, (progress) => {
  console.log(`Proving: ${progress.progress}%`);
});

// 3. Sign each input
let signedPczt = provenPczt;
for (let i = 0; i < inputs.length; i++) {
  const sighash = await getSighash(signedPczt, i);
  
  // Sign with your signing infrastructure (hardware wallet, etc.)
  const signature = await myHardwareWallet.sign(sighash.hash);
  const publicKey = await myHardwareWallet.getPublicKey();
  
  signedPczt = await appendSignature(signedPczt, i, { signature, publicKey });
}

// 4. Finalize and extract
const tx = await finalizeAndExtract(signedPczt);

// 5. Broadcast
await broadcast(tx.bytes);
console.log('Transaction ID:', tx.txid);
```

## ZIP 321 Support

Parse ZIP 321 payment URIs:

```typescript
import { parseZip321Uri } from '@zkpf/pczt-transparent';

const request = parseZip321Uri('zcash:u1abc123?amount=1.5&memo=Thanks!');
console.log(request.payments[0].amount); // 150000000n (1.5 ZEC in zatoshis)
```

## Hardware Wallet Integration

```typescript
import { signAllInputs, ExternalSigner } from '@zkpf/pczt-transparent';

// Implement the ExternalSigner interface for your hardware wallet
const ledgerSigner: ExternalSigner = {
  sign: async (hash, derivationPath) => {
    return ledger.signHash(derivationPath, hash);
  },
  getPublicKey: async (derivationPath) => {
    return ledger.getPublicKey(derivationPath);
  },
};

// Sign all inputs at once
const signedPczt = await signAllInputs(pczt, inputs, ledgerSigner);
```

## Web Worker Support

For non-blocking proof generation in web applications:

```typescript
import { proveInWorker, serializePczt, parsePczt } from '@zkpf/pczt-transparent';

const pcztBytes = serializePczt(pczt);

const provenBytes = await proveInWorker(pcztBytes, (progress) => {
  updateProgressBar(progress.progress);
});

const provenPczt = await parsePczt(provenBytes);
```

## Building

### Rust

```bash
cargo build --release
```

### WASM

```bash
wasm-pack build --target web --release
```

## Requirements

- Rust 1.70+
- For WASM: wasm-pack, wasm-bindgen

## Security Considerations

1. **Proving MUST be done in Rust/WASM** - The Orchard proving algorithm cannot be feasibly implemented in JavaScript.

2. **Verify before signing** - If the PCZT came from an untrusted source, always call `verify_before_signing` before signing.

3. **Fee verification** - The library enforces ZIP 317 fee rules to prevent fee manipulation attacks.

## License

MIT

