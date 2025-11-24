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

  export function initThreadPool(threads: number): Promise<void>;

  export default function init(module_or_path?: string | URL | Request | WebAssembly.Module): Promise<void>;
}


