/**
 * Ledger Hardware Wallet Integration Example
 *
 * This example demonstrates how to use the @zkpf/pczt-transparent library
 * with a Ledger hardware wallet to send transparent ZEC to shielded (Orchard)
 * recipients.
 *
 * Prerequisites:
 * - Ledger device with Zcash app installed
 * - @ledgerhq/hw-transport-webusb or @ledgerhq/hw-transport-node-hid
 *
 * The flow:
 * 1. Create PCZT with transparent inputs and shielded outputs
 * 2. Generate Orchard proofs (in WASM)
 * 3. Sign transparent inputs with Ledger
 * 4. Finalize and broadcast transaction
 *
 * Security note: The Ledger signs sighashes but never sees the full transaction.
 * Orchard proofs are generated locally/in WASM, then combined with Ledger signatures.
 */

import {
  proposeTransaction,
  proveTransaction,
  getSighash,
  appendSignature,
  finalizeAndExtract,
  WasmTransparentInput,
  WasmPayment,
  WasmPaymentRequest,
  WasmPczt,
  WasmNetwork,
  ExternalSigner,
} from '@zkpf/pczt-transparent';

// ═══════════════════════════════════════════════════════════════════════════════
// LEDGER TRANSPORT SETUP
// ═══════════════════════════════════════════════════════════════════════════════

// For browser (WebUSB)
// import TransportWebUSB from '@ledgerhq/hw-transport-webusb';

// For Node.js
// import TransportNodeHid from '@ledgerhq/hw-transport-node-hid';

interface LedgerTransport {
  send(cla: number, ins: number, p1: number, p2: number, data?: Buffer): Promise<Buffer>;
  close(): Promise<void>;
}

// Zcash app CLA and INS codes
const ZCASH_CLA = 0x85;
const INS_GET_PUBLIC_KEY = 0x02;
const INS_SIGN_HASH = 0x04;

/**
 * Create a Ledger transport for the Zcash app.
 */
