import { useCallback, useEffect, useState } from 'react';
import { blake3 } from '@noble/hashes/blake3.js';
import * as secp256k1 from '@noble/secp256k1';
import type { CircuitInput, PolicyDefinition } from '../types/zkpf';
import {
  wasmComputeAttestationMessageHash,
  wasmComputeCustodianPubkeyHash,
  wasmComputeNullifier,
} from '../wasm/prover';
import {
  bigIntToLittleEndianBytes,
  bytesToBigIntBE,
  bytesToHex,
  hexToBytes,
  normalizeField,
  numberArrayFromBytes,
} from '../utils/field';
import { policyShortSummary } from '../utils/policy';

type StatusIntent = 'info' | 'success' | 'warning' | 'error';

type BtcNetwork = 'mainnet' | 'testnet';

interface Props {
  onAttestationReady: (json: string) => void;
  onShowToast: (message: string, type?: 'success' | 'error') => void;
  policy?: PolicyDefinition | null;
}

const DEFAULT_VALIDITY_HOURS = 24;
const DEFAULT_THRESHOLD = 500_000_000;
const DEFAULT_POLICY_ID = 2718;
const DEFAULT_SCOPE_ID = 314159;
const DEFAULT_CURRENCY = 840;
const DEFAULT_CUSTODIAN_ID = 77;

interface StatusState {
  intent: StatusIntent;
  message: string;
}

