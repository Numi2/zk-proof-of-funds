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

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface WindowWithEthereum extends Window {
  ethereum?: EthereumProvider;
}

interface Props {
  onAttestationReady: (json: string) => void;
  onShowToast: (message: string, type?: 'success' | 'error') => void;
  policy?: PolicyDefinition | null;
}

type ZcashNetwork = 'main' | 'test';

interface StatusState {
  intent: StatusIntent;
  message: string;
}

const DEMO_UFVK_MAINNET =
  'uview1demo0f4zsc9qj0pdm3ntn7h0u4u2e9d4l7m0kqstt0a52f3a8q2t6sgv0p9mlc8v7ga8wdp3n2xk7m3c5qy8q2w0nh9gq2l8k0r0y0t0p0q';
const DEMO_SNAPSHOT_HEIGHT = 2700000;
const DEMO_BALANCE_ZATS = 5000000000;

export function ZcashWalletConnector({ onAttestationReady, onShowToast, policy }: Props) {
  const [zcashNetwork, setZcashNetwork] = useState<ZcashNetwork>('main');
  const [ufvk, setUfvk] = useState<string>('');
  const [snapshotHeightInput, setSnapshotHeightInput] = useState<string>('');
  const [balanceZatsInput, setBalanceZatsInput] = useState<string>('');

  const [evmAccount, setEvmAccount] = useState<string>('');
  const [evmChainId, setEvmChainId] = useState<string>('');

  const [zcashBalanceZats, setZcashBalanceZats] = useState<number | null>(null);
  const [snapshotHeight, setSnapshotHeight] = useState<number | null>(null);

  const [isConnectingEvm, setIsConnectingEvm] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isDemoSnapshot, setIsDemoSnapshot] = useState(false);

  const [status, setStatus] = useState<StatusState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [issuedAt] = useState<number>(() => Math.floor(Date.now() / 1000));
  const [validHours] = useState<number>(24);
  const [attestationId] = useState<number>(() => Math.floor(Math.random() * 1_000_000));

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const typedWindow = window as WindowWithEthereum;
    if (!typedWindow.ethereum) {
      setStatus({
        intent: 'warning',
        message:
          'Install an Ethereum browser wallet (MetaMask, Rabby, etc.) to sign Zcash proof-of-funds attestations.',
      });
    }
  }, []);

  useEffect(() => {
    if (!policy) {
      return;
    }
    setStatus({
      intent: 'info',
      message: `Using verifier policy ${policyShortSummary(policy)}.`,
    });
  }, [policy]);

  const updateStatus = useCallback((intent: StatusIntent, message: string) => {
    setStatus({ intent, message });
  }, []);

  const connectEvmWallet = useCallback(async () => {
    if (typeof window === 'undefined') {
      setError('Ethereum wallet connection is only available in a browser environment.');
      updateStatus('error', 'EVM signer connection is only available in a browser.');
      return;
    }
    const typedWindow = window as WindowWithEthereum;
    const provider = typedWindow.ethereum;
    if (!provider) {
      setError('No Ethereum wallet detected. Install MetaMask or another EVM wallet.');
      updateStatus(
        'warning',
        'No Ethereum wallet detected. Install MetaMask, Rabby, or another EVM wallet.',
      );
      return;
    }
    setIsConnectingEvm(true);
    setError(null);
    try {
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
      if (!accounts.length) {
        throw new Error('Wallet returned no accounts.');
      }
      const selected = accounts[0];
      setEvmAccount(selected);
      const chain = (await provider.request({ method: 'eth_chainId' })) as string;
      setEvmChainId(chain);
      updateStatus(
        'success',
        `Connected EVM signer ${selected.slice(0, 6)}…${selected.slice(-4)} on chain ${chain}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect Ethereum wallet';
      setError(message);
      updateStatus('error', message);
    } finally {
      setIsConnectingEvm(false);
    }
  }, [updateStatus]);

  const parsePositiveInt = (raw: string, fieldLabel: string): number | null => {
    const trimmed = raw.trim().replace(/[, _]/g, '');
    if (!trimmed) return null;
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value <= 0) {
      setError(`${fieldLabel} must be a positive number.`);
      updateStatus('error', `${fieldLabel} must be a positive number.`);
      return null;
    }
    return Math.floor(value);
  };

  const prepareSnapshotAndBalance = useCallback(() => {
    if (!ufvk.trim()) {
      setError('Paste a Unified Full Viewing Key (UFVK) first.');
      updateStatus('error', 'UFVK is required to build a Zcash balance summary.');
      return;
    }
    if (!policy) {
      setError('Select a verifier policy before building a Zcash attestation.');
      updateStatus('warning', 'Select a policy from the verifier first.');
      return;
    }

    const height = parsePositiveInt(snapshotHeightInput, 'Snapshot height');
    if (height === null) {
      return;
    }
    const balance = parsePositiveInt(balanceZatsInput, 'Shielded balance (zats)');
    if (balance === null) {
      return;
    }

    setSnapshotHeight(height);
    setZcashBalanceZats(balance);
    setIsDemoSnapshot(false);
    setError(null);
    updateStatus(
      'success',
      `Using manual Zcash snapshot at height ${height} with shielded balance ${balance.toLocaleString()} zats.`,
    );
    onShowToast(
      'Zcash snapshot and balance recorded. You can now generate a proof-of-funds attestation.',
      'success',
    );
  }, [
    balanceZatsInput,
    onShowToast,
    policy,
    snapshotHeightInput,
    ufvk,
    updateStatus,
  ]);

  const loadDemoSnapshot = useCallback(() => {
    if (!policy) {
      setError('Select a verifier policy before loading the demo UFVK.');
      updateStatus('warning', 'Select a policy from the verifier first.');
      return;
    }
    setUfvk(DEMO_UFVK_MAINNET);
    setSnapshotHeightInput(String(DEMO_SNAPSHOT_HEIGHT));
    setBalanceZatsInput(String(DEMO_BALANCE_ZATS));
    setSnapshotHeight(DEMO_SNAPSHOT_HEIGHT);
    setZcashBalanceZats(DEMO_BALANCE_ZATS);
    setIsDemoSnapshot(true);
    setError(null);
    updateStatus(
      'success',
      `Loaded demo UFVK with snapshot height ${DEMO_SNAPSHOT_HEIGHT} and balance ${(
        DEMO_BALANCE_ZATS / 100000000
      ).toLocaleString()} ZEC.`,
    );
    onShowToast('Demo Zcash UFVK and snapshot loaded.', 'success');
  }, [onShowToast, policy, updateStatus]);

  const buildAttestation = useCallback(async () => {
    if (!policy) {
      setError('Select a verifier policy before building a Zcash attestation.');
      updateStatus('warning', 'Select a policy from the verifier first.');
      return;
    }
    if (!ufvk.trim()) {
      setError('Paste a UFVK before building an attestation.');
      updateStatus('error', 'UFVK is required.');
      return;
    }
    if (zcashBalanceZats === null || snapshotHeight === null) {
      setError('Set a Zcash snapshot height and shielded balance first.');
      updateStatus('warning', 'Provide snapshot height and balance before generating attestation.');
      return;
    }
    const isDemo = isDemoSnapshot && !evmAccount;

    let provider: EthereumProvider | null = null;
    if (!isDemo) {
      if (typeof window === 'undefined') {
        setError('Ethereum wallet signing is only available in a browser environment.');
        updateStatus('error', 'EVM signer is only available in a browser.');
        return;
      }
      const typedWindow = window as WindowWithEthereum;
      provider = typedWindow.ethereum ?? null;
      if (!provider || !evmAccount) {
        setError('Connect an Ethereum wallet to sign the Zcash proof-of-funds attestation.');
        updateStatus('warning', 'Connect an EVM wallet as the signing key.');
        return;
      }
    }

    setIsBuilding(true);
    setError(null);

    try {
      const nowEpoch = Math.floor(Date.now() / 1000);
      const issuedAtEpoch = issuedAt || nowEpoch;
      const validUntilEpoch = issuedAtEpoch + validHours * 3600;

      const accountSeed = new TextEncoder().encode(
        `zcash:${zcashNetwork}:${ufvk.trim()}`,
      );
      const blakeDigest = blake3(accountSeed);
      const accountField = normalizeField(bytesToBigIntBE(blakeDigest));
      const accountBytes = bigIntToLittleEndianBytes(accountField);
      const accountHex = bytesToHex(accountBytes);

      const scopeBigInt = BigInt(policy.verifier_scope_id);
      const policyBigInt = BigInt(policy.policy_id);
      const epochBigInt = BigInt(nowEpoch);

      const circuitInput: CircuitInput = {
        attestation: {
          balance_raw: Math.floor(zcashBalanceZats),
          currency_code_int: policy.required_currency_code,
          custodian_id: policy.required_custodian_id,
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
          threshold_raw: policy.threshold_raw,
          required_currency_code: policy.required_currency_code,
          required_custodian_id: policy.required_custodian_id,
          current_epoch: nowEpoch,
          verifier_scope_id: policy.verifier_scope_id,
          policy_id: policy.policy_id,
          nullifier: ''.padEnd(64, '0'),
          custodian_pubkey_hash: ''.padEnd(64, '0'),
        },
      };

      const normalizedJson = JSON.stringify(circuitInput);
      const messageHashBytes = await wasmComputeAttestationMessageHash(normalizedJson);
      circuitInput.attestation.message_hash = numberArrayFromBytes(messageHashBytes);

      let pubkeyX: Uint8Array;
      let pubkeyY: Uint8Array;
      let rBytes: Uint8Array;
      let sBytes: Uint8Array;

      if (isDemo) {
        // Demo path: generate a synthetic signing key locally so users can see
        // a full end-to-end flow without installing an EVM wallet.
        const demoPrivKey = secp256k1.utils.randomSecretKey();
        const signature = await secp256k1.sign(messageHashBytes, demoPrivKey);
        const uncompressed = secp256k1.getPublicKey(demoPrivKey, false) as Uint8Array;
        pubkeyX = uncompressed.slice(1, 33);
        pubkeyY = uncompressed.slice(33);
        rBytes = signature.slice(0, 32);
        sBytes = signature.slice(32, 64);
      } else {
        const messageHex = bytesToHex(messageHashBytes);
        const signatureHex = (await provider!.request({
          method: 'eth_sign',
          params: [evmAccount, `0x${messageHex}`],
        })) as string;

        if (signatureHex.length !== 132 && signatureHex.length !== 130) {
          throw new Error('Wallet returned an unexpected signature format.');
        }
        const rHex = signatureHex.slice(2, 66);
        const sHex = signatureHex.slice(66, 130);
        const recoveryHex = signatureHex.slice(130, 132) || '1b';
        const recovery = Number.parseInt(recoveryHex, 16);
        const recoveryBit = recovery >= 27 ? recovery - 27 : recovery;
        const compactSig = hexToBytes(rHex + sHex);
        const recoveredSig = new Uint8Array(1 + compactSig.length);
        recoveredSig[0] = recoveryBit;
        recoveredSig.set(compactSig, 1);
        const recoveredBytes = secp256k1.recoverPublicKey(recoveredSig, messageHashBytes, {
          prehash: false,
        });
        if (!recoveredBytes) {
          throw new Error('Wallet public key recovery failed.');
        }
        const pubkeyPoint = secp256k1.Point.fromBytes(recoveredBytes);
        const uncompressed = pubkeyPoint.toBytes(false);
        pubkeyX = uncompressed.slice(1, 33);
        pubkeyY = uncompressed.slice(33);
        rBytes = hexToBytes(rHex);
        sBytes = sHex ? hexToBytes(sHex) : new Uint8Array(32);
      }

      circuitInput.attestation.custodian_pubkey = {
        x: numberArrayFromBytes(pubkeyX),
        y: numberArrayFromBytes(pubkeyY),
      };
      circuitInput.attestation.signature = {
        r: numberArrayFromBytes(rBytes),
        s: numberArrayFromBytes(sBytes),
      };

      const pubkeyHashBytes = await wasmComputeCustodianPubkeyHash(pubkeyX, pubkeyY);
      circuitInput.public.custodian_pubkey_hash = bytesToHex(pubkeyHashBytes);

      const nullifierBytes = await wasmComputeNullifier(
        accountBytes,
        scopeBigInt,
        policyBigInt,
        epochBigInt,
      );
      circuitInput.public.nullifier = bytesToHex(nullifierBytes);

      const attestationJson = JSON.stringify(circuitInput, null, 2);
      onAttestationReady(attestationJson);
      onShowToast('Zcash wallet attestation ready. Generating proof bundle…', 'success');
      updateStatus(
        'success',
        'Zcash wallet attestation ready. It will be bound to the selected verifier policy.',
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to build Zcash wallet attestation JSON.';
      setError(message);
      updateStatus('error', message);
      onShowToast(message, 'error');
    } finally {
      setIsBuilding(false);
    }
  }, [
    evmAccount,
    issuedAt,
    onAttestationReady,
    onShowToast,
    policy,
    snapshotHeight,
    updateStatus,
    validHours,
    zcashBalanceZats,
    zcashNetwork,
    ufvk,
    attestationId,
    isDemoSnapshot,
  ]);

  return (
    <div className="wallet-connector zcash-wallet-connector">
      <header>
        <p className="eyebrow">Zcash wallet attestation</p>
        <h3>Import UFVK, sync, and generate JSON</h3>
      </header>

      <div className="wallet-grid">
        <div className="wallet-card">
          <div className="wallet-row">
            <strong>Zcash network</strong>
            <select
              value={zcashNetwork}
              onChange={(event) => setZcashNetwork(event.target.value as ZcashNetwork)}
            >
              <option value="main">Mainnet</option>
              <option value="test">Testnet</option>
            </select>
          </div>
          <div className="wallet-row">
            <strong>UFVK</strong>
            <textarea
              value={ufvk}
              onChange={(event) => setUfvk(event.target.value)}
              placeholder="uview1..."
              rows={3}
            />
          </div>
          <div className="wallet-row">
            <strong>Snapshot height</strong>
            <input
              type="text"
              value={snapshotHeightInput}
              onChange={(event) => setSnapshotHeightInput(event.target.value)}
              placeholder="e.g. 2700000"
            />
          </div>
          <div className="wallet-row">
            <strong>Shielded balance (zats)</strong>
            <input
              type="text"
              value={balanceZatsInput}
              onChange={(event) => setBalanceZatsInput(event.target.value)}
              placeholder="e.g. 100000000 for 1 ZEC"
            />
          </div>
          <p className="muted small">
            Import a view-only Unified Full Viewing Key from any Zcash wallet (Zashi, YWallet,
            Zingo, etc.), then provide a snapshot height and the shielded balance (in zats) you
            want to prove. 
          </p>
          <div className="wallet-actions">
            <button type="button" onClick={prepareSnapshotAndBalance}>
              Use snapshot & balance
            </button>
            <button type="button" className="ghost tiny-button" onClick={loadDemoSnapshot}>
              Load demo UFVK & snapshot
            </button>
          </div>
        </div>

        <div className="wallet-card">
          <div className="wallet-row">
            <strong>EVM signer</strong>
            <span>{evmAccount || 'Not connected'}</span>
          </div>
          <div className="wallet-row">
            <strong>Chain ID</strong>
            <span>{evmChainId || '—'}</span>
          </div>
          <p className="muted small">
            The EVM wallet acts as the signing key for the proof-of-funds attestation. Share this
            public key with your counterparties or custody systems so they can authorize and audit
            proofs built with it.
          </p>
          <div className="wallet-actions">
            <button type="button" onClick={connectEvmWallet} disabled={isConnectingEvm}>
              {isConnectingEvm ? 'Connecting…' : evmAccount ? 'Reconnect signer' : 'Connect EVM signer'}
            </button>
          </div>

          {zcashBalanceZats !== null && snapshotHeight !== null && (
            <>
              <div className="wallet-row">
                <strong>Shielded balance (zats)</strong>
                <span>{zcashBalanceZats.toLocaleString()}</span>
              </div>
              <div className="wallet-row">
                <strong>Snapshot height</strong>
                <span>{snapshotHeight}</span>
              </div>
            </>
          )}

          <div className="wallet-row">
            <strong>Policy</strong>
            <span>{policy ? policyShortSummary(policy) : 'Select a policy above'}</span>
          </div>
        </div>
      </div>

      <div className="wallet-actions">
        <button
          type="button"
          onClick={buildAttestation}
          disabled={
            isBuilding ||
            !policy ||
            zcashBalanceZats === null ||
            snapshotHeight === null ||
            (!evmAccount && !isDemoSnapshot)
          }
        >
          {isBuilding ? 'Building Zcash attestation…' : 'Generate Zcash attestation JSON'}
        </button>
        {!policy && (
          <p className="muted small">
            Choose a verifier policy first so the Zcash attestation can be checked against an
            explicit threshold and scope.
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


