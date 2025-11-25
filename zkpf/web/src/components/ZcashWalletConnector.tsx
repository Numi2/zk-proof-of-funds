import { useCallback, useEffect, useMemo, useState } from 'react';
import { blake3 } from '@noble/hashes/blake3.js';
import { hmac } from '@noble/hashes/hmac.js';
import { concatBytes } from '@noble/hashes/utils.js';
import * as secp256k1 from '@noble/secp256k1';
import { generate_seed_phrase } from '@chainsafe/webzjs-keys';
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
import { useWebZjsContext } from '../context/WebzjsContext';
import { useWebzjsActions } from '../hooks/useWebzjsActions';

// Noble secp256k1 relies on user-supplied sync hash functions in some code paths
// (HMAC-DRBG / prehash). In the browser we prefer BLAKE3 over SHA-256, so wire
// BLAKE3-based helpers into the library once at module load.
// Cast through `any` to avoid depending on upstream TS typings for `utils`.
const nobleUtils = secp256k1.utils as any;
if (!nobleUtils.sha256Sync) {
  nobleUtils.sha256Sync = (...messages: Uint8Array[]) => blake3(concatBytes(...messages));
}
if (!nobleUtils.hmacSha256Sync) {
  nobleUtils.hmacSha256Sync = (key: Uint8Array, ...messages: Uint8Array[]) =>
    hmac(blake3, key, concatBytes(...messages));
}

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
type WalletMethod = 'snap' | 'seed' | 'manual';

interface StatusState {
  intent: StatusIntent;
  message: string;
}

const DEMO_UFVK_MAINNET =
  'uview1demo0f4zsc9qj0pdm3ntn7h0u4u2e9d4l7m0kqstt0a52f3a8q2t6sgv0p9mlc8v7ga8wdp3n2xk7m3c5qy8q2w0nh9gq2l8k0r0y0t0p0q';
const DEMO_SNAPSHOT_HEIGHT = 2700000;
const DEMO_BALANCE_ZATS = 50000000000;

