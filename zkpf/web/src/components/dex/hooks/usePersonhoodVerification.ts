import { useState, useEffect } from 'react';

interface PersonhoodVerification {
  isVerified: boolean;
  verificationLevel: 'basic' | 'enhanced' | null;
  verifiedAt: Date | null;
}

export function usePersonhoodVerification(): PersonhoodVerification {
  const [verification, setVerification] = useState<PersonhoodVerification>({
    isVerified: false,
    verificationLevel: null,
    verifiedAt: null,
  });

  useEffect(() => {
    // Check localStorage for ZKPassport verification
    const stored = localStorage.getItem('zkpassport-verification');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        setVerification({
          isVerified: data.verified === true,
          verificationLevel: data.level || null,
          verifiedAt: data.verifiedAt ? new Date(data.verifiedAt) : null,
        });
      } catch (err) {
        console.error('Failed to parse stored verification:', err);
      }
    }
  }, []);

  return verification;
}

