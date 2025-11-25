declare module '@chainsafe/webzjs-keys' {
  export function generate_seed_phrase(): string;
  export function pczt_sign(network: string, pczt: Pczt, usk: UnifiedSpendingKey, seed_fp: SeedFingerprint): Uint8Array;

  export class Pczt {
    // Add methods as needed
  }

  export class ProofGenerationKey {
    // Add methods as needed
  }

  export class SeedFingerprint {
    constructor(seed: Uint8Array);
    static from_bytes(bytes: Uint8Array): SeedFingerprint;
    to_bytes(): Uint8Array;
  }

  export class UnifiedFullViewingKey {
    constructor(network: string, encoding: string);
    encode(network: string): string;
  }

  export class UnifiedSpendingKey {
    /**
     * Construct a new UnifiedSpendingKey from a seed.
     * @param network - Must be either "main" or "test"
     * @param seed - At least 32 bytes of seed entropy (derived from BIP39 mnemonic)
     * @param hd_index - ZIP32 hierarchical deterministic index of the account
     */
    constructor(network: string, seed: Uint8Array, hd_index: number);
    to_unified_full_viewing_key(): UnifiedFullViewingKey;
    to_sapling_proof_generation_key(): ProofGenerationKey;
  }

  export function initSync(module: WebAssembly.Module): void;

  export default function init(module_or_path?: string | URL | Request | WebAssembly.Module): Promise<void>;
}

