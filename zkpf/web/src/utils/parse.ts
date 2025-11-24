import { z } from 'zod';
import type { ProofBundle, VerifierPublicInputs, ByteArray } from '../types/zkpf';

const byteSchema = z.number().int().min(0).max(255);
const byteSourceSchema = z.union([z.array(byteSchema), z.string().min(2)]);

const publicInputsSchema = z.object({
  threshold_raw: z.number().nonnegative(),
  required_currency_code: z.number().int().nonnegative(),
  current_epoch: z.number().nonnegative(),
  verifier_scope_id: z.number().nonnegative(),
  policy_id: z.number().nonnegative(),
  nullifier: byteSourceSchema,
  custodian_pubkey_hash: byteSourceSchema,
  snapshot_block_height: z.number().nonnegative().optional(),
  snapshot_anchor_orchard: byteSourceSchema.optional(),
  holder_binding: byteSourceSchema.optional(),
});

const proofBundleSchema = z.object({
  rail_id: z.string().optional(),
  circuit_version: z.number().int().nonnegative(),
  proof: byteSourceSchema,
  public_inputs: publicInputsSchema,
});

type ByteSource = z.infer<typeof byteSourceSchema>;

export function parseProofBundle(json: string): ProofBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }

  const bundleResult = proofBundleSchema.safeParse(parsed);
  if (!bundleResult.success) {
    throw new Error(bundleResult.error.issues[0]?.message ?? 'Malformed proof bundle');
  }

  const raw = bundleResult.data;
  const inputs = raw.public_inputs;

  const normalizedInputs: VerifierPublicInputs = {
    threshold_raw: inputs.threshold_raw,
    required_currency_code: inputs.required_currency_code,
    current_epoch: inputs.current_epoch,
    verifier_scope_id: inputs.verifier_scope_id,
    policy_id: inputs.policy_id,
    nullifier: normalizeByteArray(inputs.nullifier, 'public_inputs.nullifier', 32),
    custodian_pubkey_hash: normalizeByteArray(
      inputs.custodian_pubkey_hash,
      'public_inputs.custodian_pubkey_hash',
      32,
    ),
    snapshot_block_height: inputs.snapshot_block_height,
    snapshot_anchor_orchard: inputs.snapshot_anchor_orchard
      ? normalizeByteArray(
          inputs.snapshot_anchor_orchard,
          'public_inputs.snapshot_anchor_orchard',
          32,
        )
      : undefined,
    holder_binding: inputs.holder_binding
      ? normalizeByteArray(inputs.holder_binding, 'public_inputs.holder_binding', 32)
      : undefined,
  };

  return {
    rail_id: raw.rail_id,
    circuit_version: raw.circuit_version,
    proof: normalizeByteArray(raw.proof, 'proof'),
    public_inputs: normalizedInputs,
  };
}

function normalizeByteArray(
  source: ByteSource,
  label: string,
  expectedLength?: number,
): ByteArray {
  let bytes: ByteArray;
  if (typeof source === 'string') {
    bytes = decodeByteString(source, label);
  } else {
    bytes = source;
  }

  bytes.forEach((b) => {
    if (!Number.isInteger(b) || b < 0 || b > 255) {
      throw new Error(`Byte array ${label} contains invalid value ${b}`);
    }
  });

  if (expectedLength && bytes.length !== expectedLength) {
    throw new Error(
      `Byte array ${label} has length ${bytes.length}; expected ${expectedLength} bytes`,
    );
  }
  return Array.from(bytes);
}

function decodeByteString(inputRaw: string, label: string): ByteArray {
  const input = inputRaw.trim();
  if (!input) {
    throw new Error(`Byte field ${label} is empty`);
  }

  if (/^(0x)?[0-9a-fA-F]+$/.test(input)) {
    return decodeHex(input);
  }

  try {
    return decodeBase64(input);
  } catch (err) {
    throw new Error(
      `Byte field ${label} must be hex (0x…) or base64; ${(err as Error).message}`,
    );
  }
}

function decodeHex(value: string): ByteArray {
  const hex = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;
  if (hex.length % 2 !== 0) {
    throw new Error('hex input must have an even number of characters');
  }
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

function decodeBase64(value: string): ByteArray {
  const binary = atob(value);
  const bytes: number[] = [];
  for (let i = 0; i < binary.length; i += 1) {
    bytes.push(binary.charCodeAt(i));
  }
  return bytes;
}

