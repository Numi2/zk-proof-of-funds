/* tslint:disable */
/* eslint-disable */
/**
 * Validate if a string looks like a payment URI
 */
export function isPaymentUri(s: string): boolean;
/**
 * Extract the amount from a payment URI without full parsing
 */
export function extractUriAmount(uri: string): string | undefined;
export function start(): void;
export function initThreadPool(_threads: number): void;
/**
 * Generate a new BIP39 24-word seed phrase
 *
 * IMPORTANT: This probably does not use secure randomness when used in the browser
 * and should not be used for anything other than testing
 *
 * # Returns
 *
 * A string containing a 24-word seed phrase
 */
export function generate_seed_phrase(): string;
/**
 * Signs and applies signatures to a PCZT.
 * Should in a secure environment (e.g. Metamask snap).
 *
 * # Arguments
 *
 * * `pczt` - The PCZT that needs to signed
 * * `usk` - UnifiedSpendingKey used to sign the PCZT
 * * `seed_fp` - The fingerprint of the seed used to create `usk`
 */
export function pczt_sign(network: string, pczt: Pczt, usk: UnifiedSpendingKey, seed_fp: SeedFingerprint): Promise<Pczt>;
/**
 * The `ReadableStreamType` enum.
 *
 * *This API requires the following crate features to be activated: `ReadableStreamType`*
 */
type ReadableStreamType = "bytes";
export class BlockRange {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  0: number;
  1: number;
}
export class IntoUnderlyingByteSource {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  start(controller: ReadableByteStreamController): void;
  pull(controller: ReadableByteStreamController): Promise<any>;
  cancel(): void;
  readonly type: ReadableStreamType;
  readonly autoAllocateChunkSize: number;
}
export class IntoUnderlyingSink {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  write(chunk: any): Promise<any>;
  close(): Promise<any>;
  abort(reason: any): Promise<any>;
}
export class IntoUnderlyingSource {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  pull(controller: ReadableStreamDefaultController): Promise<any>;
  cancel(): void;
}
export class Pczt {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Returns a JSON object with the details of the Pczt.
   */
  to_json(): any;
  /**
   * Returns a Pczt from a JSON object
   */
  static from_json(s: any): Pczt;
  /**
   * Returns the postcard serialization of the Pczt.
   */
  serialize(): Uint8Array;
  /**
   * Deserialize to a Pczt from postcard bytes.
   */
  static from_bytes(bytes: Uint8Array): Pczt;
}
/**
 * A Zcash Sapling proof generation key
 *
 * This is a wrapper around the `sapling::ProofGenerationKey` type. It is used for generating proofs for Sapling PCZTs.
 */
export class ProofGenerationKey {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
}
/**
 * A handler to an immutable proposal. This can be passed to `create_proposed_transactions` to prove/authorize the transactions
 * before they are sent to the network.
 *
 * The proposal can be reviewed by calling `describe` which will return a JSON object with the details of the proposal.
 */
export class Proposal {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
}
/**
 * A ZIP32 seed fingerprint. Essentially a Blake2b hash of the seed.
 *
 * This is a wrapper around the `zip32::fingerprint::SeedFingerprint` type.
 */
export class SeedFingerprint {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Construct a new SeedFingerprint
   *
   * # Arguments
   *
   * * `seed` - At least 32 bytes of entry. Care should be taken as to how this is derived
   */
  constructor(seed: Uint8Array);
  to_bytes(): Uint8Array;
  static from_bytes(bytes: Uint8Array): SeedFingerprint;
}
/**
 * A Zcash viewing key
 *
 * This is a wrapper around the `zcash_keys::keys::ViewingKey` type.
 * UFVKs should be generated from a spending key by calling `to_unified_full_viewing_key`
 * They can also be encoded and decoded to a canonical string representation
 */
