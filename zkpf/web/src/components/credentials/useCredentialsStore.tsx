/**
 * useCredentialsStore - Local storage hook for managing credentials
 * 
 * Stores real verified credentials only - no mock data.
 */

import { useState, useCallback, useEffect } from 'react';
import type { Credential } from './CredentialCard';

const STORAGE_KEY = 'zkpf-credentials-v2';

interface CredentialsStore {
  credentials: Credential[];
  addCredential: (credential: Credential) => void;
  updateCredential: (id: string, updates: Partial<Credential>) => void;
  revokeCredential: (id: string) => void;
  deleteCredential: (id: string) => void;
  getCredential: (id: string) => Credential | undefined;
  getCredentialsByChain: (chain: string) => Credential[];
  getActiveCredentials: () => Credential[];
  getExpiredCredentials: () => Credential[];
  getTotalProvenValue: () => number;
  clearAllCredentials: () => void;
}

export function useCredentialsStore(): CredentialsStore {
  const [credentials, setCredentials] = useState<Credential[]>([]);

  // Load credentials from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Credential[];
        // Update expired credentials
        const updated = parsed.map(cred => {
          if (cred.status === 'verified' && new Date(cred.expiresAt) < new Date()) {
            return { ...cred, status: 'expired' as const };
          }
          return cred;
        });
        setCredentials(updated);
      }
    } catch (err) {
      console.error('Failed to load credentials from storage:', err);
    }
  }, []);

  // Persist credentials to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
    } catch (err) {
      console.error('Failed to save credentials to storage:', err);
    }
  }, [credentials]);

  const addCredential = useCallback((credential: Credential) => {
    setCredentials(prev => [credential, ...prev]);
  }, []);

  const updateCredential = useCallback((id: string, updates: Partial<Credential>) => {
    setCredentials(prev => prev.map(cred => 
      cred.id === id ? { ...cred, ...updates } : cred
    ));
  }, []);

  const revokeCredential = useCallback((id: string) => {
    setCredentials(prev => prev.map(cred => 
      cred.id === id ? { ...cred, status: 'revoked' as const } : cred
    ));
  }, []);

  const deleteCredential = useCallback((id: string) => {
    setCredentials(prev => prev.filter(cred => cred.id !== id));
  }, []);

  const getCredential = useCallback((id: string) => {
    return credentials.find(cred => cred.id === id);
  }, [credentials]);

  const getCredentialsByChain = useCallback((chain: string) => {
    return credentials.filter(cred => cred.chain === chain);
  }, [credentials]);

  const getActiveCredentials = useCallback(() => {
    const now = new Date();
    return credentials.filter(cred => 
      cred.status === 'verified' && new Date(cred.expiresAt) > now
    );
  }, [credentials]);

  const getExpiredCredentials = useCallback(() => {
    return credentials.filter(cred => cred.status === 'expired');
  }, [credentials]);

  const getTotalProvenValue = useCallback(() => {
    const now = new Date();
    return credentials
      .filter(cred => cred.status === 'verified' && new Date(cred.expiresAt) > now)
      .reduce((sum, cred) => {
        // Only count USD-denominated values directly
        // Other currencies would need real exchange rates
        if (cred.currency === 'USD' || cred.currency === 'USDC' || cred.currency === 'USDT') {
          return sum + cred.provenValue;
        }
        return sum;
      }, 0);
  }, [credentials]);

  const clearAllCredentials = useCallback(() => {
    setCredentials([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    credentials,
    addCredential,
    updateCredential,
    revokeCredential,
    deleteCredential,
    getCredential,
    getCredentialsByChain,
    getActiveCredentials,
    getExpiredCredentials,
    getTotalProvenValue,
    clearAllCredentials,
  };
}

export default useCredentialsStore;
