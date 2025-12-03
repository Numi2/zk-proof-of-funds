/**
 * Orderly Network Hooks Re-export
 * 
 * This file re-exports all hooks from @orderly.network/hooks for use throughout the app.
 * Custom wrapper hooks have been temporarily disabled due to API changes in Orderly SDK v2.8.3.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// ORDERLY HOOKS RE-EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export {
  // Account hooks
  useAccount,
  useAccountInfo,
  useLeverage,
  useMarginRatio,
  
  // Asset hooks
  useCollateral,
  useMaxQty,
  useHoldingStream,
  
  // Market hooks
  useOrderbookStream,
  useMarkPrice,
  useMarkPricesStream,
  useMarketTradeStream,
  useTickerStream,
  
  // Order hooks
  useOrderEntry,
  useOrderStream,
  
  // Position hooks
  usePositionStream,
  usePoster,
  
  // Funding hooks
  useFundingRate,
  useFundingRates,
  
  // Symbol hooks
  useSymbolsInfo,
  
  // Media hooks
  useMediaQuery,
  
  // WebSocket hooks
  useWS,
  useWsStatus,
  
  // Query hooks
  useLazyQuery,
  useMutation,
} from '@orderly.network/hooks';

// Re-export AccountStatusEnum for convenience
export { AccountStatusEnum } from '@orderly.network/types';

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOM HOOKS USING ORDERLY SDK
// ═══════════════════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { useOrderEntry, useMarkPrice, useMaxQty, useAccount } from '@orderly.network/hooks';
import type { API } from '@orderly.network/types';
import { OrderSide, AccountStatusEnum } from '@orderly.network/types';

/**
 * Enhanced Order Entry Hook
 * Wraps Orderly SDK's useOrderEntry with additional functionality
 */
export function useEnhancedOrderEntry(symbol: string) {
  // Use Orderly SDK's useOrderEntry hook - side is specified in the order, not the hook
  const orderEntry = useOrderEntry(symbol, {});
  const maxQtyBuy = useMaxQty(symbol, OrderSide.BUY);
  const { account, state: accountState } = useAccount();

  return {
    placeOrder: (order: any) => {
      // OrderEntryReturn likely has a submit method or similar
      if ('submit' in orderEntry && typeof orderEntry.submit === 'function') {
        return orderEntry.submit(order);
      } else if ('mutate' in orderEntry && typeof orderEntry.mutate === 'function') {
        return orderEntry.mutate(order);
      } else {
        throw new Error('Order entry method not available');
      }
    },
    reset: orderEntry.reset || (() => {}),
    formattedOrder: orderEntry.formattedOrder,
    loading: ('isLoading' in orderEntry ? orderEntry.isLoading : false) || 
             ('isPending' in orderEntry ? orderEntry.isPending : false),
    error: ('error' in orderEntry ? orderEntry.error : null),
    maxQty: typeof maxQtyBuy === 'number' ? maxQtyBuy : 0,
    canTrade: accountState.status >= AccountStatusEnum.SignedIn && !!account?.address,
  };
}

/**
 * Quick Order Hook
 * Provides convenience methods for common order types
 */
export function useQuickOrder(symbol: string) {
  const orderEntry = useOrderEntry(symbol, {});

  const submitOrder = (order: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      if ('submit' in orderEntry && typeof orderEntry.submit === 'function') {
        orderEntry.submit(order).then(resolve).catch(reject);
      } else if ('mutate' in orderEntry && typeof orderEntry.mutate === 'function') {
        orderEntry.mutate(order, {
          onSuccess: resolve,
          onError: reject,
        });
      } else {
        reject(new Error('Order entry method not available'));
      }
    });
  };

  const marketBuy = async (quantity: number) => {
    return submitOrder({
      symbol,
      side: 'BUY',
      order_type: 'MARKET',
      order_quantity: quantity,
    });
  };

  const marketSell = async (quantity: number) => {
    return submitOrder({
      symbol,
      side: 'SELL',
      order_type: 'MARKET',
      order_quantity: quantity,
    });
  };

  const limitBuy = async (quantity: number, price: number) => {
    return submitOrder({
      symbol,
      side: 'BUY',
      order_type: 'LIMIT',
      order_quantity: quantity,
      order_price: price,
    });
  };

  const limitSell = async (quantity: number, price: number) => {
    return submitOrder({
      symbol,
      side: 'SELL',
      order_type: 'LIMIT',
      order_quantity: quantity,
      order_price: price,
    });
  };

  const stopLoss = async (quantity: number, triggerPrice: number) => {
    return submitOrder({
      symbol,
      side: 'SELL',
      order_type: 'STOP_MARKET',
      order_quantity: quantity,
      trigger_price: triggerPrice,
    });
  };

  const takeProfit = async (quantity: number, triggerPrice: number) => {
    return submitOrder({
      symbol,
      side: 'SELL',
      order_type: 'TAKE_PROFIT_MARKET',
      order_quantity: quantity,
      trigger_price: triggerPrice,
    });
  };

  const isLoading = ('isLoading' in orderEntry ? orderEntry.isLoading : false) ||
                    ('isPending' in orderEntry ? orderEntry.isPending : false);

  const error = ('error' in orderEntry ? orderEntry.error : null);

  return {
    marketBuy,
    marketSell,
    limitBuy,
    limitSell,
    stopLoss,
    takeProfit,
    loading: isLoading || false,
    error: error || null,
  };
}

/**
 * Position Calculator Hook
 * Calculates position details based on entry parameters
 */
export function usePositionCalculator(symbol: string) {
  const markPrice = useMarkPrice(symbol);
  const maxQtyBuy = useMaxQty(symbol, OrderSide.BUY);
  const maxQtySell = useMaxQty(symbol, OrderSide.SELL);
  const { state: accountState } = useAccount();

  const markPriceData = typeof markPrice === 'object' && 'data' in markPrice ? markPrice.data : (typeof markPrice === 'number' ? markPrice : 0);
  const markPriceLoading = typeof markPrice === 'object' && 'isLoading' in markPrice ? markPrice.isLoading : false;
  const maxQty = typeof maxQtyBuy === 'number' ? maxQtyBuy : (typeof maxQtySell === 'number' ? maxQtySell : 0);

  const calculatePosition = useMemo(() => {
    return (quantity: number, entryPrice: number, side: 'BUY' | 'SELL') => {
      if (!quantity || !entryPrice) return null;

      const currentPrice = markPriceData || entryPrice;
      const notional = quantity * entryPrice;
      const currentNotional = quantity * currentPrice;
      const pnl = side === 'BUY' 
        ? currentNotional - notional 
        : notional - currentNotional;
      const pnlPercent = (pnl / notional) * 100;

      return {
        quantity,
        entryPrice,
        currentPrice,
        notional,
        currentNotional,
        pnl,
        pnlPercent,
        side,
      };
    };
  }, [markPriceData]);

  return {
    calculatePosition,
    currentPrice: markPriceData || 0,
    maxQty: maxQty || 0,
    loading: markPriceLoading || false,
  };
}
