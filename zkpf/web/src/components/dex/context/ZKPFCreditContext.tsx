import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { ZkpfClient, detectDefaultBase } from '../../../api/zkpf';
import type { ProofBundle, PolicyDefinition } from '../../../types/zkpf';
import toast from 'react-hot-toast';

interface CreditInfo {
  availableCredit: number;
  maxCredit: number;
  tier: string;
  proofValid: boolean;
  lastVerified?: Date;
}

interface ZKPFCreditContextType {
  creditInfo: CreditInfo | null;
  isLoading: boolean;
  error: string | null;
  verifyProof: (bundle: ProofBundle, policy: PolicyDefinition) => Promise<boolean>;
  refreshCredit: () => Promise<void>;
  clearCredit: () => void;
}

const ZKPFCreditContext = createContext<ZKPFCreditContextType | undefined>(undefined);

// Credit tiers based on proof thresholds
const CREDIT_TIERS = {
  TIER_1: { threshold: 0.1, maxCredit: 1000, name: 'Tier 1' },
  TIER_2: { threshold: 1, maxCredit: 5000, name: 'Tier 2' },
  TIER_3: { threshold: 10, maxCredit: 25000, name: 'Tier 3' },
  TIER_4: { threshold: 100, maxCredit: 100000, name: 'Tier 4' },
  TIER_5: { threshold: 1000, maxCredit: 500000, name: 'Tier 5' },
};

function getCreditTier(threshold: number): typeof CREDIT_TIERS[keyof typeof CREDIT_TIERS] {
  if (threshold >= CREDIT_TIERS.TIER_5.threshold) return CREDIT_TIERS.TIER_5;
  if (threshold >= CREDIT_TIERS.TIER_4.threshold) return CREDIT_TIERS.TIER_4;
  if (threshold >= CREDIT_TIERS.TIER_3.threshold) return CREDIT_TIERS.TIER_3;
  if (threshold >= CREDIT_TIERS.TIER_2.threshold) return CREDIT_TIERS.TIER_2;
  return CREDIT_TIERS.TIER_1;
}

export function ZKPFCreditProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new ZkpfClient(detectDefaultBase()));
  const [creditInfo, setCreditInfo] = useState<CreditInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verifyProof = useCallback(async (bundle: ProofBundle, policy: PolicyDefinition): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await client.verifyBundle(policy.policy_id, bundle);
      
      if (response.valid) {
        const threshold = policy.threshold_raw / 1e8; // Convert from smallest unit to main unit
        const tier = getCreditTier(threshold);
        
        setCreditInfo({
          availableCredit: tier.maxCredit,
          maxCredit: tier.maxCredit,
          tier: tier.name,
          proofValid: true,
          lastVerified: new Date(),
        });

        toast.success(`Proof verified! ${tier.name} credit available.`);
        return true;
      } else {
        setError(response.error || 'Proof verification failed');
        toast.error('Proof verification failed');
        return false;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to verify proof';
      setError(errorMessage);
      toast.error(errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  const refreshCredit = useCallback(async () => {
    // Check localStorage for stored proof bundle
    const storedBundle = localStorage.getItem('zkpf-dex-proof-bundle');
    const storedPolicy = localStorage.getItem('zkpf-dex-policy');
    
    if (storedBundle && storedPolicy) {
      try {
        const bundle = JSON.parse(storedBundle) as ProofBundle;
        const policy = JSON.parse(storedPolicy) as PolicyDefinition;
        await verifyProof(bundle, policy);
      } catch (err) {
        console.error('Failed to refresh credit from stored proof:', err);
      }
    }
  }, [verifyProof]);

  const clearCredit = useCallback(() => {
    setCreditInfo(null);
    localStorage.removeItem('zkpf-dex-proof-bundle');
    localStorage.removeItem('zkpf-dex-policy');
  }, []);

  // Load stored credit info on mount
  useEffect(() => {
    const storedBundle = localStorage.getItem('zkpf-dex-proof-bundle');
    if (storedBundle) {
      refreshCredit();
    }
  }, [refreshCredit]);

  return (
    <ZKPFCreditContext.Provider
      value={{
        creditInfo,
        isLoading,
        error,
        verifyProof,
        refreshCredit,
        clearCredit,
      }}
    >
      {children}
    </ZKPFCreditContext.Provider>
  );
}

export function useZKPFCredit() {
  const context = useContext(ZKPFCreditContext);
  if (context === undefined) {
    throw new Error('useZKPFCredit must be used within a ZKPFCreditProvider');
  }
  return context;
}