export function BtcWalletConnector({ onAttestationReady, onShowToast, policy }: Props) {
  const [network, setNetwork] = useState<BtcNetwork>('mainnet');
  const [address, setAddress] = useState<string>('');
  const [balanceSats, setBalanceSats] = useState<string>('');

  const [policyId, setPolicyId] = useState<number>(DEFAULT_POLICY_ID);
  const [scopeId, setScopeId] = useState<number>(DEFAULT_SCOPE_ID);
  const [currencyCode, setCurrencyCode] = useState<number>(DEFAULT_CURRENCY);
  const [custodianId, setCustodianId] = useState<number>(DEFAULT_CUSTODIAN_ID);
  const [threshold, setThreshold] = useState<number>(DEFAULT_THRESHOLD);

  const [currentEpoch, setCurrentEpoch] = useState<number>(() => Math.floor(Date.now() / 1000));
  const [issuedAt] = useState<number>(() => Math.floor(Date.now() / 1000));
  const [validHours] = useState<number>(DEFAULT_VALIDITY_HOURS);
  const [attestationId] = useState<number>(() => Math.floor(Math.random() * 1_000_000));

  const [status, setStatus] = useState<StatusState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);

  const [messageHashHex, setMessageHashHex] = useState<string>('');
  const [messageHashBytes, setMessageHashBytes] = useState<Uint8Array | null>(null);
  const [accountBytes, setAccountBytes] = useState<Uint8Array | null>(null);
  const [baseInput, setBaseInput] = useState<CircuitInput | null>(null);

  const [pubkeyHex, setPubkeyHex] = useState<string>('');
  const [signatureHex, setSignatureHex] = useState<string>('');

  useEffect(() => {
    if (!policy) {
      return;
    }
    setPolicyId(policy.policy_id);
    setThreshold(policy.threshold_raw);
    setCurrencyCode(policy.required_currency_code);
    setCustodianId(0);
    setScopeId(policy.verifier_scope_id);
  }, [policy]);

  const updateStatus = useCallback((intent: StatusIntent, message: string) => {
    setStatus({ intent, message });
  }, []);

  const sanitizeHex = (value: string): string => {
    return value.trim().toLowerCase().replace(/^0x/, '');
  };

  const parseBalance = (raw: string): number | null => {
    const cleaned = raw.replace(/[, _]/g, '');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return Math.floor(parsed);
  };

  const prepareAttestationHash = useCallback(async () => {
    if (!policy) {
      setError('Select a verifier policy before building a BTC attestation.');
      updateStatus('warning', 'Select a policy from the verifier first.');
      return;
    }

    const trimmedAddress = address.trim();
    if (!trimmedAddress) {
      setError('Enter a Bitcoin address.');
      updateStatus('error', 'Bitcoin address is required.');
      return;
    }

    const parsedBalance = parseBalance(balanceSats);
    if (parsedBalance === null) {
      setError('Enter a positive BTC balance in satoshis.');
      updateStatus('error', 'BTC balance (sats) must be a positive number.');
      return;
    }

    setIsPreparing(true);
    setError(null);
    try {
      const nowEpoch = Math.floor(Date.now() / 1000);
      const issuedAtEpoch = issuedAt || nowEpoch;
      const validUntilEpoch = issuedAtEpoch + validHours * 3600;

      const accountSeed = new TextEncoder().encode(`btc-${network}:${trimmedAddress}`);
      const blakeDigest = blake3(accountSeed);
      const accountField = normalizeField(bytesToBigIntBE(blakeDigest));
      const accountIdBytes = bigIntToLittleEndianBytes(accountField);
      const accountHex = bytesToHex(accountIdBytes);

      const circuitInput: CircuitInput = {
        attestation: {
          balance_raw: parsedBalance,
          currency_code_int: currencyCode,
          custodian_id: custodianId,
          attestation_id: attestationId,
          issued_at: issuedAtEpoch,
          valid_until: validUntilEpoch,
          account_id_hash: accountHex,
          custodian_pubkey: { x: new Array<number>(32).fill(0), y: new Array<number>(32).fill(0) },
          signature: {
            r: new Array<number>(32).fill(0),
            s: new Array<number>(32).fill(0),
          },
          message_hash: new Array<number>(32).fill(0),
        },
        public: {
          threshold_raw: threshold,
          required_currency_code: currencyCode,
          current_epoch: nowEpoch,
          verifier_scope_id: scopeId,
          policy_id: policyId,
          nullifier: ''.padEnd(64, '0'),
          custodian_pubkey_hash: ''.padEnd(64, '0'),
        },
      };

      const normalizedJson = JSON.stringify(circuitInput);
      const msgBytes = await wasmComputeAttestationMessageHash(normalizedJson);
      circuitInput.attestation.message_hash = numberArrayFromBytes(msgBytes);

      setBaseInput(circuitInput);
      setMessageHashBytes(msgBytes);
      setMessageHashHex(bytesToHex(msgBytes));
      setAccountBytes(accountIdBytes);
      setCurrentEpoch(nowEpoch);

      updateStatus(
        'success',
        'Attestation hash prepared. Sign the hash with your BTC key and paste the public key and signature below.',
      );
      onShowToast('BTC attestation hash ready. Sign it with your BTC wallet and paste the signature.', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error while preparing attestation hash.';
      setError(message);
      updateStatus('error', message);
      onShowToast(message, 'error');
    } finally {
      setIsPreparing(false);
    }
  }, [
    address,
    attestationId,
    balanceSats,
    currencyCode,
    custodianId,
    issuedAt,
    network,
    onShowToast,
    policy,
    policyId,
    scopeId,
    threshold,
    updateStatus,
    validHours,
  ]);

  const buildAttestation = useCallback(async () => {
    if (!policy) {
      setError('Select a verifier policy before building a BTC attestation.');
      updateStatus('warning', 'Select a policy from the verifier first.');
      return;
    }
    if (!baseInput || !messageHashBytes || !accountBytes) {
      setError('Prepare the attestation hash first.');
      updateStatus('warning', 'Run “Prepare attestation hash” before generating JSON.');
      return;
    }

    const pkHex = sanitizeHex(pubkeyHex);
    if (!pkHex) {
      setError('Paste the uncompressed secp256k1 public key for your BTC address.');
      updateStatus('error', 'BTC public key is required.');
      return;
    }

    const sigHex = sanitizeHex(signatureHex);
    if (!sigHex) {
      setError('Paste the 64-byte ECDSA signature (r||s) as hex.');
      updateStatus('error', 'BTC signature is required.');
      return;
    }

    setIsBuilding(true);
    setError(null);
    try {
      const pubkeyBytes = hexToBytes(pkHex);
      if (pubkeyBytes.length !== 65 && pubkeyBytes.length !== 33) {
        throw new Error('Public key must be 33-byte compressed or 65-byte uncompressed secp256k1 key.');
      }

      const point = secp256k1.Point.fromBytes(pubkeyBytes);
      const uncompressed = point.toBytes(false);
      const pubkeyX = uncompressed.slice(1, 33);
      const pubkeyY = uncompressed.slice(33);

      const sigBytes = hexToBytes(sigHex);
      if (sigBytes.length !== 64) {
        throw new Error('Signature must be a 64-byte (128 hex chars) compact ECDSA signature (r||s).');
      }

      // Verify against the already-Poseidon-hashed attestation message. We
      // disable the library's SHA-256 prehashing so it does not rely on
      // Node-only hash bindings (`hashes.sha256`) in the browser and so that
      // verification matches the exact digest stored in `message_hash`.
      const isValid = secp256k1.verify(sigBytes, messageHashBytes, uncompressed, {
        prehash: false,
      });
      if (!isValid) {
        throw new Error('Signature did not verify for this public key and attestation hash.');
      }

      const pubkeyHashBytes = await wasmComputeCustodianPubkeyHash(pubkeyX, pubkeyY);
      const nullifierBytes = await wasmComputeNullifier(
        accountBytes,
        BigInt(scopeId),
        BigInt(policyId),
        BigInt(currentEpoch),
      );

      const finalInput: CircuitInput = {
        ...baseInput,
        attestation: {
          ...baseInput.attestation,
          custodian_pubkey: {
            x: numberArrayFromBytes(pubkeyX),
            y: numberArrayFromBytes(pubkeyY),
          },
          signature: {
            r: numberArrayFromBytes(sigBytes.slice(0, 32)),
            s: numberArrayFromBytes(sigBytes.slice(32)),
          },
        },
        public: {
          ...baseInput.public,
          nullifier: bytesToHex(nullifierBytes),
          custodian_pubkey_hash: bytesToHex(pubkeyHashBytes),
        },
      };

      const attestationJson = JSON.stringify(finalInput, null, 2);
      onAttestationReady(attestationJson);
      updateStatus('success', 'BTC attestation JSON ready. Review it before proving.');
      onShowToast('BTC attestation JSON ready. Review JSON below before proving.', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to build BTC attestation JSON.';
      setError(message);
      updateStatus('error', message);
      onShowToast(message, 'error');
    } finally {
      setIsBuilding(false);
    }
  }, [
    accountBytes,
    baseInput,
    currentEpoch,
    messageHashBytes,
    onAttestationReady,
    onShowToast,
    policy,
    policyId,
    pubkeyHex,
    scopeId,
    signatureHex,
    updateStatus,
  ]);

  const copyMessageHash = useCallback(async () => {
    if (!messageHashHex) return;
    try {
      await navigator.clipboard.writeText(messageHashHex);
      onShowToast('BTC attestation hash copied to clipboard', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to copy hash to clipboard';
      onShowToast(message, 'error');
    }
  }, [messageHashHex, onShowToast]);

  return (
    <div className="wallet-connector btc-wallet-connector">
      <header>
        <p className="eyebrow">Bitcoin wallet attestation</p>
        <h3>Bind a BTC address with a signed attestation</h3>
      </header>

      <div className="wallet-grid">
        <div className="wallet-card">
          <div className="wallet-row">
            <strong>Network</strong>
            <select
              value={network}
              onChange={(event) => setNetwork(event.target.value as BtcNetwork)}
            >
              <option value="mainnet">Bitcoin mainnet</option>
              <option value="testnet">Bitcoin testnet</option>
            </select>
          </div>
          <div className="wallet-row">
            <strong>BTC address</strong>
            <input
              type="text"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="bc1… or 1…"
            />
          </div>
          <div className="wallet-row">
            <strong>Balance to attest (sats)</strong>
            <input
              type="text"
              value={balanceSats}
              onChange={(event) => setBalanceSats(event.target.value)}
              placeholder="e.g. 100000000 for 1 BTC"
            />
          </div>
          <p className="muted small">
            Use your indexer or custody system to determine the BTC balance you want to prove, then enter it in
            satoshis. The prover will enforce that this balance meets the selected policy threshold.
          </p>
          <div className="wallet-actions">
            <button
              type="button"
              onClick={prepareAttestationHash}
              disabled={isPreparing || !policy}
            >
              {isPreparing ? 'Preparing hash…' : 'Prepare attestation hash'}
            </button>
          </div>
        </div>

        <div className="wallet-card">
          <div className="wallet-row">
            <strong>Verifier policy</strong>
            <span>
              {policy ? policyShortSummary(policy) : 'Select a policy above'}
            </span>
          </div>
          {messageHashHex && (
            <>
              <div className="wallet-row">
                <strong>Attestation hash</strong>
                <span className="mono small-hash">{messageHashHex}</span>
              </div>
              <p className="muted small">
                Sign this 32-byte hash with the secp256k1 key that controls your BTC address. Use a tool that can sign
                a raw hash, then paste the public key and compact ECDSA signature below.
              </p>
              <div className="wallet-actions">
                <button type="button" className="ghost tiny-button" onClick={copyMessageHash}>
                  Copy hash
                </button>
              </div>
            </>
          )}
          <div className="wallet-row">
            <strong>BTC public key (secp256k1)</strong>
            <input
              type="text"
              value={pubkeyHex}
              onChange={(event) => setPubkeyHex(event.target.value)}
              placeholder="0x04… (65-byte uncompressed or 33-byte compressed hex)"
            />
          </div>
          <div className="wallet-row">
            <strong>Signature (r||s hex)</strong>
            <input
              type="text"
              value={signatureHex}
              onChange={(event) => setSignatureHex(event.target.value)}
              placeholder="64-byte compact ECDSA signature (128 hex chars)"
            />
          </div>
        </div>
      </div>

      <div className="wallet-actions">
        <button
          type="button"
          onClick={buildAttestation}
          disabled={isBuilding || !policy || !messageHashBytes}
        >
          {isBuilding ? 'Building BTC attestation…' : 'Generate BTC attestation JSON'}
        </button>
        {!policy && (
          <p className="muted small">
            Choose a verifier policy first so the BTC attestation can be checked against an explicit threshold and
            scope.
          </p>
        )}
      </div>

      {status && <p className={`wallet-status ${status.intent}`}>{status.message}</p>}
      {error && (
        <div className="error-message">
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}


