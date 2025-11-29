/**
 * Multi-Wallet Authentication Context
 * 
 * Unified authentication layer supporting:
 * - Solana Wallet (Phantom, Solflare, Backpack, etc.)
 * - NEAR Wallet via near-connect (HOT, Meteor, MyNearWallet, Nightly, etc.)
 * - Passkey (WebAuthn/FIDO2)
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { NearConnector } from '@hot-labs/near-connect';
import type {
  AuthContextValue,
  AuthState,
  WalletAccount,
} from '../types/auth';
import {
  AUTH_STORAGE_KEY,
  PASSKEY_CREDENTIALS_KEY,
} from '../types/auth';

// ═══════════════════════════════════════════════════════════════════════════════
// NEAR CONNECT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface NearConnectWallet {
  id: string;
  name: string;
  icon: string;
  description?: string;
}

// Wallet display info mapping
const NEAR_WALLET_DISPLAY: Record<string, { icon: string; color: string }> = {
  'hot-wallet': { icon: '🔥', color: '#FF6B35' },
  'meteor-wallet': { icon: '☄️', color: '#7C3AED' },
  'intear-wallet': { icon: '🎯', color: '#10B981' },
  'my-near-wallet': { icon: '🌐', color: '#00C08B' },
  'nightly-wallet': { icon: '🌙', color: '#6366F1' },
  'near-mobile-wallet': { icon: '📱', color: '#3B82F6' },
  'okx-wallet': { icon: '🅾️', color: '#000000' },
  'sender-wallet': { icon: '📤', color: '#F59E0B' },
  'wallet-connect': { icon: '🔌', color: '#3396FF' },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SOLANA WALLET DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string; toBytes(): Uint8Array };
  isConnected?: boolean;
  connect(): Promise<{ publicKey: { toBase58(): string; toBytes(): Uint8Array } }>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array }>;
  on(event: string, callback: (...args: unknown[]) => void): void;
  off(event: string, callback: (...args: unknown[]) => void): void;
}

interface SolflareProvider {
  isSolflare?: boolean;
  publicKey?: { toBase58(): string; toBytes(): Uint8Array };
  isConnected?: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }>;
  on(event: string, callback: (...args: unknown[]) => void): void;
  off(event: string, callback: (...args: unknown[]) => void): void;
}

interface WindowWithSolana extends Window {
  solana?: PhantomProvider;
  solflare?: SolflareProvider;
  phantom?: { solana?: PhantomProvider };
  backpack?: PhantomProvider;
}

function getSolanaProvider(): PhantomProvider | SolflareProvider | null {
  if (typeof window === 'undefined') return null;
  const win = window as WindowWithSolana;
  
  // Try Phantom first
  if (win.phantom?.solana?.isPhantom) {
    return win.phantom.solana;
  }
  if (win.solana?.isPhantom) {
    return win.solana;
  }
  // Try Solflare
  if (win.solflare?.isSolflare) {
    return win.solflare;
  }
  // Try Backpack
  if (win.backpack) {
    return win.backpack;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEAR WALLET DETECTION (Legacy - kept for backward compatibility)
// ═══════════════════════════════════════════════════════════════════════════════

interface NearWalletInterface {
  isSignedIn(): boolean;
  getAccountId(): string;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  signMessage(params: { message: string }): Promise<{ signature: Uint8Array }>;
}

interface WindowWithNear extends Window {
  meteorWallet?: NearWalletInterface;
  myNearWallet?: NearWalletInterface;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PASSKEY (WEBAUTHN) HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

interface StoredPasskey {
  credentialId: string;
  username: string;
  publicKey: string;
  createdAt: number;
}

function getStoredPasskeys(): StoredPasskey[] {
  try {
    const stored = localStorage.getItem(PASSKEY_CREDENTIALS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function savePasskey(passkey: StoredPasskey): void {
  const passkeys = getStoredPasskeys();
  // Remove existing credential with same ID if exists
  const filtered = passkeys.filter(p => p.credentialId !== passkey.credentialId);
  filtered.push(passkey);
  localStorage.setItem(PASSKEY_CREDENTIALS_KEY, JSON.stringify(filtered));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function generateChallenge(): ArrayBuffer {
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  return challenge.buffer;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════

const initialState: AuthState = {
  status: 'disconnected',
  account: null,
  accounts: [],
  error: null,
  isLoginModalOpen: false,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    // Try to restore from localStorage
    if (typeof window === 'undefined') return initialState;
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<AuthState>;
        return {
          ...initialState,
          ...parsed,
          status: 'disconnected', // Always start disconnected, will reconnect
          isLoginModalOpen: false,
        };
      }
    } catch {
      // Ignore parse errors
    }
    return initialState;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // NEAR CONNECT INTEGRATION
  // ═══════════════════════════════════════════════════════════════════════════
  
  const nearConnectorRef = useRef<NearConnector | null>(null);
  const [nearWallets, setNearWallets] = useState<NearConnectWallet[]>([]);
  const [nearConnectReady, setNearConnectReady] = useState(false);

  // Initialize near-connect
  useEffect(() => {
    const initNearConnect = async () => {
      try {
        const connector = new NearConnector({
          network: 'mainnet',
        });

        nearConnectorRef.current = connector;

        // Handle sign in events
        connector.on('wallet:signIn', async (event: { accounts: Array<{ accountId: string; publicKey?: string }> }) => {
          const acc = event.accounts[0];
          if (acc) {
            const account: WalletAccount = {
              id: `near-connect:${acc.accountId}`,
              displayName: acc.accountId.length > 16 
                ? `${acc.accountId.slice(0, 8)}...${acc.accountId.slice(-6)}`
                : acc.accountId,
              address: acc.accountId,
              type: 'near-connect',
              chainId: 'near:mainnet',
              publicKey: acc.publicKey ? new TextEncoder().encode(acc.publicKey) : undefined,
              connectedAt: Date.now(),
            };

            setState(prev => ({
              ...prev,
              status: 'connected',
              account,
              accounts: [...prev.accounts.filter(a => a.id !== account.id), account],
              error: null,
              isLoginModalOpen: false,
            }));
          }
        });

        // Handle sign out events
        connector.on('wallet:signOut', () => {
          setState(prev => {
            if (prev.account?.type === 'near-connect') {
              return {
                ...prev,
                status: 'disconnected',
                account: null,
                accounts: prev.accounts.filter(a => a.type !== 'near-connect'),
              };
            }
            return prev;
          });
        });

        // Load available wallets - wait for manifest to be loaded first
        try {
          await connector.whenManifestLoaded;
          const availableWallets = connector.availableWallets || [];
          const walletList: NearConnectWallet[] = availableWallets.map((w) => ({
            id: w.manifest.id,
            name: w.manifest.name,
            icon: w.manifest.icon || NEAR_WALLET_DISPLAY[w.manifest.id]?.icon || '💼',
            description: w.manifest.description || 'NEAR wallet',
          }));

          if (walletList.length > 0) {
            setNearWallets(walletList);
          } else {
            // Fallback wallets
            setNearWallets([
              { id: 'hot-wallet', name: 'HOT Wallet', icon: '🔥', description: 'Multichain wallet with $HOT mining' },
              { id: 'meteor-wallet', name: 'Meteor', icon: '☄️', description: 'NEAR native wallet' },
              { id: 'my-near-wallet', name: 'MyNearWallet', icon: '🌐', description: 'NEAR web wallet' },
              { id: 'nightly-wallet', name: 'Nightly', icon: '🌙', description: 'Multichain wallet' },
            ]);
          }
        } catch {
          // Fallback wallets if manifest fails to load
          setNearWallets([
            { id: 'hot-wallet', name: 'HOT Wallet', icon: '🔥', description: 'Multichain wallet' },
            { id: 'meteor-wallet', name: 'Meteor', icon: '☄️', description: 'NEAR wallet' },
            { id: 'my-near-wallet', name: 'MyNearWallet', icon: '🌐', description: 'Web wallet' },
          ]);
        }

        setNearConnectReady(true);
      } catch (err) {
        console.error('[AuthContext] Failed to initialize near-connect:', err);
        // Still provide fallback wallets
        setNearWallets([
          { id: 'my-near-wallet', name: 'MyNearWallet', icon: '🌐', description: 'Web wallet' },
        ]);
        setNearConnectReady(true);
      }
    };

    initNearConnect();

    return () => {
      // Cleanup if needed
    };
  }, []);

  // Persist state changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const toStore: Partial<AuthState> = {
      accounts: state.accounts,
      account: state.account,
    };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(toStore));
  }, [state.accounts, state.account]);

  // ═══════════════════════════════════════════════════════════════════════════
  // SOLANA CONNECTION
  // ═══════════════════════════════════════════════════════════════════════════

  const connectSolana = useCallback(async () => {
    const provider = getSolanaProvider();
    if (!provider) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: 'No Solana wallet detected. Please install Phantom, Solflare, or Backpack.',
      }));
      return;
    }

    setState(prev => ({ ...prev, status: 'connecting', error: null }));

    try {
      let publicKey: { toBase58(): string; toBytes(): Uint8Array };
      
      if ('isPhantom' in provider || 'isSolflare' in provider) {
        if ((provider as PhantomProvider).isPhantom) {
          const resp = await (provider as PhantomProvider).connect();
          publicKey = resp.publicKey;
        } else {
          await (provider as SolflareProvider).connect();
          publicKey = (provider as SolflareProvider).publicKey!;
        }
      } else {
        const resp = await (provider as PhantomProvider).connect();
        publicKey = resp.publicKey;
      }

      const address = publicKey.toBase58();
      const account: WalletAccount = {
        id: `solana:${address}`,
        displayName: `${address.slice(0, 4)}...${address.slice(-4)}`,
        address,
        type: 'solana',
        chainId: 'solana:mainnet',
        publicKey: publicKey.toBytes(),
        connectedAt: Date.now(),
      };

      setState(prev => ({
        ...prev,
        status: 'connected',
        account,
        accounts: [...prev.accounts.filter(a => a.id !== account.id), account],
        error: null,
        isLoginModalOpen: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect Solana wallet';
      setState(prev => ({
        ...prev,
        status: 'error',
        error: message,
      }));
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // NEAR CONNECTION VIA NEAR-CONNECT
  // ═══════════════════════════════════════════════════════════════════════════

  const connectNear = useCallback(async (walletId?: string) => {
    setState(prev => ({ ...prev, status: 'connecting', error: null }));

    try {
      const connector = nearConnectorRef.current;
      
      if (connector) {
        // Use near-connect for wallet connection
        // connect() opens wallet selection UI if no walletId provided
        const wallet = await connector.connect(walletId);
        
        // After connect, get accounts and sign in with the wallet
        const accounts = await wallet.signIn();
        
        // If accounts returned directly from signIn, update state here
        // Otherwise the 'wallet:signIn' event handler will handle it
        if (accounts && accounts.length > 0) {
          const acc = accounts[0];
          const account: WalletAccount = {
            id: `near-connect:${acc.accountId}`,
            displayName: acc.accountId.length > 16 
              ? `${acc.accountId.slice(0, 8)}...${acc.accountId.slice(-6)}`
              : acc.accountId,
            address: acc.accountId,
            type: 'near-connect',
            chainId: 'near:mainnet',
            publicKey: acc.publicKey ? new TextEncoder().encode(acc.publicKey) : undefined,
            connectedAt: Date.now(),
          };

          setState(prev => ({
            ...prev,
            status: 'connected',
            account,
            accounts: [...prev.accounts.filter(a => a.id !== account.id), account],
            error: null,
            isLoginModalOpen: false,
          }));
        }
        return;
      }

      // Fallback to legacy connection if near-connect not available
      const win = window as WindowWithNear;
      
      if (win.meteorWallet) {
        await win.meteorWallet.signIn();
        const accountId = win.meteorWallet.getAccountId();
        
        const account: WalletAccount = {
          id: `near:${accountId}`,
          displayName: accountId.length > 12 
            ? `${accountId.slice(0, 6)}...${accountId.slice(-4)}`
            : accountId,
          address: accountId,
          type: 'near',
          chainId: 'near:mainnet',
          connectedAt: Date.now(),
        };

        setState(prev => ({
          ...prev,
          status: 'connected',
          account,
          accounts: [...prev.accounts.filter(a => a.id !== account.id), account],
          error: null,
          isLoginModalOpen: false,
        }));
        return;
      }

      throw new Error('No NEAR wallet available');
      
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect NEAR wallet';
      setState(prev => ({
        ...prev,
        status: 'error',
        error: message,
      }));
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // PASSKEY (WEBAUTHN) CONNECTION
  // ═══════════════════════════════════════════════════════════════════════════

  const registerPasskey = useCallback(async (username: string) => {
    // Check WebAuthn support
    if (!window.PublicKeyCredential) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: 'WebAuthn is not supported in this browser.',
      }));
      return;
    }

    setState(prev => ({ ...prev, status: 'connecting', error: null }));

    try {
      const challenge = generateChallenge();
      // Create a unique user ID based on username + timestamp
      const userIdString = `${username}-${Date.now()}`;
      const userId = new TextEncoder().encode(userIdString);

      console.log('[Passkey] Creating credential for:', username);
      console.log('[Passkey] RP ID:', window.location.hostname);
      console.log('[Passkey] Origin:', window.location.origin);

      // Build creation options - keep it simple and let browser decide authenticator
      const publicKeyOptions: PublicKeyCredentialCreationOptions = {
        challenge,
        rp: {
          name: 'ZK Proof of Funds',
          id: window.location.hostname,
        },
        user: {
          id: userId,
          name: username,
          displayName: username,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },   // ES256 (ECDSA with P-256) - most widely supported
          { type: 'public-key', alg: -257 }, // RS256 (RSASSA-PKCS1-v1_5 with SHA-256)
        ],
        authenticatorSelection: {
          // Don't restrict authenticator type - let browser/OS choose the best option
          // This allows Touch ID, Face ID, Windows Hello, security keys, or phone passkeys
          userVerification: 'preferred',
          residentKey: 'preferred', // Prefer discoverable credential but don't require
        },
        timeout: 60000, // 60 seconds
        attestation: 'none', // Don't need attestation for client-side only
      };

      console.log('[Passkey] Requesting credential creation with options:', JSON.stringify({
        rpId: publicKeyOptions.rp.id,
        rpName: publicKeyOptions.rp.name,
        userName: publicKeyOptions.user.name,
        authenticatorSelection: publicKeyOptions.authenticatorSelection,
      }));
      
      // Create credential with explicit timeout handling
      const credentialPromise = navigator.credentials.create({
        publicKey: publicKeyOptions,
      });
      
      // Race against a timeout to provide better UX if browser hangs
      const timeoutPromise = new Promise<null>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Passkey creation timed out. Please try again.'));
        }, 65000); // Slightly longer than WebAuthn timeout
      });
      
      const credential = await Promise.race([credentialPromise, timeoutPromise]) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error('Passkey creation was cancelled or failed');
      }

      console.log('[Passkey] Credential created successfully!');

      const credentialId = arrayBufferToBase64(credential.rawId);
      const response = credential.response as AuthenticatorAttestationResponse;
      const publicKeyBytes = response.getPublicKey?.();
      const publicKeyBase64 = publicKeyBytes ? arrayBufferToBase64(publicKeyBytes) : '';

      // Save credential to local storage
      savePasskey({
        credentialId,
        username,
        publicKey: publicKeyBase64,
        createdAt: Date.now(),
      });

      const account: WalletAccount = {
        id: `passkey:${credentialId.slice(0, 16)}`,
        displayName: username,
        address: credentialId,
        type: 'passkey',
        credentialId,
        publicKey: publicKeyBytes ? new Uint8Array(publicKeyBytes) : undefined,
        connectedAt: Date.now(),
      };

      console.log('[Passkey] Registration complete for:', username);

      setState(prev => ({
        ...prev,
        status: 'connected',
        account,
        accounts: [...prev.accounts.filter(a => a.id !== account.id), account],
        error: null,
        isLoginModalOpen: false,
      }));
    } catch (err) {
      console.error('[Passkey] Registration error:', err);
      
      let message = 'Failed to register passkey';
      if (err instanceof Error) {
        // Provide user-friendly error messages
        if (err.name === 'NotAllowedError') {
          message = 'Passkey creation was cancelled. Please try again.';
        } else if (err.name === 'InvalidStateError') {
          message = 'A passkey already exists for this account.';
        } else if (err.name === 'NotSupportedError') {
          message = 'Your device does not support passkeys.';
        } else if (err.name === 'SecurityError') {
          message = 'Security error: Please ensure you are on a secure connection (HTTPS).';
        } else {
          message = err.message;
        }
      }
      
      setState(prev => ({
        ...prev,
        status: 'error',
        error: message,
      }));
    }
  }, []);

  const connectPasskey = useCallback(async () => {
    if (!window.PublicKeyCredential) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: 'WebAuthn is not supported in this browser.',
      }));
      return;
    }

    const storedPasskeys = getStoredPasskeys();
    if (storedPasskeys.length === 0) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: 'No passkeys found. Please register a passkey first.',
      }));
      return;
    }

    setState(prev => ({ ...prev, status: 'connecting', error: null }));

    try {
      const challenge = generateChallenge();

      console.log('[Passkey] Authenticating with stored passkeys:', storedPasskeys.length);
      console.log('[Passkey] RP ID:', window.location.hostname);

      const credential = await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: window.location.hostname,
          allowCredentials: storedPasskeys.map(p => ({
            id: base64ToArrayBuffer(p.credentialId),
            type: 'public-key' as const,
            // Let browser determine available transports
          })),
          userVerification: 'preferred',
          timeout: 60000, // 60 seconds
        },
      }) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error('Passkey authentication was cancelled');
      }

      console.log('[Passkey] Authentication successful!');

      const credentialId = arrayBufferToBase64(credential.rawId);
      const storedPasskey = storedPasskeys.find(p => p.credentialId === credentialId);
      
      if (!storedPasskey) {
        throw new Error('Passkey not recognized. It may have been created on a different device.');
      }

      const account: WalletAccount = {
        id: `passkey:${credentialId.slice(0, 16)}`,
        displayName: storedPasskey.username,
        address: credentialId,
        type: 'passkey',
        credentialId,
        publicKey: storedPasskey.publicKey ? 
          new Uint8Array(base64ToArrayBuffer(storedPasskey.publicKey)) : undefined,
        connectedAt: Date.now(),
      };

      setState(prev => ({
        ...prev,
        status: 'connected',
        account,
        accounts: [...prev.accounts.filter(a => a.id !== account.id), account],
        error: null,
        isLoginModalOpen: false,
      }));
    } catch (err) {
      console.error('[Passkey] Authentication error:', err);
      
      let message = 'Failed to authenticate with passkey';
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          message = 'Authentication was cancelled. Please try again.';
        } else if (err.name === 'SecurityError') {
          message = 'Security error: Please ensure you are on a secure connection.';
        } else if (err.name === 'AbortError') {
          message = 'Authentication timed out. Please try again.';
        } else {
          message = err.message;
        }
      }
      
      setState(prev => ({
        ...prev,
        status: 'error',
        error: message,
      }));
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // DISCONNECT & ACCOUNT MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  const disconnect = useCallback(async () => {
    const { account } = state;
    if (!account) return;

    try {
      if (account.type === 'solana') {
        const provider = getSolanaProvider();
        await provider?.disconnect();
      } else if (account.type === 'near-connect' || account.type === 'near') {
        // Use near-connect for disconnection
        const connector = nearConnectorRef.current;
        if (connector) {
          const wallet = await connector.wallet?.();
          await wallet?.signOut?.();
        } else {
          // Legacy fallback
          const win = window as WindowWithNear;
          if (win.meteorWallet?.isSignedIn()) {
            await win.meteorWallet.signOut();
          }
        }
      }
      // Passkeys don't need explicit disconnect
    } catch (err) {
      console.warn('Error during disconnect:', err);
    }

    setState(prev => ({
      ...prev,
      status: 'disconnected',
      account: null,
      accounts: prev.accounts.filter(a => a.id !== account.id),
      error: null,
    }));
  }, [state]);

  const switchAccount = useCallback((accountId: string) => {
    const account = state.accounts.find(a => a.id === accountId);
    if (account) {
      setState(prev => ({
        ...prev,
        account,
        status: 'connected',
      }));
    }
  }, [state.accounts]);

  // ═══════════════════════════════════════════════════════════════════════════
  // SIGN MESSAGE
  // ═══════════════════════════════════════════════════════════════════════════

  const signMessage = useCallback(async (message: string | Uint8Array): Promise<Uint8Array> => {
    const { account } = state;
    if (!account) {
      throw new Error('No wallet connected');
    }

    const messageBytes = typeof message === 'string' 
      ? new TextEncoder().encode(message) 
      : message;

    if (account.type === 'solana') {
      const provider = getSolanaProvider();
      if (!provider) {
        throw new Error('Solana wallet not available');
      }
      const { signature } = await provider.signMessage(messageBytes);
      return signature;
    }

    if (account.type === 'near-connect' || account.type === 'near') {
      const connector = nearConnectorRef.current;
      if (connector) {
        const wallet = await connector.wallet?.();
        if (wallet?.signMessage) {
          const nonce = new Uint8Array(32);
          crypto.getRandomValues(nonce);
          
          const result = await wallet.signMessage({
            message: typeof message === 'string' ? message : new TextDecoder().decode(message),
            recipient: account.address,
            nonce,
          });
          // Convert base64 signature string to Uint8Array
          const signatureBytes = base64ToArrayBuffer(result.signature);
          return new Uint8Array(signatureBytes);
        }
      }
      
      // Legacy fallback
      const win = window as WindowWithNear;
      if (win.meteorWallet?.isSignedIn()) {
        const { signature } = await win.meteorWallet.signMessage({ 
          message: typeof message === 'string' ? message : new TextDecoder().decode(message) 
        });
        return signature;
      }
      throw new Error('NEAR wallet does not support message signing');
    }

    if (account.type === 'passkey') {
      // Use WebAuthn assertion as signature
      const challenge = messageBytes.buffer;
      const storedPasskeys = getStoredPasskeys();
      
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: challenge.slice(0) as ArrayBuffer,
          rpId: window.location.hostname,
          allowCredentials: storedPasskeys.map(p => ({
            id: base64ToArrayBuffer(p.credentialId),
            type: 'public-key' as const,
          })),
          userVerification: 'required',
        },
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error('Failed to sign with passkey');
      }

      const response = credential.response as AuthenticatorAssertionResponse;
      return new Uint8Array(response.signature);
    }

    throw new Error(`Signing not supported for wallet type: ${account.type}`);
  }, [state]);

  // ═══════════════════════════════════════════════════════════════════════════
  // MODAL CONTROLS
  // ═══════════════════════════════════════════════════════════════════════════

  const openLoginModal = useCallback(() => {
    setState(prev => ({ ...prev, isLoginModalOpen: true, error: null }));
  }, []);

  const closeLoginModal = useCallback(() => {
    setState(prev => ({ ...prev, isLoginModalOpen: false }));
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-RECONNECT
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    // Try to reconnect to previously connected wallet
    const reconnect = async () => {
      if (!state.account || state.status === 'connected') return;

      if (state.account.type === 'solana') {
        const provider = getSolanaProvider();
        if (provider?.isConnected && provider.publicKey) {
          setState(prev => ({ ...prev, status: 'connected' }));
        }
      } else if (state.account.type === 'near') {
        const win = window as WindowWithNear;
        if (win.meteorWallet?.isSignedIn() || win.myNearWallet?.isSignedIn()) {
          setState(prev => ({ ...prev, status: 'connected' }));
        }
      } else if (state.account.type === 'passkey') {
        // Passkeys are always "connected" if credential exists
        const passkeys = getStoredPasskeys();
        if (passkeys.some(p => p.credentialId === state.account?.credentialId)) {
          setState(prev => ({ ...prev, status: 'connected' }));
        }
      }
    };

    reconnect();
  }, [state.account, state.status]);

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    connectSolana,
    connectNear,
    connectPasskey,
    registerPasskey,
    disconnect,
    switchAccount,
    signMessage,
    openLoginModal,
    closeLoginModal,
    // Near-connect specific
    nearWallets,
    nearConnectReady,
  }), [
    state,
    connectSolana,
    connectNear,
    connectPasskey,
    registerPasskey,
    disconnect,
    switchAccount,
    signMessage,
    openLoginModal,
    closeLoginModal,
    nearWallets,
    nearConnectReady,
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

