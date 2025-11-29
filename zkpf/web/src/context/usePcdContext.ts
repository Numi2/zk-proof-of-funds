/**
 * Hook for accessing PCD context
 * 
 * Separated from PcdContext.tsx to enable Fast Refresh
 */

import { useContext } from 'react';
import { PcdContext, type PcdContextValue } from './PcdContext';

export function usePcdContext(): PcdContextValue {
  const context = useContext(PcdContext);
  if (!context) {
    throw new Error('usePcdContext must be used within PcdProvider');
  }
  return context;
}

