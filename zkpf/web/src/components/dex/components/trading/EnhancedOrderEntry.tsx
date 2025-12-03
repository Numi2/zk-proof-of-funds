/**
 * Enhanced Order Entry with Risk Management
 * 
 * Integrates order placement with risk checks, confirmations, and leverage warnings
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { API } from '@orderly.network/types';
import { useEnhancedOrderEntry, useAccount, useMarkPrice } from '../../hooks/useOrderlyHooks';
import { LeverageWarning } from '../risk/LeverageWarning';
import { OrderConfirmation } from '../risk/OrderConfirmation';
import toast from 'react-hot-toast';

interface EnhancedOrderEntryProps {
  symbol: string;
  onOrderPlaced?: () => void;
  defaultSide?: 'BUY' | 'SELL';
}

export function EnhancedOrderEntry({ symbol, onOrderPlaced, defaultSide = 'BUY' }: EnhancedOrderEntryProps) {
  const [side, setSide] = useState<'BUY' | 'SELL'>(defaultSide);
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'STOP_LIMIT'>('MARKET');
  const [quantity, setQuantity] = useState<string>('');
  const [price, setPrice] = useState<string>('');
  const [reduceOnly, setReduceOnly] = useState(false);
  
  const [showLeverageWarning, setShowLeverageWarning] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<any>(null);

  const { placeOrder, loading, error, maxQty, canTrade } = useEnhancedOrderEntry(symbol);
  const { state: accountState } = useAccount();
  const markPriceHook = useMarkPrice(symbol);
  
  const currentPrice = markPriceHook.data || 0;
  const currentLeverage = (accountState as any).maxLeverage || 10;

  // Auto-fill price for limit orders
  useEffect(() => {
    if (orderType === 'LIMIT' && !price) {
      setPrice(currentPrice.toFixed(2));
    }
  }, [orderType, currentPrice, price]);

  const validateOrder = useCallback(() => {
    const qty = parseFloat(quantity);
    const prc = parseFloat(price);

    if (!qty || qty <= 0) {
      toast.error('Please enter a valid quantity');
      return false;
    }

    if (qty > maxQty) {
      toast.error(`Maximum quantity exceeded. Max: ${maxQty.toFixed(3)}`);
      return false;
    }

    if ((orderType === 'LIMIT' || orderType === 'STOP_LIMIT') && (!prc || prc <= 0)) {
      toast.error('Please enter a valid price');
      return false;
    }

    return true;
  }, [quantity, price, maxQty, orderType]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (!validateOrder()) return;
    if (!canTrade) {
      toast.error('Please connect wallet and enable trading');
      return;
    }

    const qty = parseFloat(quantity);
    const prc = price ? parseFloat(price) : undefined;
    const orderValue = qty * (prc || currentPrice);

    // Format order according to Orderly SDK expectations
    const order: any = {
      symbol,
      side,
      order_type: orderType,
      order_quantity: qty,
      reduce_only: reduceOnly,
    };

    // Add price for limit orders
    if (orderType === 'LIMIT' || orderType === 'STOP_LIMIT') {
      if (!prc) {
        toast.error('Price is required for limit orders');
        return;
      }
      order.order_price = prc;
    }

    // Add trigger price for stop orders
    if (orderType === 'STOP_MARKET' || orderType === 'STOP_LIMIT') {
      if (!prc) {
        toast.error('Trigger price is required for stop orders');
        return;
      }
      order.trigger_price = prc;
    }

    // Check for high leverage warning
    if (currentLeverage > 5 && !showLeverageWarning) {
      setPendingOrder(order);
      setShowLeverageWarning(true);
      return;
    }

    // Check for large order confirmation
    if (orderValue > 10000 && !showConfirmation) {
      setPendingOrder(order);
      setShowConfirmation(true);
      return;
    }

    // Place the order
    try {
      await placeOrder(order);
      toast.success('Order placed successfully!');
      
      // Reset form
      setQuantity('');
      setPrice('');
      setReduceOnly(false);
      setPendingOrder(null);
      
      onOrderPlaced?.();
    } catch (err: any) {
      console.error('Order failed:', err);
      const errorMessage = err?.message || err?.error?.message || 'Failed to place order';
      toast.error(errorMessage);
    }
  }, [validateOrder, canTrade, quantity, price, currentPrice, side, orderType, reduceOnly, currentLeverage, showLeverageWarning, showConfirmation, placeOrder, onOrderPlaced]);

  const handleLeverageWarningAccept = () => {
    setShowLeverageWarning(false);
    // Re-trigger submit with warning acknowledged
    if (pendingOrder) {
      const orderValue = pendingOrder.order_quantity * (pendingOrder.order_price || currentPrice);
      if (orderValue > 10000) {
        setShowConfirmation(true);
      } else {
        placeOrder(pendingOrder)
          .then(() => {
            toast.success('Order placed successfully!');
            setQuantity('');
            setPrice('');
            setReduceOnly(false);
            setPendingOrder(null);
            onOrderPlaced?.();
          })
          .catch((err: any) => {
            console.error('Order failed:', err);
            const errorMessage = err?.message || err?.error?.message || 'Failed to place order';
            toast.error(errorMessage);
          });
      }
    }
  };

  const handleConfirmOrder = () => {
    setShowConfirmation(false);
    if (pendingOrder) {
      placeOrder(pendingOrder)
        .then(() => {
          toast.success('Order placed successfully!');
          setQuantity('');
          setPrice('');
          setReduceOnly(false);
          setPendingOrder(null);
          onOrderPlaced?.();
        })
        .catch(err => console.error('Order failed:', err));
    }
  };

  const handleCancel = () => {
    setShowLeverageWarning(false);
    setShowConfirmation(false);
    setPendingOrder(null);
  };

  return (
    <>
      <div className="dex-enhanced-order-entry">
        <div className="dex-order-tabs">
          <button
            className={`dex-order-tab ${side === 'BUY' ? 'active' : ''}`}
            onClick={() => setSide('BUY')}
          >
            Buy
          </button>
          <button
            className={`dex-order-tab ${side === 'SELL' ? 'active' : ''}`}
            onClick={() => setSide('SELL')}
          >
            Sell
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dex-order-form">
          <div className="dex-order-type-selector">
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value as 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'STOP_LIMIT')}
              className="dex-order-select"
            >
              <option value="MARKET">Market</option>
              <option value="LIMIT">Limit</option>
              <option value="STOP_MARKET">Stop Market</option>
              <option value="STOP_LIMIT">Stop Limit</option>
            </select>
          </div>

          {(orderType === 'LIMIT' || orderType === 'STOP_LIMIT') && (
            <div className="dex-order-field">
              <label>Price (USDC)</label>
              <input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={currentPrice.toFixed(2)}
                className="dex-order-input"
              />
            </div>
          )}

          <div className="dex-order-field">
            <label>
              Quantity
              {maxQty > 0 && <span className="dex-order-max">Max: {maxQty.toFixed(3)}</span>}
            </label>
            <input
              type="number"
              step="0.001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0.00"
              className="dex-order-input"
              required
            />
            {maxQty > 0 && (
              <button
                type="button"
                onClick={() => setQuantity(maxQty.toFixed(3))}
                className="dex-order-max-btn"
              >
                MAX
              </button>
            )}
          </div>

          <div className="dex-order-checkbox">
            <label>
              <input
                type="checkbox"
                checked={reduceOnly}
                onChange={(e) => setReduceOnly(e.target.checked)}
              />
              Reduce Only
            </label>
          </div>

          {error && (
            <div className="dex-order-error">
              ⚠️ {(error instanceof Error ? error.message : String(error)) || 'Order failed'}
            </div>
          )}

          <button
            type="submit"
            disabled={!!loading || !canTrade}
            className={`dex-order-submit dex-order-submit-${side.toLowerCase()}`}
          >
            {loading ? 'Placing...' : !canTrade ? 'Connect Wallet' : `${side} ${symbol}`}
          </button>

          {quantity && currentPrice && (
            <div className="dex-order-summary">
              <div className="dex-order-summary-row">
                <span>Estimated Cost:</span>
                <span>${(parseFloat(quantity) * currentPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </div>
              {currentLeverage > 1 && (
                <div className="dex-order-summary-row">
                  <span>Leverage:</span>
                  <span className={currentLeverage > 10 ? 'dex-loss-text' : ''}>{currentLeverage}x</span>
                </div>
              )}
            </div>
          )}
        </form>
      </div>

      {showLeverageWarning && (
        <LeverageWarning
          leverage={currentLeverage}
          onAccept={handleLeverageWarningAccept}
          onCancel={handleCancel}
        />
      )}

      {showConfirmation && pendingOrder && (
        <OrderConfirmation
          orderType={orderType}
          symbol={symbol}
          quantity={pendingOrder.order_quantity}
          price={pendingOrder.order_price || currentPrice}
          total={pendingOrder.order_quantity * (pendingOrder.order_price || currentPrice)}
          leverage={currentLeverage}
          onConfirm={handleConfirmOrder}
          onCancel={handleCancel}
        />
      )}
    </>
  );
}

