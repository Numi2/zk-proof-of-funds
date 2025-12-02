declare module '@chainsafe/webzjs-wallet' {
  export class WebWallet {
    constructor(
      network: string,
      lightwalletd_url: string,
      min_confirmations: number,
      db_bytes?: Uint8Array,
    );

    get_wallet_summary(): Promise<WalletSummary | undefined>;
    get_latest_block(): Promise<number>;
    db_to_bytes(): Promise<Uint8Array>;
    /**
     * Build an Orchard snapshot (anchor + note witnesses) for the specified account.
     * Returns an object with height, anchor, and notes (each note has value,
     * commitment, and Merkle path siblings/position).
     */
    build_orchard_snapshot(
      account_id: number,
      threshold_zats: bigint,
    ): Promise<OrchardSnapshot>;

    create_account(
      account_name: string,
      seed_phrase: string,
      account_hd_index: number,
      birthday_height?: number,
    ): Promise<number>;

    create_account_ufvk(
      account_name: string,
      encoded_ufvk: string,
      seed_fingerprint: SeedFingerprint,
      account_hd_index: number,
      birthday_height?: number,
    ): Promise<number>;

    get_current_address(account_id: number): Promise<string>;
    get_current_address_transparent(account_id: number): Promise<string>;

    sync(): Promise<void>;

    /**
     * Create a transaction proposal to send funds.
     * Does NOT sign, prove, or broadcast - just creates the proposal.
     */
    propose_transfer(
      account_id: number,
      to_address: string,
      value: number,
    ): Promise<Proposal>;

    /**
     * Sign and prove a transaction proposal.
     * Returns flattened txid bytes (each txid is 32 bytes).
     */
    create_proposed_transactions(
      proposal: Proposal,
      seed_phrase: string,
      account_hd_index: number,
    ): Promise<Uint8Array>;

    /**
     * Broadcast signed transactions to the network.
     * Takes flattened txid bytes from create_proposed_transactions.
     */
    send_authorized_transactions(txids: Uint8Array): Promise<void>;
  }

  export interface Proposal {
    // Opaque proposal object returned by propose_transfer
  }

  export interface WalletSummary {
    account_balances: [number, AccountBalance][];
    chain_tip_height: number;
    fully_scanned_height: number;
    next_sapling_subtree_index: number;
    next_orchard_subtree_index: number;
  }

  export interface AccountBalance {
    sapling_balance: number;
    orchard_balance: number;
    unshielded_balance: number;
  }

  export interface OrchardMerklePath {
    siblings: number[][];
    position: number;
  }

  export interface OrchardNoteWitness {
    value_zats: number;
    commitment: number[];
    merkle_path: OrchardMerklePath;
  }

  export interface OrchardSnapshot {
    height: number;
    anchor: number[];
    notes: OrchardNoteWitness[];
  }

  export class SeedFingerprint {
    static from_bytes(bytes: Uint8Array): SeedFingerprint;
  }

  export function initThreadPool(threads: number): Promise<void>;

  export default function init(module_or_path?: string | URL | Request | WebAssembly.Module): Promise<void>;
}

// Single-threaded variant - same API but no initThreadPool
declare module '@chainsafe/webzjs-wallet-single' {
  export class WebWallet {
    constructor(
      network: string,
      lightwalletd_url: string,
      min_confirmations: number,
      db_bytes?: Uint8Array,
    );

    get_wallet_summary(): Promise<WalletSummary | undefined>;
    get_latest_block(): Promise<number>;
    db_to_bytes(): Promise<Uint8Array>;

    create_account(
      account_name: string,
      seed_phrase: string,
      account_hd_index: number,
      birthday_height?: number,
    ): Promise<number>;

    create_account_ufvk(
      account_name: string,
      encoded_ufvk: string,
      seed_fingerprint: SeedFingerprint,
      account_hd_index: number,
      birthday_height?: number,
    ): Promise<number>;

    get_current_address(account_id: number): Promise<string>;
    get_current_address_transparent(account_id: number): Promise<string>;

    sync(): Promise<void>;

    /**
     * Create a transaction proposal to send funds.
     * Does NOT sign, prove, or broadcast - just creates the proposal.
     */
    propose_transfer(
      account_id: number,
      to_address: string,
      value: number,
    ): Promise<Proposal>;

    /**
     * Sign and prove a transaction proposal.
     * Returns flattened txid bytes (each txid is 32 bytes).
     */
    create_proposed_transactions(
      proposal: Proposal,
      seed_phrase: string,
      account_hd_index: number,
    ): Promise<Uint8Array>;

    /**
     * Broadcast signed transactions to the network.
     * Takes flattened txid bytes from create_proposed_transactions.
     */
    send_authorized_transactions(txids: Uint8Array): Promise<void>;
  }

  export interface Proposal {
    // Opaque proposal object returned by propose_transfer
  }

  export interface WalletSummary {
    account_balances: [number, AccountBalance][];
    chain_tip_height: number;
    fully_scanned_height: number;
    next_sapling_subtree_index: number;
    next_orchard_subtree_index: number;
  }

  export interface AccountBalance {
    sapling_balance: number;
    orchard_balance: number;
    unshielded_balance: number;
  }

  export class SeedFingerprint {
    static from_bytes(bytes: Uint8Array): SeedFingerprint;
  }

  // Note: initThreadPool is not available in single-threaded variant
  // export function initThreadPool(threads: number): Promise<void>;

  export default function init(module_or_path?: string | URL | Request | WebAssembly.Module): Promise<void>;
}