async function createLedgerTransport(): Promise<LedgerTransport> {
  // Browser: Use WebUSB
  // const transport = await TransportWebUSB.create();

  // Node.js: Use HID
  // const transport = await TransportNodeHid.create();

  // Placeholder for demo - in production, use one of the above
  throw new Error(
    'Please install @ledgerhq/hw-transport-webusb or @ledgerhq/hw-transport-node-hid'
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEDGER ZCASH APP INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Ledger Zcash app interface.
 *
 * This wraps the low-level APDU commands for the Zcash Ledger app.
 */
class LedgerZcash {
  constructor(private transport: LedgerTransport) {}

  /**
   * Parse a BIP32 path to bytes.
   */
  private pathToBytes(path: string): Buffer {
    const parts = path.replace(/^m\//, '').split('/');
    const buf = Buffer.alloc(1 + parts.length * 4);
    buf.writeUInt8(parts.length, 0);

    for (let i = 0; i < parts.length; i++) {
      const hardened = parts[i].endsWith("'") || parts[i].endsWith('h');
      let value = parseInt(parts[i].replace(/['h]/g, ''), 10);
      if (hardened) {
        value += 0x80000000;
      }
      buf.writeUInt32BE(value, 1 + i * 4);
    }

    return buf;
  }

  /**
   * Get the public key at the given derivation path.
   *
   * @param path - BIP32 derivation path (e.g., "m/44'/133'/0'/0/0")
   * @returns Compressed public key (33 bytes)
   */
  async getPublicKey(path: string): Promise<Buffer> {
    const pathBytes = this.pathToBytes(path);

    const response = await this.transport.send(
      ZCASH_CLA,
      INS_GET_PUBLIC_KEY,
      0x00, // Don't display on device
      0x00, // Return compressed key
      pathBytes
    );

    // Response format: [pubkey_len, pubkey..., chain_code...]
    const pubkeyLen = response[0];
    const pubkey = response.slice(1, 1 + pubkeyLen);

    return pubkey;
  }

  /**
   * Sign a 32-byte hash.
   *
   * @param path - BIP32 derivation path
   * @param hash - 32-byte hash to sign
   * @returns DER-encoded signature
   */
  async signHash(path: string, hash: Buffer): Promise<Buffer> {
    if (hash.length !== 32) {
      throw new Error(`Hash must be 32 bytes, got ${hash.length}`);
    }

    const pathBytes = this.pathToBytes(path);
    const data = Buffer.concat([pathBytes, hash]);

    const response = await this.transport.send(
      ZCASH_CLA,
      INS_SIGN_HASH,
      0x00,
      0x00,
      data
    );

    // Response is DER-encoded signature
    // Remove status bytes (last 2 bytes)
    return response.slice(0, -2);
  }

  /**
   * Close the transport connection.
   */
  async close(): Promise<void> {
    await this.transport.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXTERNAL SIGNER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create an ExternalSigner that uses a Ledger device.
 */
function createLedgerSigner(ledger: LedgerZcash): ExternalSigner {
  return {
    async sign(hash: Uint8Array, derivationPath: string): Promise<Uint8Array> {
      const signature = await ledger.signHash(derivationPath, Buffer.from(hash));
      return new Uint8Array(signature);
    },

    async getPublicKey(derivationPath: string): Promise<Uint8Array> {
      const pubkey = await ledger.getPublicKey(derivationPath);
      return new Uint8Array(pubkey);
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: SIGN ALL INPUTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sign all transparent inputs in a PCZT using an external signer.
 *
 * This is the main integration point for hardware wallets.
 */
async function signAllInputsWithLedger(
  pczt: WasmPczt,
  inputs: Array<{ derivationPath: string }>,
  signer: ExternalSigner
): Promise<WasmPczt> {
  let signedPczt = pczt;

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];

    if (!input.derivationPath) {
      throw new Error(`Input ${i} missing derivation path`);
    }

    // Get the sighash for this input
    const sighash = getSighash(signedPczt, i);

    // Get public key from Ledger
    const publicKey = await signer.getPublicKey(input.derivationPath);

    // Sign with Ledger
    const signature = await signer.sign(sighash.hash(), input.derivationPath);

    // Convert to hex
    const signatureHex = Buffer.from(signature).toString('hex');
    const publicKeyHex = Buffer.from(publicKey).toString('hex');

    // Append signature to PCZT
    signedPczt = appendSignature(signedPczt, i, signatureHex, publicKeyHex);

    console.log(`✓ Signed input ${i} with path ${input.derivationPath}`);
  }

  return signedPczt;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXAMPLE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Example: Send transparent ZEC to a shielded (Orchard) address using Ledger.
 */
async function sendToShieldedWithLedger() {
  console.log('='.repeat(60));
  console.log('Ledger → Shielded (Orchard) Transaction');
  console.log('='.repeat(60));

  // Connect to Ledger
  console.log('\n1. Connecting to Ledger...');
  const transport = await createLedgerTransport();
  const ledger = new LedgerZcash(transport);
  const signer = createLedgerSigner(ledger);

  try {
    // Get public key for our input
    const derivationPath = "m/44'/133'/0'/0/0";
    const publicKey = await signer.getPublicKey(derivationPath);
    console.log(`   Public key: ${Buffer.from(publicKey).toString('hex').slice(0, 16)}...`);

    // Define the transparent UTXO to spend
    // In production, you'd get this from a wallet or block explorer
    console.log('\n2. Preparing transaction...');
    const input = new WasmTransparentInput(
      // Transaction ID of the UTXO (example)
      'a'.repeat(64),
      0, // Output index
      BigInt(100000), // 0.001 ZEC in zatoshis
      '76a914' + '00'.repeat(20) + '88ac', // P2PKH scriptPubKey (example)
    ).with_derivation(derivationPath, Buffer.from(publicKey).toString('hex'));

    // Define the shielded recipient (unified address with Orchard receiver)
    const payment = new WasmPayment(
      'u1abc123...', // Replace with actual unified address
      BigInt(50000), // 0.0005 ZEC
    );

    const request = new WasmPaymentRequest([payment]);
    console.log(`   Sending ${request.total_amount()} zatoshis to shielded address`);

    // Create the PCZT
    console.log('\n3. Creating PCZT...');
    const pczt = proposeTransaction(
      [input],
      request,
      WasmNetwork.Mainnet,
    );
    console.log(`   Created PCZT with ${pczt.transparent_input_count()} input(s)`);

    // Add Orchard proofs (this is the slow part)
    console.log('\n4. Generating Orchard proofs (this may take 30-60 seconds)...');
    const startProve = Date.now();
    const provenPczt = proveTransaction(pczt);
    console.log(`   Proofs generated in ${((Date.now() - startProve) / 1000).toFixed(1)}s`);
    console.log(`   Has Orchard bundle: ${provenPczt.has_orchard()}`);

    // Sign with Ledger
    console.log('\n5. Signing with Ledger...');
    console.log('   Please confirm on your device');
    const signedPczt = await signAllInputsWithLedger(
      provenPczt,
      [{ derivationPath }],
      signer
    );

    // Finalize and extract
    console.log('\n6. Finalizing transaction...');
    const tx = finalizeAndExtract(signedPczt);
    console.log(`   Transaction ID: ${tx.txid}`);
    console.log(`   Size: ${tx.bytes().length} bytes`);
    console.log(`   Hex: ${tx.to_hex().slice(0, 64)}...`);

    // In production, broadcast via lightwalletd or full node
    console.log('\n7. Ready to broadcast!');
    console.log('   Use lightwalletd SendTransaction RPC with tx.bytes()');

    console.log('\n' + '='.repeat(60));
    console.log('SUCCESS! Transaction ready for broadcast.');
    console.log('='.repeat(60));

    return tx;

  } finally {
    await ledger.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMULATED EXAMPLE (NO HARDWARE REQUIRED)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Simulated example that doesn't require actual hardware.
 *
 * This demonstrates the flow without connecting to a real Ledger.
 */
async function simulatedExample() {
  console.log('='.repeat(60));
  console.log('Simulated Ledger → Shielded Transaction (No Hardware)');
  console.log('='.repeat(60));

  // Create a mock signer
  const mockSigner: ExternalSigner = {
    async sign(hash: Uint8Array, _derivationPath: string): Promise<Uint8Array> {
      // Return a fake signature (in production, this would be from Ledger)
      console.log(`   [MOCK] Signing hash: ${Buffer.from(hash).toString('hex').slice(0, 16)}...`);
      return new Uint8Array(71).fill(0x30); // Fake DER signature
    },

    async getPublicKey(_derivationPath: string): Promise<Uint8Array> {
      // Return a fake public key
      const pk = new Uint8Array(33);
      pk[0] = 0x03; // Compressed key prefix
      return pk;
    },
  };

  console.log('\n1. Creating transparent input...');
  const input = new WasmTransparentInput(
    'a'.repeat(64),
    0,
    BigInt(100000),
    '76a914' + '00'.repeat(20) + '88ac',
  );

  console.log('\n2. Creating payment to shielded address...');
  const payment = new WasmPayment('u1test...', BigInt(50000));
  const request = new WasmPaymentRequest([payment]);

  console.log('\n3. Proposing transaction...');
  try {
    const pczt = proposeTransaction([input], request, WasmNetwork.Testnet);
    console.log(`   PCZT created with ${pczt.transparent_input_count()} input(s)`);

    // Note: In a real scenario, proveTransaction would work
    // Here it may fail since we don't have real Orchard setup
    console.log('\n4. Proof generation would happen here...');
    console.log('   (Skipping in simulation mode)');

    console.log('\n5. Signature flow demonstration...');
    const sighash = getSighash(pczt, 0);
    console.log(`   Sighash: ${sighash.to_hex().slice(0, 32)}...`);

    const sig = await mockSigner.sign(sighash.hash(), "m/44'/133'/0'/0/0");
    const pk = await mockSigner.getPublicKey("m/44'/133'/0'/0/0");
    console.log(`   Got signature (${sig.length} bytes) and pubkey (${pk.length} bytes)`);

    console.log('\n' + '='.repeat(60));
    console.log('SIMULATION COMPLETE');
    console.log('='.repeat(60));

  } catch (error) {
    console.log('\n⚠️  Expected error in simulation mode:');
    console.log(`   ${error}`);
    console.log('\nThis is normal - full functionality requires the WASM module.');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS & MAIN
// ═══════════════════════════════════════════════════════════════════════════════

export {
  LedgerZcash,
  createLedgerSigner,
  signAllInputsWithLedger,
  sendToShieldedWithLedger,
  simulatedExample,
};

// Run simulated example if executed directly
if (typeof require !== 'undefined' && require.main === module) {
  simulatedExample().catch(console.error);
}

