/**
 * Multi-Wallet Authentication Types
 * 
 * Supports:
 * - Solana Wallet (Phantom, Solflare, etc.)
 * - NEAR Wallet (NEAR Web Wallet, MyNearWallet, Meteor, etc.)
 * - Passkey (WebAuthn/FIDO2)
 */

export type WalletType = 'solana' | 'near' | 'near-connect' | 'passkey' | 'ethereum';

export type AuthStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface WalletAccount {
  /** Unique identifier for this account */
  id: string;
  /** Display name (truncated address or passkey name) */
  displayName: string;
  /** Full address for the wallet */
  address: string;
  /** Wallet type */
  type: WalletType;
  /** Chain-specific metadata */
  chainId?: string;
  /** Public key bytes (for signing verification) */
  publicKey?: Uint8Array;
  /** Passkey credential ID (for passkey accounts) */
  credentialId?: string;
  /** Connected timestamp */
  connectedAt: number;
}

export interface AuthState {
  /** Current authentication status */
  status: AuthStatus;
  /** Currently connected account */
  account: WalletAccount | null;
  /** All connected accounts (for multi-account support) */
  accounts: WalletAccount[];
  /** Last error message */
  error: string | null;
  /** Whether the login modal is open */
  isLoginModalOpen: boolean;
}

export interface NearConnectWalletInfo {
  id: string;
  name: string;
  icon: string;
  description?: string;
}

export interface AuthContextValue extends AuthState {
  /** Connect a Solana wallet */
  connectSolana: () => Promise<void>;
  /** Connect a NEAR wallet (optionally specify wallet ID for near-connect) */
  connectNear: (walletId?: string) => Promise<void>;
  /** Connect using Passkey (WebAuthn) */
  connectPasskey: () => Promise<void>;
  /** Register a new passkey */
  registerPasskey: (username: string) => Promise<void>;
  /** Disconnect current wallet */
  disconnect: () => Promise<void>;
  /** Switch to a different connected account */
  switchAccount: (accountId: string) => void;
  /** Sign a message with the current wallet */
  signMessage: (message: string | Uint8Array) => Promise<Uint8Array>;
  /** Open the login modal */
  openLoginModal: () => void;
  /** Close the login modal */
  closeLoginModal: () => void;
  /** Available NEAR wallets via near-connect */
  nearWallets: NearConnectWalletInfo[];
  /** Whether near-connect is initialized and ready */
  nearConnectReady: boolean;
}

// Solana specific types
export interface SolanaWalletAdapter {
  publicKey: { toBytes(): Uint8Array; toString(): string } | null;
  connected: boolean;
  connecting: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

// NEAR specific types
export interface NearWalletSelector {
  isSignedIn(): boolean;
  getAccounts(): Promise<Array<{ accountId: string; publicKey?: string }>>;
  signIn(params: { contractId?: string; methodNames?: string[] }): Promise<void>;
  signOut(): Promise<void>;
  signMessage(params: { message: string; recipient: string; nonce: Buffer }): Promise<{
    signature: Uint8Array;
    publicKey: string;
  }>;
}

// Passkey (WebAuthn) types
export interface PasskeyCredential {
  id: string;
  rawId: ArrayBuffer;
  type: 'public-key';
  response: AuthenticatorAttestationResponse | AuthenticatorAssertionResponse;
  authenticatorAttachment?: AuthenticatorAttachment;
}

export interface PasskeyRegistrationOptions {
  challenge: ArrayBuffer;
  rp: {
    name: string;
    id: string;
  };
  user: {
    id: ArrayBuffer;
    name: string;
    displayName: string;
  };
  pubKeyCredParams: Array<{
    type: 'public-key';
    alg: number;
  }>;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  timeout?: number;
  attestation?: AttestationConveyancePreference;
}

export interface PasskeyAuthenticationOptions {
  challenge: ArrayBuffer;
  rpId: string;
  allowCredentials?: Array<{
    id: ArrayBuffer;
    type: 'public-key';
    transports?: AuthenticatorTransport[];
  }>;
  userVerification?: UserVerificationRequirement;
  timeout?: number;
}

// Storage keys
export const AUTH_STORAGE_KEY = 'zkpf_auth_state';
export const PASSKEY_CREDENTIALS_KEY = 'zkpf_passkey_credentials';

