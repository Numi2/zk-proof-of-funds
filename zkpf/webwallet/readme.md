# WebWallet API Documentation

## Table of Contents

1. [Overview](#overview)
2. [WebWallet Class](#webwallet-class)
3. [Account Management](#account-management)
4. [Synchronization](#synchronization)
5. [Transaction Operations](#transaction-operations)
6. [PCZT Operations](#pczt-operations)
7. [Address Operations](#address-operations)
8. [Network Operations](#network-operations)
9. [Internal Wallet Implementation](#internal-wallet-implementation)
10. [Constants](#constants)

---

## Overview

### Definition

The `WebWallet` class is the primary interface for interacting with Zcash wallets in a web browser environment. It provides a complete implementation for managing Zcash accounts, synchronizing with the blockchain, and creating transactions.

### Core Concepts

1. **Wallet**: A container for multiple accounts that share synchronization state
2. **Account**: A single Zcash account derived from a seed phrase or UFVK
3. **Synchronization**: The process of downloading and scanning blockchain blocks to determine account balances
4. **Transaction Proposal**: A plan describing which notes will be spent to fulfill a transfer request
5. **PCZT**: Partially Constructed Zcash Transaction - a transaction that can be constructed, signed, and proven in separate steps

### Architecture Constraints

- **Single Instance**: Only one `WebWallet` instance should be created per web page
- **WebWorker Execution**: Long-running operations (sync, proving) execute in WebWorkers to prevent main thread blocking
- **Thread Safety**: Wallet methods may block during synchronization while waiting for write locks

---

## WebWallet Class

### Constructor: `new`

#### Purpose

Creates a new `WebWallet` instance for a specified Zcash network.

#### Signature

```typescript
new WebWallet(
  network: string,
  lightwalletd_url: string,
  min_confirmations: number,
  db_bytes?: Uint8Array
): WebWallet
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `network` | `string` | Yes | Network identifier. Must be exactly `"main"` or `"test"` |
| `lightwalletd_url` | `string` | Yes | Complete URL of the lightwalletd server instance. Example: `"https://zcash-mainnet.chainsafe.dev"` |
| `min_confirmations` | `number` | Yes | Minimum number of block confirmations required before a transaction is considered final. Must be a positive integer |
| `db_bytes` | `Uint8Array` | No | Serialized wallet database from a previous session. If provided, the wallet state will be restored from these bytes |

#### Return Value

Returns a `WebWallet` instance on success. Throws an error if:
- Network string is invalid
- `min_confirmations` is zero
- `db_bytes` is provided but cannot be deserialized

#### Example

```javascript
const wallet = new WebWallet(
  "main",
  "https://zcash-mainnet.chainsafe.dev",
  10
);
```

#### State Restoration Example

```javascript
const savedDbBytes = localStorage.getItem('wallet_db');
const wallet = new WebWallet(
  "main",
  "https://zcash-mainnet.chainsafe.dev",
  10,
  savedDbBytes ? new Uint8Array(JSON.parse(savedDbBytes)) : undefined
);
```

---

## Account Management

### Method: `create_account`

#### Purpose

Adds a new spending account to the wallet using a mnemonic seed phrase.

#### Signature

```typescript
create_account(
  account_name: string,
  seed_phrase: string,
  account_hd_index: number,
  birthday_height?: number
): Promise<number>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `account_name` | `string` | Yes | Human-readable identifier for the account |
| `seed_phrase` | `string` | Yes | 24-word mnemonic seed phrase in BIP39 format |
| `account_hd_index` | `number` | Yes | ZIP-32 hierarchical deterministic account index. Must be a non-negative integer |
| `birthday_height` | `number` | No | Block height at which the account was created. If omitted, sync will scan from genesis block (very slow) |

#### Return Value

Returns a `Promise` that resolves to the account ID (a `number`) on success.

#### Behavior

1. Derives a Unified Spending Key (USK) from the seed phrase and account index
2. Computes the Unified Full Viewing Key (UFVK) from the USK
3. Imports the account into the wallet database
4. Returns the assigned account ID

#### Performance Note

Providing `birthday_height` is **critical** for performance. Without it, the wallet must scan the entire blockchain history, which can take hours or days. With a correct birthday height, initial sync typically completes in minutes.

#### Example

```javascript
const accountId = await wallet.create_account(
  "new Account",
  "po",
  0,
  212366212345  // Account created at block
);
```

### Method: `create_account_ufvk`

#### Purpose

Adds a new spending account to the wallet by importing a Unified Full Viewing Key (UFVK).

#### Signature

```typescript
create_account_ufvk(
  account_name: string,
  encoded_ufvk: string,
  seed_fingerprint: SeedFingerprint,
  account_hd_index: number,
  birthday_height?: number
): Promise<number>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `account_name` | `string` | Yes | Human-readable identifier for the account |
| `encoded_ufvk` | `string` | Yes | ZIP-316 encoded Unified Full Viewing Key string |
| `seed_fingerprint` | `SeedFingerprint` | Yes | Fingerprint of the seed phrase that generated this key |
| `account_hd_index` | `number` | Yes | ZIP-32 hierarchical deterministic account index |
| `birthday_height` | `number` | No | Block height at which the account was created |

#### Return Value

Returns a `Promise` that resolves to the account ID on success.

#### Important Constraint

**CRITICAL**: To create transactions from this account, you must have access to the corresponding Unified Spending Key (USK). The UFVK alone cannot sign transactions.

#### Example

```javascript
const accountId = await wallet.create_account_ufvk(
  "View-Only Account",
  "uview1...",
  seedFingerprint,
  0,
  2657762
);
```

### Method: `create_account_view_ufvk`

#### Purpose

Adds a view-only account to the wallet. This account can observe balances and transactions but cannot create or sign transactions.

#### Signature

```typescript
create_account_view_ufvk(
  account_name: string,
  encoded_ufvk: string,
  birthday_height?: number
): Promise<number>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `account_name` | `string` | Yes | Human-readable identifier for the account |
| `encoded_ufvk` | `string` | Yes | ZIP-316 encoded Unified Full Viewing Key string |
| `birthday_height` | `number` | No | Block height at which the account was created |

#### Return Value

Returns a `Promise` that resolves to the account ID on success.

#### Use Cases

- Monitoring account balances without spending capability
- Auditing transactions for compliance
- Displaying balances in read-only interfaces

#### Example

```javascript
const viewOnlyAccountId = await wallet.create_account_view_ufvk(
  "Audit Account",
  "uview1...",
  2657762
);
```

---

## Synchronization

### Method: `sync`

#### Purpose

Synchronizes the wallet with the Zcash blockchain by downloading and scanning compact blocks.

#### Signature

```typescript
sync(): Promise<void>
```

#### Parameters

None.

#### Return Value

Returns a `Promise` that resolves when synchronization completes. Rejects if synchronization fails.

#### Execution Model

1. **WebWorker Spawning**: This method spawns a new WebWorker thread to execute the sync operation
2. **Main Thread**: The main thread does not block during sync
3. **Concurrent Access**: Other wallet methods may be called during sync but will block if they require write access to the wallet database
4. **Completion**: The promise resolves only after all blocks have been downloaded and scanned

#### Synchronization Strategy

The sync process:
1. Queries the wallet database to determine the highest scanned block height
2. Requests compact blocks from the lightwalletd server starting from the next unscanned block
3. Scans each block for transactions relevant to managed accounts
4. Updates account balances and transaction history
5. Continues until the wallet is synchronized with the chain tip

#### Performance Characteristics

- **Initial Sync**: Can take minutes to hours depending on account birthday height
- **Incremental Sync**: Typically completes in seconds for recent blocks
- **Network Dependency**: Requires stable connection to lightwalletd server
- **CPU Intensive**: Scanning operations are computationally expensive

#### Example

```javascript
try {
  await wallet.sync();
  console.log("Synchronization complete");
} catch (error) {
  console.error("Sync failed:", error);
}
```

---

## Transaction Operations

### Transaction Lifecycle

A complete transaction follows three distinct phases:

1. **Proposal**: Create a plan for spending notes
2. **Authorization**: Sign the transaction and generate proofs
3. **Submission**: Broadcast the transaction to the network

### Method: `propose_transfer`

#### Purpose

Creates a transaction proposal that describes how to spend notes to fulfill a transfer request.

#### Signature

```typescript
propose_transfer(
  account_id: number,
  to_address: string,
  value: number
): Promise<Proposal>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `account_id` | `number` | Yes | Account ID from which funds will be sent |
| `to_address` | `string` | Yes | ZIP-316 encoded recipient address |
| `value` | `number` | Yes | Amount to send in Zatoshis (1 ZEC = 100,000,000 Zatoshis) |

#### Return Value

Returns a `Promise` that resolves to a `Proposal` object.

#### Proposal Object Structure

The proposal contains:
- List of notes that will be spent
- Output addresses and amounts
- Change outputs (if any)
- Fee calculation
- Transaction structure metadata

#### Important Constraints

- **No Signing**: This method does NOT sign the transaction
- **No Proof Generation**: This method does NOT generate zero-knowledge proofs
- **No Network Submission**: This method does NOT send the transaction
- **Balance Verification**: The proposal will fail if the account has insufficient balance

#### User Review

The proposal should be presented to the user for review before proceeding to authorization, as it shows exactly which funds will be spent.

#### Example

```javascript
const proposal = await wallet.propose_transfer(
  1,
  "u1abc...xyz",
  100000000  // 1 ZEC
);

// Review proposal before authorizing
console.log("Proposal:", proposal);
```

### Method: `create_proposed_transactions`

#### Purpose

Generates a fully signed and proven Zcash transaction from a proposal.

#### Signature

```typescript
create_proposed_transactions(
  proposal: Proposal,
  seed_phrase: string,
  account_hd_index: number
): Promise<Uint8Array>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `proposal` | `Proposal` | Yes | Proposal object from `propose_transfer` |
| `seed_phrase` | `string` | Yes | 24-word mnemonic seed phrase. **MUST** correspond to the account used in the proposal |
| `account_hd_index` | `number` | Yes | ZIP-32 account index. **MUST** match the account used in the proposal |

#### Return Value

Returns a `Promise` that resolves to a `Uint8Array` containing transaction IDs in flattened format.

#### Transaction ID Format

- Each transaction ID is exactly 32 bytes
- Multiple transaction IDs are concatenated sequentially
- To extract individual IDs: `txids.slice(i * 32, (i + 1) * 32)` for transaction `i`

#### Execution Model

1. **WebWorker Execution**: Proving operations execute in a WebWorker thread
2. **Duration**: Proof generation can take 10-60 seconds depending on transaction complexity
3. **Parallel Processing**: Multiple proofs may be generated in parallel
4. **Storage**: Generated transactions are stored in the wallet database

#### Operations Performed

1. Derives the Unified Spending Key from the seed phrase
2. Signs all transaction inputs
3. Generates zero-knowledge proofs for shielded components (Sapling, Orchard)
4. Constructs the complete transaction
5. Stores the transaction in the wallet database
6. Returns transaction IDs

#### Critical Requirements

- The `seed_phrase` **MUST** correspond to the account that owns the notes being spent
- The `account_hd_index` **MUST** match the account ID used in `propose_transfer`
- Failure to match these will result in transaction creation failure

#### Example

```javascript
const proposal = await wallet.propose_transfer(1, "u1abc...xyz", 100000000);
const txids = await wallet.create_proposed_transactions(
  proposal,
  "abandon abandon ...",
  0  // Must match account_id from propose_transfer
);
```

### Method: `send_authorized_transactions`

#### Purpose

Broadcasts authorized transactions to the Zcash network via the connected lightwalletd server.

#### Signature

```typescript
send_authorized_transactions(txids: Uint8Array): Promise<void>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `txids` | `Uint8Array` | Yes | Flattened array of transaction IDs. Each ID is 32 bytes, concatenated sequentially |

#### Return Value

Returns a `Promise` that resolves when all transactions have been submitted. Rejects if any transaction fails to send.

#### Transaction ID Parsing

The method parses the flattened array by:
1. Splitting into 32-byte chunks
2. Converting each chunk to a transaction ID
3. Retrieving the corresponding transaction from the wallet database
4. Sending each transaction to the lightwalletd server

#### Error Handling

If any transaction fails to send:
- The method returns an error
- Previously sent transactions may already be on the network
- The error includes the error code and message from the server

#### Example

```javascript
const txids = await wallet.create_proposed_transactions(proposal, seed, index);
await wallet.send_authorized_transactions(txids);
```

### Complete Transaction Flow Example

```javascript
// Step 1: Create proposal
const proposal = await wallet.propose_transfer(
  accountId,
  recipientAddress,
  amountInZatoshis
);

// Step 2: Review proposal (user interaction)
if (!userApproves(proposal)) {
  return;
}

// Step 3: Authorize and create transactions
const txids = await wallet.create_proposed_transactions(
  proposal,
  seedPhrase,
  accountHdIndex
);

// Step 4: Send to network
await wallet.send_authorized_transactions(txids);
```

---

## PCZT Operations

### PCZT Overview

**PCZT** stands for **Partially Constructed Zcash Transaction**. It is a transaction format that allows separation of:
1. Transaction construction
2. Signing
3. Proof generation
4. Network submission

This separation enables advanced use cases such as:
- Multi-party signing
- Hardware wallet integration
- Secure signing environments
- Transaction batching

### PCZT Workflow

The complete PCZT workflow is:

```
pczt_create → pczt_sign → pczt_prove → pczt_send
```

### Method: `pczt_create`

#### Purpose

Creates a PCZT for transferring funds to a specified address.

#### Signature

```typescript
pczt_create(
  account_id: number,
  to_address: string,
  value: number
): Promise<Pczt>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `account_id` | `number` | Yes | Account ID from which funds will be sent |
| `to_address` | `string` | Yes | ZIP-316 encoded recipient address |
| `value` | `number` | Yes | Amount in Zatoshis |

#### Return Value

Returns a `Promise` that resolves to a `Pczt` object.

#### Operations Performed

1. Creates a transaction proposal (similar to `propose_transfer`)
2. Constructs a PCZT from the proposal
3. Does NOT sign the transaction
4. Does NOT generate proofs
5. Does NOT send the transaction

#### Example

```javascript
const pczt = await wallet.pczt_create(
  accountId,
  recipientAddress,
  amountInZatoshis
);
```

### Method: `pczt_shield`

#### Purpose

Creates a PCZT for shielding transparent funds (converting transparent ZEC to shielded ZEC).

#### Signature

```typescript
pczt_shield(account_id: number): Promise<Pczt>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `account_id` | `number` | Yes | Account ID containing transparent funds to shield |

#### Return Value

Returns a `Promise` that resolves to a `Pczt` object.

#### Behavior

1. Identifies all transparent addresses for the account
2. Creates a proposal to shield funds above the shielding threshold
3. Constructs a PCZT from the proposal
4. The PCZT must still be signed, proven, and sent

#### Shielding Threshold

Only transparent balances above `SHIELDING_THRESHOLD` (100,000 Zatoshis) will be included in the shielding transaction.

#### Example

```javascript
const shieldPczt = await wallet.pczt_shield(accountId);
```

### Method: `pczt_prove`

#### Purpose

Generates and inserts zero-knowledge proofs into a PCZT.

#### Signature

```typescript
pczt_prove(
  pczt: Pczt,
  sapling_proof_gen_key?: ProofGenerationKey
): Promise<Pczt>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pczt` | `Pczt` | Yes | PCZT object to prove |
| `sapling_proof_gen_key` | `ProofGenerationKey` | No | Required only if the PCZT contains Sapling spends. Can be derived from the UFVK |

#### Return Value

Returns a `Promise` that resolves to a proven `Pczt` object.

#### Proof Generation

1. **Orchard Proofs**: Always generated if Orchard spends are present
2. **Sapling Proofs**: Generated if Sapling spends are present AND `sapling_proof_gen_key` is provided
3. **Transparent**: No proofs required for transparent components

#### Example

```javascript
// For Orchard-only transactions
const provenPczt = await wallet.pczt_prove(pczt);

// For transactions with Sapling spends
const saplingKey = deriveProofGenKey(ufvk);
const provenPczt = await wallet.pczt_prove(pczt, saplingKey);
```

### Method: `pczt_send`

#### Purpose

Extracts a complete transaction from a PCZT and broadcasts it to the network.

#### Signature

```typescript
pczt_send(pczt: Pczt): Promise<void>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pczt` | `Pczt` | Yes | Fully signed and proven PCZT |

#### Return Value

Returns a `Promise` that resolves when the transaction has been sent.

#### Prerequisites

The PCZT must be:
1. Fully constructed (`pczt_create` or `pczt_shield`)
2. Signed (external signing step)
3. Proven (`pczt_prove`)

#### Example

```javascript
const pczt = await wallet.pczt_create(accountId, address, amount);
// ... sign pczt externally ...
const provenPczt = await wallet.pczt_prove(pczt);
await wallet.pczt_send(provenPczt);
```

### Method: `pczt_combine`

#### Purpose

Combines multiple PCZTs into a single PCZT. Useful for batching multiple transactions.

#### Signature

```typescript
pczt_combine(pczts: Pczt[]): Pczt
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pczts` | `Pczt[]` | Yes | Array of PCZT objects to combine |

#### Return Value

Returns a single combined `Pczt` object.

#### Example

```javascript
const pczt1 = await wallet.pczt_create(accountId, address1, amount1);
const pczt2 = await wallet.pczt_create(accountId, address2, amount2);
const combinedPczt = wallet.pczt_combine([pczt1, pczt2]);
```

---

## Address Operations

### Method: `get_current_address`

#### Purpose

Retrieves the current unified address for a specified account.

#### Signature

```typescript
get_current_address(account_id: number): Promise<string>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `account_id` | `number` | Yes | Account ID |

#### Return Value

Returns a `Promise` that resolves to a ZIP-316 encoded unified address string.

#### Address Format

The returned address is a unified address that can receive:
- Transparent funds
- Sapling shielded funds
- Orchard shielded funds

#### Encoding

The address is returned in canonical ZIP-316 encoding, ready for use in transactions.

#### Example

```javascript
const address = await wallet.get_current_address(accountId);
console.log("Address:", address);
```

### Method: `get_current_address_transparent`

#### Purpose

Retrieves the transparent component of the current unified address for a specified account.

#### Signature

```typescript
get_current_address_transparent(account_id: number): Promise<string>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `account_id` | `number` | Yes | Account ID |

#### Return Value

Returns a `Promise` that resolves to a transparent address string.

#### Use Cases

- Displaying transparent addresses separately
- Integration with transparent-only systems
- Address format conversion

#### Example

```javascript
const transparentAddress = await wallet.get_current_address_transparent(accountId);
```

---

## Network Operations

### Method: `get_latest_block`

#### Purpose

Queries the connected lightwalletd server for the highest known block height.

#### Signature

```typescript
get_latest_block(): Promise<number>
```

#### Parameters

None.

#### Return Value

Returns a `Promise` that resolves to the block height (a `number`).

#### Use Cases

- Displaying current chain tip
- Calculating sync progress
- Determining transaction confirmation status

#### Example

```javascript
const latestBlock = await wallet.get_latest_block();
console.log("Chain tip:", latestBlock);
```

---

## Internal Wallet Implementation

### Wallet Struct

The internal `Wallet<W, T>` struct provides the core wallet functionality.

#### Type Parameters

- `W`: Wallet database type (typically `MemoryWalletDb<Network>`)
- `T`: gRPC client type (typically `tonic_web_wasm_client::Client`)

#### Fields

| Field | Type | Description |
|-------|------|-------------|
| `db` | `Arc<RwLock<W>>` | Thread-safe reference-counted database with read-write locking |
| `client` | `CompactTxStreamerClient<T>` | gRPC client for lightwalletd communication |
| `network` | `Network` | Zcash network identifier (mainnet or testnet) |
| `min_confirmations` | `NonZeroU32` | Minimum confirmations required for finality |
| `target_note_count` | `usize` | Target number of notes to maintain in the wallet (default: 4) |
| `min_split_output_value` | `u64` | Minimum value for split change outputs in Zatoshis (default: 10,000,000) |

### Internal Methods

#### `new`

Creates a new wallet instance with the specified database and client.

#### `create_account`

Internal account creation method. Derives keys from seed phrase and imports account.

**Parameters:**
- `account_name`: Human-readable account identifier
- `seed_phrase`: 24-word mnemonic phrase
- `account_hd_index`: ZIP-32 account index
- `birthday_height`: Optional block height for account creation
- `key_source`: Optional metadata about key source

#### `import_account_ufvk`

Helper method for importing accounts from UFVK. Handles birthday height resolution and account birthday construction.

**Note**: This method leaks the birthday height to the server when querying tree state.

#### `propose_transfer`

Creates a transaction proposal using greedy input selection and multi-output change strategy.

**Fee Rule**: Uses ZIP-317 standard fee calculation.

**Change Strategy**: Creates change outputs in Orchard protocol with dust output policy.

#### `create_proposed_transactions`

Performs signing and proof generation for a proposal. Uses bundled local transaction prover.

**Note**: Currently requires a Unified Spending Key. Future versions may support external signing services.

#### `transfer`

Convenience method that combines proposal creation, transaction creation, and submission in a single call.

#### `pczt_create`

Creates a PCZT from a transaction proposal. Similar to `propose_transfer` but returns a PCZT instead of a Proposal.

#### `pczt_prove`

Generates proofs for a PCZT. Handles both Orchard and Sapling proof generation.

**Sapling Handling**: If Sapling spends are present, requires a proof generation key to be provided via the updater pattern.

---

## Constants

### `SHIELDING_THRESHOLD`

**Type**: `Zatoshis`

**Value**: `100,000` Zatoshis

**Purpose**: Defines the minimum transparent balance required before a shielding transaction will be proposed. This threshold ensures that shielding transactions are economically viable after accounting for transaction fees.

**Rationale**: Shielding transactions incur fees. If the transparent balance is too small, the fees would consume most or all of the value being shielded. This threshold ensures a reasonable amount remains after fees.

---

## Error Handling

### Common Error Conditions

1. **Invalid Network**: Network string must be exactly `"main"` or `"test"`
2. **Invalid Min Confirmations**: Must be a positive integer
3. **Account Not Found**: Account ID does not exist in wallet
4. **Insufficient Balance**: Account does not have enough funds for requested transfer
5. **Invalid Address**: Address string is not valid ZIP-316 encoding
6. **Sync Failure**: Network error or server error during synchronization
7. **Transaction Creation Failure**: Error during signing or proof generation
8. **Transaction Send Failure**: Server rejected the transaction

### Error Response Format

Errors are thrown as JavaScript exceptions with descriptive error messages. The error type and message should be checked to determine the specific failure condition.

---

## Performance Considerations

### Synchronization

- **Initial Sync**: O(n) where n is the number of blocks since account birthday
- **Incremental Sync**: O(m) where m is the number of new blocks
- **Block Scanning**: CPU-intensive cryptographic operations

### Transaction Creation

- **Proposal Creation**: Fast (milliseconds)
- **Proof Generation**: Slow (10-60 seconds) depending on transaction complexity
- **WebWorker Execution**: Prevents main thread blocking

### Memory Usage

- **Wallet Database**: Grows with number of accounts and transactions
- **Block Cache**: Temporary storage during sync
- **Transaction Storage**: All created transactions are stored in database

---

## Security Considerations

### Seed Phrase Handling

- Seed phrases should NEVER be logged or stored in plaintext
- Seed phrases should be entered in secure environments
- Consider using hardware wallets or secure enclaves for key derivation

### PCZT Signing

- PCZT signing should occur in secure environments
- Consider using hardware wallets for signing operations
- Never expose signing keys to untrusted code

### Network Communication

- All communication with lightwalletd occurs over HTTPS
- Verify the lightwalletd server certificate
- Consider using trusted lightwalletd instances

---

## References

- [ZIP-32: Hierarchical Deterministic Wallets](https://zips.z.cash/zip-0032)
- [ZIP-316: Unified Addresses](https://zips.z.cash/zip-0316)
- [ZIP-317: Fee Calculation](https://zips.z.cash/zip-0317)
- [Zcash Protocol Specification](https://zips.z.cash/protocol/protocol.pdf)
