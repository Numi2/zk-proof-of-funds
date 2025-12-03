import React from 'react';
import './OrderConfirmation.css';

interface OrderConfirmationProps {
  orderType: string;
  symbol: string;
  quantity: number;
  price: number;
  total: number;
  leverage?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function OrderConfirmation({
  orderType,
  symbol,
  quantity,
  price,
  total,
  leverage,
  onConfirm,
  onCancel,
}: OrderConfirmationProps) {
  const isLargeOrder = total > 10000;

  return (
    <div className="dex-order-confirmation">
      <div className="dex-confirmation-header">
        <h3>Confirm Order</h3>
      </div>
      <div className="dex-confirmation-content">
        {isLargeOrder && (
          <div className="dex-confirmation-warning">
            ⚠️ This is a large order. Please review carefully.
          </div>
        )}
        <div className="dex-confirmation-details">
          <div className="dex-confirmation-row">
            <span>Type:</span>
            <span>{orderType}</span>
          </div>
          <div className="dex-confirmation-row">
            <span>Symbol:</span>
            <span>{symbol}</span>
          </div>
          <div className="dex-confirmation-row">
            <span>Quantity:</span>
            <span>{quantity}</span>
          </div>
          <div className="dex-confirmation-row">
            <span>Price:</span>
            <span>${price.toLocaleString()}</span>
          </div>
          {leverage && (
            <div className="dex-confirmation-row">
              <span>Leverage:</span>
              <span>{leverage}x</span>
            </div>
          )}
          <div className="dex-confirmation-row dex-confirmation-total">
            <span>Total:</span>
            <span>${total.toLocaleString()}</span>
          </div>
        </div>
        <div className="dex-confirmation-actions">
          <button className="dex-confirm-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="dex-confirm-submit" onClick={onConfirm}>
            Confirm Order
          </button>
        </div>
      </div>
    </div>
  );
}