export function ZcashWalletConnector({ onAttestationReady, onShowToast, policy }: Props) {
  const { state: walletState } = useWebZjsContext();
  const { connectWebZjsSnap, triggerRescan, createAccountFromSeed } = useWebzjsActions();

  // Wallet method selection
  const [walletMethod, setWalletMethod] = useState<WalletMethod>('seed');

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

  const [seedPhraseInput, setSeedPhraseInput] = useState('');
  const [seedBirthdayInput, setSeedBirthdayInput] = useState('');
  const [isCreatingFromSeed, setIsCreatingFromSeed] = useState(false);
  const [isConnectingSnap, setIsConnectingSnap] = useState(false);

  const [issuedAt] = useState<number>(() => Math.floor(Date.now() / 1000));
  const [validHours] = useState<number>(24);
  const [attestationId] = useState<number>(() => Math.floor(Math.random() * 1_000_000));

  const activeAccountReport = useMemo(() => {
    if (!walletState.summary || walletState.activeAccount == null) {
      return undefined;
    }
    return walletState.summary.account_balances.find(
      ([accountId]) => accountId === walletState.activeAccount,
    );
  }, [walletState.summary, walletState.activeAccount]);

  const derivedShieldedBalance = useMemo(() => {
    if (!activeAccountReport) return null;
    const balance = activeAccountReport[1];
    return balance.sapling_balance + balance.orchard_balance;
  }, [activeAccountReport]);

  const derivedSnapshotHeight = useMemo(() => {
    if (!walletState.summary) return null;
    return walletState.summary.fully_scanned_height ?? walletState.summary.chain_tip_height;
  }, [walletState.summary]);

  // Check if WebWallet is available (SharedArrayBuffer support)
  const isWebWalletAvailable = walletState.webWallet !== null;

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

  useEffect(() => {
    if (!derivedShieldedBalance || !derivedSnapshotHeight) {
      return;
    }
    // Auto-populate snapshot and balance from WebWallet when available.
    setSnapshotHeight(derivedSnapshotHeight);
    setZcashBalanceZats(derivedShieldedBalance);
  }, [derivedShieldedBalance, derivedSnapshotHeight]);

  const updateStatus = useCallback((intent: StatusIntent, message: string) => {
    setStatus({ intent, message });
  }, []);

  const connectZcashWebWallet = useCallback(async () => {
    setIsConnectingSnap(true);
    setError(null);
    try {
      await connectWebZjsSnap();
      updateStatus(
        'success',
        'Connected Zcash WebWallet via MetaMask Snap. You can now sync and derive balances.',
      );
      onShowToast('Connected Zcash WebWallet via MetaMask Snap.', 'success');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to connect Zcash WebWallet Snap.';
      setError(message);
      updateStatus('error', message);
      onShowToast(message, 'error');
    } finally {
      setIsConnectingSnap(false);
    }
  }, [connectWebZjsSnap, onShowToast, updateStatus]);

  const rescanZcashWallet = useCallback(async () => {
    try {
      await triggerRescan();
      updateStatus('info', 'Rescanned Zcash WebWallet. Balances will refresh shortly.');
      onShowToast('Rescanned Zcash WebWallet.', 'success');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to rescan Zcash WebWallet.';
      setError(message);
      updateStatus('error', message);
      onShowToast(message, 'error');
    }
  }, [triggerRescan, onShowToast, updateStatus]);

  const handleGenerateSeed = useCallback(() => {
    try {
      // Use the real BIP-39 seed generator from webzjs-keys
      // This generates a proper 24-word mnemonic with correct checksum
      const newSeed = generate_seed_phrase();
      setSeedPhraseInput(newSeed);
      setError(null);
      updateStatus(
        'warning',
        '⚠️ New seed phrase generated. SAVE IT SECURELY before proceeding! This is the only way to recover your wallet.',
      );
      onShowToast('New seed phrase generated. Save it securely!', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate seed phrase';
      setError(message);
      updateStatus('error', message);
      onShowToast(message, 'error');
    }
  }, [onShowToast, updateStatus]);

  const handleCreateWalletFromSeed = useCallback(async () => {
    const phrase = seedPhraseInput.trim();
    if (!phrase) {
      setError('Enter a 24-word Zcash seed phrase before creating a wallet.');
      updateStatus('error', 'Seed phrase is required.');
      return;
    }

    const wordCount = phrase.split(/\s+/).length;
    if (wordCount !== 24) {
      setError(`Seed phrase must be exactly 24 words (you entered ${wordCount}).`);
      updateStatus('error', 'Seed phrase must be 24 words.');
      return;
    }

    let birthday: number | null = null;
    if (seedBirthdayInput.trim()) {
      const parsed = Number(seedBirthdayInput.trim().replace(/[, _]/g, ''));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setError('Birthday height must be a positive integer.');
        updateStatus('error', 'Birthday height must be a positive integer.');
        return;
      }
      birthday = Math.floor(parsed);
    }

    setIsCreatingFromSeed(true);
    setError(null);
    try {
      await createAccountFromSeed(phrase, birthday);
      updateStatus(
        'success',
        'Created Zcash wallet from seed phrase. Sync to refresh balances before building an attestation.',
      );
      onShowToast('Created Zcash wallet from seed phrase.', 'success');
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to create Zcash wallet from the provided seed phrase.';
      setError(message);
      updateStatus('error', message);
      onShowToast(message, 'error');
    } finally {
      setIsCreatingFromSeed(false);
    }
  }, [seedPhraseInput, seedBirthdayInput, createAccountFromSeed, onShowToast, updateStatus]);

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
    const effectiveBalance =
      zcashBalanceZats ?? (derivedShieldedBalance !== null ? derivedShieldedBalance : null);
    const effectiveSnapshotHeight =
      snapshotHeight ?? (derivedSnapshotHeight !== null ? derivedSnapshotHeight : null);

    if (effectiveBalance === null || effectiveSnapshotHeight === null) {
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
          balance_raw: Math.floor(effectiveBalance),
          currency_code_int: policy.required_currency_code,
          custodian_id: 0,
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
        const signature = await secp256k1.signAsync(messageHashBytes, demoPrivKey, {
          prehash: false,
        });
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
    derivedShieldedBalance,
    derivedSnapshotHeight,
  ]);

  return (
    <div className="wallet-connector zcash-wallet-connector">
      <header>
        <p className="eyebrow">Zcash wallet attestation</p>
        <h3>Create or import a Zcash wallet, then generate proof</h3>
      </header>

      {/* Wallet Method Tabs */}
      <div className="wallet-method-tabs">
        <button
          type="button"
          className={`wallet-method-tab ${walletMethod === 'seed' ? 'active' : ''}`}
          onClick={() => setWalletMethod('seed')}
        >
          <span className="wallet-method-icon">🌱</span>
          <span className="wallet-method-label">Seed Phrase</span>
          <span className="wallet-method-badge recommended">Recommended</span>
        </button>
        <button
          type="button"
          className={`wallet-method-tab ${walletMethod === 'snap' ? 'active' : ''}`}
          onClick={() => setWalletMethod('snap')}
        >
          <span className="wallet-method-icon">🦊</span>
          <span className="wallet-method-label">MetaMask Snap</span>
        </button>
        <button
          type="button"
          className={`wallet-method-tab ${walletMethod === 'manual' ? 'active' : ''}`}
          onClick={() => setWalletMethod('manual')}
        >
          <span className="wallet-method-icon">📋</span>
          <span className="wallet-method-label">Manual UFVK</span>
        </button>
      </div>

      <div className="wallet-grid">
        {/* Left Card - Wallet Creation Method */}
        <div className="wallet-card">
          {walletMethod === 'seed' && (
            <div className="wallet-method-content">
              <div className="wallet-method-header">
                <h4>🌱 Create Wallet from Seed Phrase</h4>
                <p className="muted small">
                  Create a Zcash wallet directly in your browser using a 24-word seed phrase.
                  No MetaMask required. Keys are stored locally in your browser.
                </p>
              </div>

              {!isWebWalletAvailable && (
                <div className="wallet-warning">
                  <span className="warning-icon">⚠️</span>
                  <span>
                    WebWallet requires SharedArrayBuffer support. Make sure your browser supports
                    cross-origin isolation, or try a different browser.
                  </span>
                </div>
              )}

              <div className="wallet-row">
                <strong>Seed phrase (24 words)</strong>
                <div className="seed-input-wrapper">
                  <textarea
                    value={seedPhraseInput}
                    onChange={(event) => setSeedPhraseInput(event.target.value)}
                    placeholder="Enter your 24-word seed phrase, or generate a new one..."
                    rows={3}
                    className="seed-textarea"
                  />
                </div>
              </div>
              <div className="wallet-actions seed-actions">
                <button
                  type="button"
                  className="ghost tiny-button"
                  onClick={handleGenerateSeed}
                >
                  🎲 Generate New Seed
                </button>
              </div>

              <div className="wallet-row">
                <strong>Birthday height (optional)</strong>
                <input
                  type="text"
                  value={seedBirthdayInput}
                  onChange={(event) => setSeedBirthdayInput(event.target.value)}
                  placeholder="Block height when wallet first received funds"
                />
              </div>
              <p className="muted small">
                Leave birthday empty for new wallets. For existing wallets, enter the approximate
                block height when your wallet first received funds to speed up initial sync.
              </p>

              <div className="wallet-actions">
                <button
                  type="button"
                  onClick={handleCreateWalletFromSeed}
                  disabled={isCreatingFromSeed || !isWebWalletAvailable || !seedPhraseInput.trim()}
                >
                  {isCreatingFromSeed ? 'Creating wallet…' : 'Create Wallet from Seed'}
                </button>
              </div>
            </div>
          )}

          {walletMethod === 'snap' && (
            <div className="wallet-method-content">
              <div className="wallet-method-header">
                <h4>🦊 MetaMask Snap Integration</h4>
                <p className="muted small">
                  Create or connect a Zcash wallet via MetaMask Snap. Your keys stay securely
                  inside MetaMask. Requires MetaMask Flask or MetaMask with Snaps support.
                </p>
              </div>

              {!isWebWalletAvailable && (
                <div className="wallet-warning">
                  <span className="warning-icon">⚠️</span>
                  <span>
                    WebWallet requires SharedArrayBuffer support. MetaMask Snap integration
                    may not work in this browser environment.
                  </span>
                </div>
              )}

              <div className="wallet-actions">
                <button
                  type="button"
                  onClick={connectZcashWebWallet}
                  disabled={walletState.loading || !isWebWalletAvailable || isConnectingSnap}
                >
                  {isConnectingSnap
                    ? 'Connecting…'
                    : walletState.activeAccount != null
                    ? 'Reconnect via MetaMask Snap'
                    : 'Connect MetaMask Snap'}
                </button>
              </div>

              <p className="muted small">
                The MetaMask Snap securely stores your Zcash keys. When you connect, a new
                Zcash account will be created or an existing one restored.
              </p>
            </div>
          )}

          {walletMethod === 'manual' && (
            <div className="wallet-method-content">
              <div className="wallet-method-header">
                <h4>📋 Manual UFVK Entry</h4>
                <p className="muted small">
                  Import a view-only Unified Full Viewing Key from any Zcash wallet (Zashi, YWallet,
                  Zingo, etc.). Manually provide the snapshot height and balance.
                </p>
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

              <div className="wallet-actions">
                <button type="button" onClick={prepareSnapshotAndBalance}>
                  Use Snapshot & Balance
                </button>
                <button type="button" className="ghost tiny-button" onClick={loadDemoSnapshot}>
                  Load Demo UFVK
                </button>
              </div>
            </div>
          )}

          {/* Common settings for all methods */}
          <div className="wallet-common-settings">
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

            {/* UFVK field for seed and snap methods */}
            {walletMethod !== 'manual' && (
              <div className="wallet-row">
                <strong>UFVK (auto-derived or paste)</strong>
                <textarea
                  value={ufvk}
                  onChange={(event) => setUfvk(event.target.value)}
                  placeholder="Will be auto-populated after wallet creation, or paste your UFVK"
                  rows={2}
                />
              </div>
            )}
          </div>
        </div>

        {/* Right Card - EVM Signer & Status */}
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
            <button
              type="button"
              className="ghost tiny-button"
              onClick={rescanZcashWallet}
              disabled={walletState.syncInProgress || !isWebWalletAvailable}
            >
              {walletState.syncInProgress ? 'Syncing…' : 'Sync Zcash Wallet'}
            </button>
          </div>

          {(zcashBalanceZats !== null || derivedShieldedBalance !== null) &&
            (snapshotHeight !== null || derivedSnapshotHeight !== null) && (
            <>
              <div className="wallet-row">
                <strong>Shielded balance (zats)</strong>
                <span>
                  {(zcashBalanceZats ?? derivedShieldedBalance ?? 0).toLocaleString()}
                  {derivedShieldedBalance !== null && zcashBalanceZats === null && ' (from WebWallet)'}
                </span>
              </div>
              <div className="wallet-row">
                <strong>Snapshot height</strong>
                <span>
                  {snapshotHeight ?? derivedSnapshotHeight}
                  {derivedSnapshotHeight !== null && snapshotHeight === null && ' (fully scanned height)'}
                </span>
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
            !ufvk.trim() ||
            (zcashBalanceZats === null &&
              snapshotHeight === null &&
              (derivedShieldedBalance === null || derivedSnapshotHeight === null)) ||
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
