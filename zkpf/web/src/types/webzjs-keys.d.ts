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
    static from_bytes(bytes: Uint8Array): SeedFingerprint;
  }

  export class UnifiedFullViewingKey {
    // Add methods as needed
  }

  export class UnifiedSpendingKey {
    // Add methods as needed
  }

  export function initSync(module: WebAssembly.Module): void;

  export default function init(module_or_path?: string | URL | Request | WebAssembly.Module): Promise<void>;
}

