import { useMemo } from 'react';

interface RiskCheckParams {
  leverage: number;
  positionSize: number;
  accountBalance: number;
  liquidationPrice: number;
  currentPrice: number;
}

interface RiskCheckResult {
  isHighRisk: boolean;
  warnings: string[];
  canProceed: boolean;
}

export function useRiskCheck(params: RiskCheckParams): RiskCheckResult {
  return useMemo(() => {
    const { leverage, positionSize, accountBalance, liquidationPrice, currentPrice } = params;
    const warnings: string[] = [];
    let isHighRisk = false;

    // Check leverage
    if (leverage > 10) {
      warnings.push(`Very high leverage (${leverage}x) significantly increases liquidation risk`);
      isHighRisk = true;
    } else if (leverage > 5) {
      warnings.push(`High leverage (${leverage}x) increases risk`);
    }

    // Check position size relative to account
    const positionPercent = (positionSize / accountBalance) * 100;
    if (positionPercent > 50) {
      warnings.push(`Large position size (${positionPercent.toFixed(1)}% of account)`);
      isHighRisk = true;
    }

    // Check distance to liquidation
    const distanceToLiquidation = Math.abs(currentPrice - liquidationPrice);
    const percentToLiquidation = (distanceToLiquidation / currentPrice) * 100;
    if (percentToLiquidation < 5) {
      warnings.push(`Very close to liquidation (${percentToLiquidation.toFixed(2)}% away)`);
      isHighRisk = true;
    } else if (percentToLiquidation < 10) {
      warnings.push(`Close to liquidation (${percentToLiquidation.toFixed(2)}% away)`);
    }

    return {
      isHighRisk,
      warnings,
      canProceed: true, // User can always proceed, but with warnings
    };
  }, [params]);
}

