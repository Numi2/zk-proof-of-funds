import { useCallback, useEffect, useMemo, useState } from 'react';
import { blake3 } from '@noble/hashes/blake3.js';
import * as secp256k1 from '@noble/secp256k1';
import type { CircuitInput } from '../types/zkpf';
import { wasmComputeAttestationMessageHash, wasmComputeCustodianPubkeyHash, wasmComputeNullifier } from '../wasm/prover';
import { bigIntToLittleEndianBytes, bytesToBigIntBE, bytesToHex, hexToBytes, normalizeField, numberArrayFromBytes } from '../utils/field';

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
};

interface WindowWithEthereum extends Window {
  ethereum?: EthereumProvider;
}

interface Props {
  onAttestationReady: (json: string) => void;
  onShowToast: (message: string, type?: 'success' | 'error') => void;
}

type StatusIntent = 'info' | 'success' | 'warning' | 'error';

const DEFAULT_VALIDITY_HOURS = 24;
const DEFAULT_THRESHOLD = 1_000_000_000;
const DEFAULT_POLICY_ID = 2718;
const DEFAULT_SCOPE_ID = 314159;
const DEFAULT_CURRENCY = 840;
const DEFAULT_CUSTODIAN_ID = 77;

export function WalletConnector({ onAttestationReady, onShowToast }: Props) {
  const provider = useMemo(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    const typedWindow = window as WindowWithEthereum;
    return typedWindow.ethereum ?? null;
  }, []);
  const [account, setAccount] = useState<string>('');
  const [chainId, setChainId] = useState<string>('');
  const [balanceWei, setBalanceWei] = useState<bigint>(0n);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [status, setStatus] = useState<{ intent: StatusIntent; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issuedAt, setIssuedAt] = useState<number>(() => Math.floor(Date.now() / 1000));
  const [validHours, setValidHours] = useState<number>(DEFAULT_VALIDITY_HOURS);
  const [balanceOverride, setBalanceOverride] = useState<number | ''>('');
  const [threshold, setThreshold] = useState<number>(DEFAULT_THRESHOLD);
  const [policyId, setPolicyId] = useState<number>(DEFAULT_POLICY_ID);
  const [scopeId, setScopeId] = useState<number>(DEFAULT_SCOPE_ID);
  const [currencyCode, setCurrencyCode] = useState<number>(DEFAULT_CURRENCY);
  const [custodianId, setCustodianId] = useState<number>(DEFAULT_CUSTODIAN_ID);
  const [currentEpoch, setCurrentEpoch] = useState<number>(() => Math.floor(Date.now() / 1000));
  const [attestationId, setAttestationId] = useState<number>(() => Math.floor(Math.random() * 1_000_000));

  useEffect(() => {
    if (!provider) {
      setStatus({ intent: 'warning', message: 'Install an EIP-1193 wallet (MetaMask, Rabby, etc.) to auto-build attestations.' });
    }
  }, [provider]);

  const updateStatus = useCallback((intent: StatusIntent, message: string) => {
    setStatus({ intent, message });
  }, []);

  const connectWallet = useCallback(async () => {
    if (!provider) {
      setError('No wallet detected. Install MetaMask or another EIP-1193 provider.');
      return;
    }
    setIsConnecting(true);
    setError(null);
    try {
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
      if (!accounts.length) {
        throw new Error('Wallet returned no accounts.');
      }
      const selected = accounts[0];
      setAccount(selected);
      const chain = (await provider.request({ method: 'eth_chainId' })) as string;
      setChainId(chain);
      const balanceHex = (await provider.request({
        method: 'eth_getBalance',
        params: [selected, 'latest'],
      })) as string;
      setBalanceWei(BigInt(balanceHex));
      updateStatus('success', `Connected to ${selected.slice(0, 6)}…${selected.slice(-4)} on chain ${chain}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet';
      setError(message);
      updateStatus('error', message);
    } finally {
      setIsConnecting(false);
    }
  }, [provider, updateStatus]);

  const refreshBalance = useCallback(async () => {
    if (!provider || !account) {
      return;
    }
    try {
      const balanceHex = (await provider.request({
        method: 'eth_getBalance',
        params: [account, 'latest'],
      })) as string;
      setBalanceWei(BigInt(balanceHex));
      updateStatus('success', 'Balance refreshed from wallet');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh balance';
      setError(message);
      updateStatus('error', message);
    }
  }, [provider, account, updateStatus]);

  const derivedBalance = useMemo(() => {
    if (!balanceWei) return 0;
    // Convert to a rough 1e-9 granularity to keep the u64 limits happy.
    return Number(balanceWei / 1_000_000_000n);
  }, [balanceWei]);

  const prepareAttestation = useCallback(async () => {
    if (!provider) {
      setError('Connect a wallet before generating an attestation.');
      return;
    }
    if (!account) {
      setError('No wallet account selected.');
      return;
    }
    setIsBuilding(true);
    setError(null);
    try {
      const normalizedAddress = account.toLowerCase();
      const scopeBigInt = BigInt(scopeId);
      const policyBigInt = BigInt(policyId);
      const epochBigInt = BigInt(currentEpoch);
      const issuedAtEpoch = issuedAt || Math.floor(Date.now() / 1000);
      const validUntilEpoch = issuedAtEpoch + validHours * 3600;
      const attestationBalance = typeof balanceOverride === 'number' ? balanceOverride : derivedBalance;
      if (!Number.isFinite(attestationBalance) || attestationBalance <= 0) {
        throw new Error('Set a positive balance to attest.');
      }

      const accountSeed = new TextEncoder().encode(`${chainId || '0x0'}:${normalizedAddress}`);
      const blakeDigest = blake3(accountSeed);
      const accountField = normalizeField(bytesToBigIntBE(blakeDigest));
      const accountBytes = bigIntToLittleEndianBytes(accountField);
      const accountHex = bytesToHex(accountBytes);

      const circuitInput: CircuitInput = {
        attestation: {
          balance_raw: Math.floor(attestationBalance),
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
          required_custodian_id: custodianId,
          current_epoch: currentEpoch,
          verifier_scope_id: scopeId,
          policy_id: policyId,
          nullifier: ''.padEnd(64, '0'),
          custodian_pubkey_hash: ''.padEnd(64, '0'),
        },
      };

      const normalizedJson = JSON.stringify(circuitInput);
      const messageHashBytes = await wasmComputeAttestationMessageHash(normalizedJson);
      circuitInput.attestation.message_hash = numberArrayFromBytes(messageHashBytes);

      const messageHex = bytesToHex(messageHashBytes);
      const signatureHex = (await provider.request({
        method: 'eth_sign',
        params: [account, `0x${messageHex}`],
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
      const recoveredBytes = secp256k1.recoverPublicKey(recoveredSig, messageHashBytes, { prehash: false });
      if (!recoveredBytes) {
        throw new Error('Wallet public key recovery failed.');
      }
      const pubkeyPoint = secp256k1.Point.fromBytes(recoveredBytes);
      const uncompressed = pubkeyPoint.toBytes(false);
      const pubkeyX = uncompressed.slice(1, 33);
      const pubkeyY = uncompressed.slice(33);
      circuitInput.attestation.custodian_pubkey = {
        x: numberArrayFromBytes(pubkeyX),
        y: numberArrayFromBytes(pubkeyY),
      };
      circuitInput.attestation.signature = {
        r: numberArrayFromBytes(hexToBytes(rHex)),
        s: numberArrayFromBytes(hexToBytes(sHex)),
      };

      const pubkeyHashBytes = await wasmComputeCustodianPubkeyHash(pubkeyX, pubkeyY);
      circuitInput.public.custodian_pubkey_hash = bytesToHex(pubkeyHashBytes);

      const nullifierBytes = await wasmComputeNullifier(accountBytes, scopeBigInt, policyBigInt, epochBigInt);
      circuitInput.public.nullifier = bytesToHex(nullifierBytes);

      const attestationJson = JSON.stringify(circuitInput, null, 2);
      onAttestationReady(attestationJson);
      onShowToast('Wallet attestation ready. Review JSON below before proving.', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to build wallet attestation';
      setError(message);
      onShowToast(message, 'error');
    } finally {
      setIsBuilding(false);
    }
  }, [
    provider,
    account,
    chainId,
    scopeId,
    policyId,
    currentEpoch,
    issuedAt,
    validHours,
    balanceOverride,
    derivedBalance,
    currencyCode,
    custodianId,
    threshold,
    attestationId,
    onAttestationReady,
    onShowToast,
  ]);

  return (
    <div className="wallet-connector">
      <header>
        <p className="eyebrow">Non-custodial attestation</p>
        <h3>Connect a wallet to auto-fill attestation JSON</h3>
        <p className="muted small">
          Wallet balances stay client-side. The attestation JSON and zk bundle never leave the browser.
        </p>
      </header>

      <div className="wallet-grid">
        <div className="wallet-card">
          <div className="wallet-row">
            <strong>Wallet</strong>
            <span>{account || 'Not connected'}</span>
          </div>
          <div className="wallet-row">
            <strong>Chain ID</strong>
            <span>{chainId || '—'}</span>
          </div>
          <div className="wallet-row">
            <strong>Balance (wei)</strong>
            <span>{balanceWei ? balanceWei.toString() : '0'}</span>
          </div>
          <div className="wallet-actions">
            <button type="button" onClick={connectWallet} disabled={isConnecting}>
              {isConnecting ? 'Connecting…' : account ? 'Reconnect' : 'Connect wallet'}
            </button>
            <button type="button" className="ghost" onClick={refreshBalance} disabled={!account || isConnecting}>
              Refresh balance
            </button>
          </div>
        </div>

        <div className="wallet-card">
          <div className="wallet-row">
            <label htmlFor="balanceRaw">
              Balance to attest (minor units)
              <input
                id="balanceRaw"
                type="number"
                value={balanceOverride === '' ? '' : balanceOverride}
                onChange={(event) => {
                  const value = event.target.value;
                  setBalanceOverride(value === '' ? '' : Number(value));
                }}
                placeholder={derivedBalance.toString()}
              />
            </label>
          </div>
          <div className="wallet-form-grid">
            <label>
              Threshold
              <input type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
            </label>
            <label>
              Policy ID
              <input type="number" value={policyId} onChange={(e) => setPolicyId(Number(e.target.value))} />
            </label>
            <label>
              Scope ID
              <input type="number" value={scopeId} onChange={(e) => setScopeId(Number(e.target.value))} />
            </label>
            <label>
              Custodian ID
              <input type="number" value={custodianId} onChange={(e) => setCustodianId(Number(e.target.value))} />
            </label>
            <label>
              Currency code
              <input type="number" value={currencyCode} onChange={(e) => setCurrencyCode(Number(e.target.value))} />
            </label>
            <label>
              Attestation ID
              <input type="number" value={attestationId} onChange={(e) => setAttestationId(Number(e.target.value))} />
            </label>
          </div>
          <div className="wallet-form-grid">
            <label>
              Issued at (epoch seconds)
              <input type="number" value={issuedAt} onChange={(e) => setIssuedAt(Number(e.target.value))} />
            </label>
            <label>
              Valid window (hours)
              <input type="number" value={validHours} onChange={(e) => setValidHours(Number(e.target.value))} />
            </label>
            <label>
              Current epoch
              <input type="number" value={currentEpoch} onChange={(e) => setCurrentEpoch(Number(e.target.value))} />
            </label>
          </div>
        </div>
      </div>

      <div className="wallet-actions">
        <button type="button" onClick={prepareAttestation} disabled={!account || isBuilding}>
          {isBuilding ? 'Building attestation…' : 'Generate attestation JSON'}
        </button>
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