export class UnifiedFullViewingKey {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Encode the UFVK to a string
   *
   * # Arguments
   *
   * * `network` - Must be either "main" or "test"
   */
  encode(network: string): string;
  /**
   * Construct a UFVK from its encoded string representation
   *
   * # Arguments
   *
   * * `network` - Must be either "main" or "test"
   * * `encoding` - The encoded string representation of the UFVK
   */
  constructor(network: string, encoding: string);
}
/**
 * A Zcash spending key
 *
 * This is a wrapper around the `zcash_keys::keys::SpendingKey` type. It can be created from at least 32 bytes of seed entropy
 */
export class UnifiedSpendingKey {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Construct a new UnifiedSpendingKey
   *
   * # Arguments
   *
   * * `network` - Must be either "main" or "test"
   * * `seed` - At least 32 bytes of entry. Care should be taken as to how this is derived
   * * `hd_index` - [ZIP32](https://zips.z.cash/zip-0032) hierarchical deterministic index of the account
   */
  constructor(network: string, seed: Uint8Array, hd_index: number);
  /**
   * Obtain the UFVK corresponding to this spending key
   */
  to_unified_full_viewing_key(): UnifiedFullViewingKey;
  to_sapling_proof_generation_key(): ProofGenerationKey;
}
/**
 * A URI-Encapsulated Payment
 *
 * This represents a payment that can be sent via any secure messaging channel.
 * The URI encodes the capability to claim funds from an on-chain transaction.
 */
export class UriPayment {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Parse a URI-Encapsulated Payment from a URI string
   *
   * # Arguments
   * * `uri` - The full URI string (e.g., https://pay.withzcash.com:65536/v1#amount=1.23&key=...)
   *
   * # Returns
   * A parsed UriPayment object
   */
  constructor(uri: string);
  /**
   * Create a new URI payment with the given parameters
   *
   * # Arguments
   * * `amount_zats` - The payment amount in zatoshis
   * * `description` - Optional description for the payment
   * * `is_testnet` - Whether this is for testnet
   */
  static create(amount_zats: bigint, description: string | null | undefined, is_testnet: boolean): UriPayment;
  /**
   * Generate the full URI string
   */
  toUri(): string;
  /**
   * Generate a shareable message with the payment URI
   */
  toShareableMessage(): string;
  /**
   * Get a short display string for the payment
   */
  displayShort(): string;
  /**
   * Get the payment amount in zatoshis
   */
  readonly amount_zats: bigint;
  /**
   * Get the payment amount in ZEC (as a formatted string)
   */
  readonly amountZec: string;
  /**
   * Get the payment description
   */
  readonly description: string | undefined;
  /**
   * Get the payment key as bytes
   */
  readonly keyBytes: Uint8Array;
  /**
   * Check if this payment is for testnet
   */
  readonly isTestnet: boolean;
  /**
   * Get the payment index (if derived from seed)
   */
  readonly paymentIndex: number | undefined;
}
/**
 * Information about a URI payment status
 */
export class UriPaymentStatus {
  private constructor();
/**
** Return copy of self without private attributes.
*/
  toJSON(): Object;
/**
* Return stringified version of self.
*/
  toString(): string;
  free(): void;
  [Symbol.dispose](): void;
  readonly state: string;
  readonly confirmations: number | undefined;
  readonly canFinalize: boolean;
  readonly isFinalized: boolean;
  readonly error: string | undefined;
}
export class WalletSummary {
  private constructor();
/**
** Return copy of self without private attributes.
*/
  toJSON(): Object;
/**
* Return stringified version of self.
*/
  toString(): string;
  free(): void;
  [Symbol.dispose](): void;
  chain_tip_height: number;
  fully_scanned_height: number;
  next_sapling_subtree_index: bigint;
  next_orchard_subtree_index: bigint;
  readonly account_balances: any;
}
/**
 * # A Zcash wallet
 *
 * This is the main entry point for interacting with this library.
 * For the most part you will only need to create and interact with a Wallet instance.
 *
 * A wallet is a set of accounts that can be synchronized together with the blockchain.
 * Once synchronized, the wallet can be used to propose, build and send transactions.
 *
 * Create a new WebWallet with
 * ```javascript
 * const wallet = new WebWallet("main", "https://zcash-mainnet.chainsafe.dev", 10);
 * ```
 *
 * ## Adding Accounts
 *
 * Accounts can be added by either importing a seed phrase or a Unified Full Viewing Key (UFVK).
 * If you do import via a UFVK it is important that you also have access to the Unified Spending Key (USK) for that account otherwise the wallet will not be able to create transactions.
 *
 * When importing an account you can also specify the block height at which the account was created. This can significantly reduce the time it takes to sync the account as the wallet will only scan for transactions after this height.
 * Failing to provide a birthday height will result in extremely slow sync times as the wallet will need to scan the entire blockchain.
 *
 * e.g.
 * ```javascript
 * const account_id = await wallet.create_account("...", 1, 2657762)
 *
 * // OR
 *
 * const account_id = await wallet.import_ufvk("...", 2657762)
 * ``
 *
 * ## Synchronizing
 *
 * The wallet can be synchronized with the blockchain by calling the `sync` method. This will fetch compact blocks from the connected lightwalletd instance and scan them for transactions.
 * The sync method uses a built-in strategy to determine which blocks is needs to download and scan in order to gain full knowledge of the balances for all accounts that are managed.
 *
 * Syncing is a long running process and so is delegated to a WebWorker to prevent from blocking the main thread. It is safe to call other methods on the wallet during syncing although they may take
 * longer than usual while they wait for a write-lock to be released.
 *
 * ```javascript
 * await wallet.sync();
 * ```
 *
 * ## Transacting
 *
 * Sending a transaction is a three step process: proposing, authorizing, and sending.
 *
 * A transaction proposal is created by calling `propose_transfer` with the intended recipient and amount. This will create a proposal object that describes which notes will be spent in order to fulfil this request.
 * The proposal should be presented to the user for review before being authorized.
 *
 * To authorize the transaction the caller must currently provide the seed phrase and account index of the account that will be used to sign the transaction. This method also perform the SNARK proving which is an expensive operation and performed in parallel by a series of WebWorkers.
 *
 * Finally, A transaction can be sent to the network by calling `send_authorized_transactions` with the list of transaction IDs that were generated by the authorization step.
 *
 * ## PCZT Transactions
 *
 * PCZT (Partially Constructed Zcash Transaction)
 *
 * 1. **`pczt_create`** - Creates a PCZT which designates how funds from this account can be spent to realize the requested transfer (does NOT sign, generate proofs, or send)
 * 2. **`pczt_sign`** - Signs the PCZT using USK (should be done in secure environment)
 * 3. **`pczt_prove`** - Creates and inserts proofs for the PCZT
 *
 * The full flow looks like
 * The full PCZT flow: `pczt_create` → `pczt_sign` → `pczt_prove` → `pczt_send`
 * ```
 */
export class WebWallet {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a new instance of a Zcash wallet for a given network. Only one instance should be created per page.
   *
   * # Arguments
   *
   * * `network` - Must be one of "main" or "test"
   * * `lightwalletd_url` - Url of the lightwalletd instance to connect to (e.g. https://zcash-mainnet.chainsafe.dev)
   * * `min_confirmations` - Number of confirmations required before a transaction is considered final
   * * `db_bytes` - (Optional) UInt8Array of a serialized wallet database. This can be used to restore a wallet from a previous session that was serialized by `db_to_bytes`
   *
   * # Examples
   *
   * ```javascript
   * const wallet = new WebWallet("main", "https://zcash-mainnet.chainsafe.dev", 10);
   * ```
   */
  constructor(network: string, lightwalletd_url: string, min_confirmations: number, db_bytes?: Uint8Array | null);
  /**
   * Add a new account to the wallet using a given seed phrase
   *
   * # Arguments
   *
   * * `seed_phrase` - 24 word mnemonic seed phrase
   * * `account_hd_index` - [ZIP32](https://zips.z.cash/zip-0032) hierarchical deterministic index of the account
   * * `birthday_height` - Block height at which the account was created. The sync logic will assume no funds are send or received prior to this height which can VERY significantly reduce sync time
   *
   * # Examples
   *
   * ```javascript
   * const wallet = new WebWallet("main", "https://zcash-mainnet.chainsafe.dev", 10);
   * const account_id = await wallet.create_account("...", 1, 2657762)
   * ```
   */
  create_account(account_name: string, seed_phrase: string, account_hd_index: number, birthday_height?: number | null): Promise<number>;
  /**
   * Add a new account to the wallet by directly importing a Unified Full Viewing Key (UFVK)
   *
   * # Arguments
   *
   * * `key` - [ZIP316](https://zips.z.cash/zip-0316) encoded UFVK
   * * `birthday_height` - Block height at which the account was created. The sync logic will assume no funds are send or received prior to this height which can VERY significantly reduce sync time
   *
   * # Examples
   *
   * ```javascript
   * const wallet = new WebWallet("main", "https://zcash-mainnet.chainsafe.dev", 10);
   * const account_id = await wallet.import_ufvk("...", 2657762)
   * ```
   */
  create_account_ufvk(account_name: string, encoded_ufvk: string, seed_fingerprint: SeedFingerprint, account_hd_index: number, birthday_height?: number | null): Promise<number>;
  /**
   * Add a new view-only account to the wallet by directly importing a Unified Full Viewing Key (UFVK)
   *
   * # Arguments
   *
   * * `key` - [ZIP316](https://zips.z.cash/zip-0316) encoded UFVK
   * * `birthday_height` - Block height at which the account was created. The sync logic will assume no funds are send or received prior to this height which can VERY significantly reduce sync time
   *
   * # Examples
   *
   * ```javascript
   * const wallet = new WebWallet("main", "https://zcash-mainnet.chainsafe.dev", 10);
   * const account_id = await wallet.import_ufvk("...", 2657762)
   * ```
   */
  create_account_view_ufvk(account_name: string, encoded_ufvk: string, birthday_height?: number | null): Promise<number>;
  /**
   * Single-threaded sync implementation (no web workers)
   */
  sync(): Promise<void>;
  get_wallet_summary(): Promise<WalletSummary | undefined>;
  /**
   * Create a new transaction proposal to send funds to a given address
   *
   * Not this does NOT sign, generate a proof, or send the transaction. It will only craft the proposal which designates how notes from this account can be spent to realize the requested transfer.
   *
   * # Arguments
   *
   * * `account_id` - The ID of the account in this wallet to send funds from
   * * `to_address` - [ZIP316](https://zips.z.cash/zip-0316) encoded address to send funds to
   * * `value` - Amount to send in Zatoshis (1 ZEC = 100_000_000 Zatoshis)
   *
   * # Returns
   *
   * A proposal object which can be inspected and later used to generate a valid transaction
   *
   * # Examples
   *
   * ```javascript
   * const proposal = await wallet.propose_transfer(1, "u18rakpts0de589sx9dkamcjms3apruqqax9k2s6e7zjxx9vv5kc67pks2trg9d3nrgd5acu8w8arzjjuepakjx38dyxl6ahd948w0mhdt9jxqsntan6px3ysz80s04a87pheg2mqvlzpehrgup7568nfd6ez23xd69ley7802dfvplnfn7c07vlyumcnfjul4pvv630ac336rjhjyak5", 100000000);
   * ```
   */
  propose_transfer(account_id: number, to_address: string, value: bigint): Promise<Proposal>;
  /**
   * Single-threaded transaction creation (no web workers)
   */
  create_proposed_transactions(proposal: Proposal, seed_phrase: string, account_hd_index: number): Promise<Uint8Array>;
  /**
   * Serialize the internal wallet database to bytes
   *
   * This should be used for persisting the wallet between sessions. The resulting byte array can be used to construct a new wallet instance.
   * Note this method is async and will block until a read-lock can be acquired on the wallet database
   *
   * # Returns
   *
   * A postcard encoded byte array of the wallet database
   */
  db_to_bytes(): Promise<Uint8Array>;
  /**
   * Send a list of authorized transactions to the network to be included in the blockchain
   *
   * These will be sent via the connected lightwalletd instance
   *
   * # Arguments
   *
   * * `txids` - A list of transaction IDs (typically generated by `create_proposed_transactions`). It is in flatten form which means it's just a concatination of the 32 byte IDs.
   *
   * # Examples
   *
   * ```javascript
   * const proposal = wallet.propose_transfer(1, "u18rakpts0de589sx9dkamcjms3apruqqax9k2s6e7zjxx9vv5kc67pks2trg9d3nrgd5acu8w8arzjjuepakjx38dyxl6ahd948w0mhdt9jxqsntan6px3ysz80s04a87pheg2mqvlzpehrgup7568nfd6ez23xd69ley7802dfvplnfn7c07vlyumcnfjul4pvv630ac336rjhjyak5", 100000000);
   * const authorized_txns = wallet.create_proposed_transactions(proposal, "...", 1);
   * await wallet.send_authorized_transactions(authorized_txns);
   * ```
   */
  send_authorized_transactions(txids: Uint8Array): Promise<void>;
  /**
   * Get the current unified address for a given account. This is returned as a string in canonical encoding
   *
   * # Arguments
   *
   * * `account_id` - The ID of the account to get the address for
   */
  get_current_address(account_id: number): Promise<string>;
  /**
   * Create a Shielding PCZT (Partially Constructed Zcash Transaction).
   *
   * A Proposal for shielding funds is created and the the PCZT is constructed for it
   *
   * # Arguments
   *
   * * `account_id` - The ID of the account which transparent funds will be shielded.
   */
  pczt_shield(account_id: number): Promise<Pczt>;
  /**
   * Creates a PCZT (Partially Constructed Zcash Transaction).
   *
   * A Proposal is created similar to `create_proposed_transactions` and then a PCZT is constructed from it.
   * Note: This does NOT sign, generate a proof, or send the transaction.
   * It will only craft the PCZT which designates how notes from this account can be spent to realize the requested transfer.
   * The PCZT will still need to be signed and proofs will need to be generated before sending.
   *
   * # Arguments
   *
   * * `account_id` - The ID of the account in this wallet to send funds from
   * * `to_address` - [ZIP316](https://zips.z.cash/zip-0316) encoded address to send funds to
   * * `value` - Amount to send in Zatoshis (1 ZEC = 100_000_000 Zatoshis)
   */
  pczt_create(account_id: number, to_address: string, value: bigint): Promise<Pczt>;
  /**
   * Creates and inserts proofs for a PCZT.
   *
   * If there are Sapling spends, a ProofGenerationKey needs to be supplied. It can be derived from the UFVK.
   *
   * # Arguments
   *
   * * `pczt` - The PCZT that needs to be signed
   * * `sapling_proof_gen_key` - The Sapling proof generation key (needed only if there are Sapling spends)
   */
  pczt_prove(pczt: Pczt, sapling_proof_gen_key?: ProofGenerationKey | null): Promise<Pczt>;
  pczt_send(pczt: Pczt): Promise<void>;
  pczt_combine(pczts: Pczt[]): Pczt;
  /**
   * Get the current unified address for a given account and extracts the transparent component. This is returned as a string in canonical encoding
   *
   * # Arguments
   *
   * * `account_id` - The ID of the account to get the address for
   */
  get_current_address_transparent(account_id: number): Promise<string>;
  /**
   * Derive a transparent address at a specific diversifier index.
   * 
   * IMPORTANT for privacy: Each swap MUST use a fresh address. This method allows
   * deriving addresses at specific indices to ensure no address reuse.
   *
   * # Arguments
   *
   * * `account_id` - The ID of the account
   * * `diversifier_index` - The diversifier index for address derivation
   *
   * # Returns
   *
   * A transparent address string in canonical encoding
   *
   * # Examples
   *
   * ```javascript
   * const freshTaddr = await wallet.derive_transparent_address(0, 1234);
   * ```
   */
  derive_transparent_address(account_id: number, _diversifier_index: number): Promise<string>;
  /**
   * Derive a unified address at a specific diversifier index.
   * 
   * IMPORTANT for privacy: Auto-shield MUST go to a fresh Orchard address.
   * This method allows deriving addresses at specific indices.
   *
   * # Arguments
   *
   * * `account_id` - The ID of the account
   * * `diversifier_index` - The diversifier index for address derivation
   *
   * # Returns
   *
   * A unified address string in canonical encoding (includes Orchard + Sapling receivers)
   *
   * # Examples
   *
   * ```javascript
   * const freshUaddr = await wallet.derive_unified_address(0, 5678);
   * ```
   */
  derive_unified_address(account_id: number, diversifier_index: number): Promise<string>;
  /**
   * Single-threaded send_to_address implementation
   */
  send_to_address(account_id: number, to_address: string, amount_zats: bigint, seed_phrase: string, account_hd_index: number): Promise<string>;
  /**
   * Shield transparent funds to Orchard.
   * 
   * Used for auto-shielding after receiving inbound swap deposits.
   * This is a convenience method that combines pczt_shield → sign → prove → send.
   *
   * # Arguments
   *
   * * `account_id` - The ID of the account with transparent funds to shield
   * * `seed_phrase` - 24 word mnemonic seed phrase (needed for signing)
   * * `account_hd_index` - ZIP32 HD index of the account
   *
   * # Returns
   *
   * The transaction ID as a hex string
   *
   * # Examples
   *
   * ```javascript
   * const txid = await wallet.shield_funds(0, "seed...", 0);
   * ```
   */
  shield_funds(account_id: number, seed_phrase: string, account_hd_index: number): Promise<string>;
  /**
   * Get the transparent balance for a specific account.
   * 
   * Useful for checking if there are funds to shield after a swap deposit.
   *
   * # Arguments
   *
   * * `account_id` - The ID of the account
   *
   * # Returns
   *
   * The transparent balance in zatoshis
   */
  get_transparent_balance(account_id: number): Promise<bigint>;
  /**
   * Get the shielded balance (Orchard + Sapling) for a specific account.
   *
   * # Arguments
   *
   * * `account_id` - The ID of the account
   *
   * # Returns
   *
   * The total shielded balance in zatoshis
   */
  get_shielded_balance(account_id: number): Promise<bigint>;
  /**
   *
   * Get the highest known block height from the connected lightwalletd instance
   */
  get_latest_block(): Promise<bigint>;
  /**
   * Build an Orchard snapshot (anchor + note witnesses) for the specified account.
   *
   * Returns an object with `height`, `anchor`, and `notes` (each note has value,
   * commitment, and Merkle path siblings/position). Requires the wallet to be
   * synced to at least `min_confirmations` and to have spendable Orchard notes.
   */
  build_orchard_snapshot(account_id: number, threshold_zats: bigint): Promise<any>;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly __wbg_proposal_free: (a: number, b: number) => void;
  readonly __wbg_uripayment_free: (a: number, b: number) => void;
  readonly uripayment_new: (a: number, b: number) => [number, number, number];
  readonly uripayment_create: (a: bigint, b: number, c: number, d: number) => [number, number, number];
  readonly uripayment_amount_zats: (a: number) => bigint;
  readonly uripayment_amountZec: (a: number) => [number, number];
  readonly uripayment_description: (a: number) => [number, number];
  readonly uripayment_keyBytes: (a: number) => [number, number];
  readonly uripayment_isTestnet: (a: number) => number;
  readonly uripayment_paymentIndex: (a: number) => number;
  readonly uripayment_toUri: (a: number) => [number, number];
  readonly uripayment_toShareableMessage: (a: number) => [number, number];
  readonly uripayment_displayShort: (a: number) => [number, number];
  readonly __wbg_uripaymentstatus_free: (a: number, b: number) => void;
  readonly uripaymentstatus_state: (a: number) => [number, number];
  readonly uripaymentstatus_confirmations: (a: number) => number;
  readonly uripaymentstatus_canFinalize: (a: number) => number;
  readonly uripaymentstatus_isFinalized: (a: number) => number;
  readonly uripaymentstatus_error: (a: number) => [number, number];
  readonly isPaymentUri: (a: number, b: number) => number;
  readonly extractUriAmount: (a: number, b: number) => [number, number];
  readonly __wbg_webwallet_free: (a: number, b: number) => void;
  readonly webwallet_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
  readonly webwallet_create_account: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
  readonly webwallet_create_account_ufvk: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => any;
  readonly webwallet_create_account_view_ufvk: (a: number, b: number, c: number, d: number, e: number, f: number) => any;
  readonly webwallet_sync: (a: number) => any;
  readonly webwallet_get_wallet_summary: (a: number) => any;
  readonly webwallet_propose_transfer: (a: number, b: number, c: number, d: number, e: bigint) => any;
  readonly webwallet_create_proposed_transactions: (a: number, b: number, c: number, d: number, e: number) => any;
  readonly webwallet_db_to_bytes: (a: number) => any;
  readonly webwallet_send_authorized_transactions: (a: number, b: number, c: number) => any;
  readonly webwallet_get_current_address: (a: number, b: number) => any;
  readonly webwallet_pczt_shield: (a: number, b: number) => any;
  readonly webwallet_pczt_create: (a: number, b: number, c: number, d: number, e: bigint) => any;
  readonly webwallet_pczt_prove: (a: number, b: number, c: number) => any;
  readonly webwallet_pczt_send: (a: number, b: number) => any;
  readonly webwallet_pczt_combine: (a: number, b: number, c: number) => [number, number, number];
  readonly webwallet_get_current_address_transparent: (a: number, b: number) => any;
  readonly webwallet_derive_transparent_address: (a: number, b: number, c: number) => any;
  readonly webwallet_derive_unified_address: (a: number, b: number, c: number) => any;
  readonly webwallet_send_to_address: (a: number, b: number, c: number, d: number, e: bigint, f: number, g: number, h: number) => any;
  readonly webwallet_shield_funds: (a: number, b: number, c: number, d: number, e: number) => any;
  readonly webwallet_get_transparent_balance: (a: number, b: number) => any;
  readonly webwallet_get_shielded_balance: (a: number, b: number) => any;
  readonly webwallet_get_latest_block: (a: number) => any;
  readonly webwallet_build_orchard_snapshot: (a: number, b: number, c: bigint) => any;
  readonly __wbg_walletsummary_free: (a: number, b: number) => void;
  readonly __wbg_get_walletsummary_chain_tip_height: (a: number) => number;
  readonly __wbg_set_walletsummary_chain_tip_height: (a: number, b: number) => void;
  readonly __wbg_get_walletsummary_fully_scanned_height: (a: number) => number;
  readonly __wbg_set_walletsummary_fully_scanned_height: (a: number, b: number) => void;
  readonly __wbg_get_walletsummary_next_sapling_subtree_index: (a: number) => bigint;
  readonly __wbg_set_walletsummary_next_sapling_subtree_index: (a: number, b: bigint) => void;
  readonly __wbg_get_walletsummary_next_orchard_subtree_index: (a: number) => bigint;
  readonly __wbg_set_walletsummary_next_orchard_subtree_index: (a: number, b: bigint) => void;
  readonly walletsummary_account_balances: (a: number) => any;
  readonly start: () => void;
  readonly initThreadPool: (a: number) => void;
  readonly __wbg_blockrange_free: (a: number, b: number) => void;
  readonly __wbg_get_blockrange_0: (a: number) => number;
  readonly __wbg_set_blockrange_0: (a: number, b: number) => void;
  readonly __wbg_get_blockrange_1: (a: number) => number;
  readonly __wbg_set_blockrange_1: (a: number, b: number) => void;
  readonly __wbg_seedfingerprint_free: (a: number, b: number) => void;
  readonly seedfingerprint_new: (a: number, b: number) => [number, number, number];
  readonly seedfingerprint_to_bytes: (a: number) => [number, number];
  readonly seedfingerprint_from_bytes: (a: number, b: number) => [number, number, number];
  readonly __wbg_proofgenerationkey_free: (a: number, b: number) => void;
  readonly __wbg_unifiedspendingkey_free: (a: number, b: number) => void;
  readonly unifiedspendingkey_new: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
  readonly unifiedspendingkey_to_unified_full_viewing_key: (a: number) => number;
  readonly unifiedspendingkey_to_sapling_proof_generation_key: (a: number) => number;
  readonly __wbg_unifiedfullviewingkey_free: (a: number, b: number) => void;
  readonly unifiedfullviewingkey_encode: (a: number, b: number, c: number) => [number, number, number, number];
  readonly unifiedfullviewingkey_new: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly generate_seed_phrase: () => [number, number];
  readonly pczt_sign: (a: number, b: number, c: number, d: number, e: number) => any;
  readonly __wbg_pczt_free: (a: number, b: number) => void;
  readonly pczt_to_json: (a: number) => any;
  readonly pczt_from_json: (a: any) => number;
  readonly pczt_serialize: (a: number) => [number, number];
  readonly pczt_from_bytes: (a: number, b: number) => number;
  readonly __wbg_intounderlyingbytesource_free: (a: number, b: number) => void;
  readonly intounderlyingbytesource_type: (a: number) => number;
  readonly intounderlyingbytesource_autoAllocateChunkSize: (a: number) => number;
  readonly intounderlyingbytesource_start: (a: number, b: any) => void;
  readonly intounderlyingbytesource_pull: (a: number, b: any) => any;
  readonly intounderlyingbytesource_cancel: (a: number) => void;
  readonly __wbg_intounderlyingsource_free: (a: number, b: number) => void;
  readonly intounderlyingsource_pull: (a: number, b: any) => any;
  readonly intounderlyingsource_cancel: (a: number) => void;
  readonly __wbg_intounderlyingsink_free: (a: number, b: number) => void;
  readonly intounderlyingsink_write: (a: number, b: any) => any;
  readonly intounderlyingsink_close: (a: number) => any;
  readonly intounderlyingsink_abort: (a: number, b: any) => any;
  readonly rustsecp256k1_v0_8_1_context_create: (a: number) => number;
  readonly rustsecp256k1_v0_8_1_context_destroy: (a: number) => void;
  readonly rustsecp256k1_v0_8_1_default_illegal_callback_fn: (a: number, b: number) => void;
  readonly rustsecp256k1_v0_8_1_default_error_callback_fn: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h2ffeadade697bfa8: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__closure__destroy__h008334b33368887c: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__ha07f0c325a9a0a72: (a: number, b: number, c: any, d: any) => void;
  readonly memory: WebAssembly.Memory;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_thread_destroy: (a?: number, b?: number, c?: number) => void;
  readonly __wbindgen_start: (a: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number }} module - Passing `SyncInitInput` directly is deprecated.
* @param {WebAssembly.Memory} memory - Deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number } | SyncInitInput, memory?: WebAssembly.Memory): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number }} module_or_path - Passing `InitInput` directly is deprecated.
* @param {WebAssembly.Memory} memory - Deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number } | InitInput | Promise<InitInput>, memory?: WebAssembly.Memory): Promise<InitOutput>;
