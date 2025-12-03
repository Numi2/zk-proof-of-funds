/**
 * Order Templates with Full Orderly SDK Integration
 * 
 * Quick order placement using Orderly hooks for real order execution
 */

import React, { useState, useCallback } from 'react';
import type { API } from '@orderly.network/types';
import { useQuickOrder } from '../../hooks/useOrderlyHooks';
import toast from 'react-hot-toast';
import './OrderTemplates.css';

export type OrderTemplate = {
  id: string;
  name: string;
  description: string;
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  side: 'buy' | 'sell';
  quantity?: number;
  price?: number;
  stopPrice?: number;
};

const DEFAULT_TEMPLATES: OrderTemplate[] = [
  {
    id: 'market-buy',
    name: 'Market Buy',
    description: 'Buy immediately at market price',
    type: 'market',
    side: 'buy',
  },
  {
    id: 'market-sell',
    name: 'Market Sell',
    description: 'Sell immediately at market price',
    type: 'market',
    side: 'sell',
  },
  {
    id: 'limit-buy',
    name: 'Limit Buy',
    description: 'Buy when price reaches target',
    type: 'limit',
    side: 'buy',
  },
  {
    id: 'limit-sell',
    name: 'Limit Sell',
    description: 'Sell when price reaches target',
    type: 'limit',
    side: 'sell',
  },
  {
    id: 'stop-loss',
    name: 'Stop Loss',
    description: 'Auto-sell to limit losses',
    type: 'stop',
    side: 'sell',
  },
  {
    id: 'take-profit',
    name: 'Take Profit',
    description: 'Auto-sell to lock in gains',
    type: 'stop',
    side: 'sell',
  },
];

interface OrderTemplatesProps {
  symbol: string;
  onTemplateExecuted?: (template: OrderTemplate) => void;
}

interface OrderInputDialogProps {
  template: OrderTemplate;
  symbol: string;
  onSubmit: (quantity: number, price?: number, stopPrice?: number) => void;
  onCancel: () => void;
  loading: boolean;
}

function OrderInputDialog({ template, symbol, onSubmit, onCancel, loading }: OrderInputDialogProps) {
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(quantity);
    const prc = price ? parseFloat(price) : undefined;
    const stp = stopPrice ? parseFloat(stopPrice) : undefined;
    
    if (!qty || qty <= 0) {
      toast.error('Please enter a valid quantity');
      return;
    }
    
    onSubmit(qty, prc, stp);
  };

  return (
    <div className="dex-order-input-overlay" onClick={onCancel}>
      <div className="dex-order-input-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dex-order-input-header">
          <h3>{template.name}</h3>
          <button className="dex-dialog-close" onClick={onCancel}>×</button>
        </div>
        
        <form onSubmit={handleSubmit} className="dex-order-input-form">
          <div className="dex-order-input-field">
            <label>Symbol</label>
            <input type="text" value={symbol} disabled />
          </div>

          <div className="dex-order-input-field">
            <label>Quantity *</label>
            <input
              type="number"
              step="0.001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0.00"
              autoFocus
              required
            />
          </div>

          {(template.type === 'limit' || template.type === 'stop_limit') && (
            <div className="dex-order-input-field">
              <label>Limit Price *</label>
              <input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                required={template.type === 'limit'}
              />
            </div>
          )}

          {(template.type === 'stop' || template.type === 'stop_limit') && (
            <div className="dex-order-input-field">
              <label>Stop Price *</label>
              <input
                type="number"
                step="0.01"
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>
          )}

          <div className="dex-order-input-actions">
            <button type="button" onClick={onCancel} className="dex-order-cancel">
              Cancel
            </button>
            <button
              type="submit"
              className={`dex-order-submit dex-order-${template.side}`}
              disabled={loading}
            >
              {loading ? 'Placing...' : `${template.side.toUpperCase()} ${symbol}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function OrderTemplatesIntegrated({ symbol, onTemplateExecuted }: OrderTemplatesProps) {
  const [customTemplates, setCustomTemplates] = useState<OrderTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<OrderTemplate | null>(null);
  
  const {
    marketBuy,
    marketSell,
    limitBuy,
    limitSell,
    stopLoss,
    takeProfit,
    loading,
    error,
  } = useQuickOrder(symbol);

  const allTemplates = [...DEFAULT_TEMPLATES, ...customTemplates];

  const executeTemplate = useCallback(async (
    template: OrderTemplate,
    quantity: number,
    price?: number,
    stopPrice?: number
  ) => {
    try {
      let result;

      switch (template.id) {
        case 'market-buy':
          result = await marketBuy(quantity);
          break;
        case 'market-sell':
          result = await marketSell(quantity);
          break;
        case 'limit-buy':
          if (!price) throw new Error('Price required for limit order');
          result = await limitBuy(quantity, price);
          break;
        case 'limit-sell':
          if (!price) throw new Error('Price required for limit order');
          result = await limitSell(quantity, price);
          break;
        case 'stop-loss':
          if (!stopPrice) throw new Error('Stop price required');
          result = await stopLoss(quantity, stopPrice);
          break;
        case 'take-profit':
          if (!stopPrice) throw new Error('Stop price required');
          result = await takeProfit(quantity, stopPrice);
          break;
        default:
          throw new Error('Unknown template');
      }

      toast.success(`Order placed successfully!`);
      setSelectedTemplate(null);
      onTemplateExecuted?.(template);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Order failed';
      toast.error(message);
      throw err;
    }
  }, [marketBuy, marketSell, limitBuy, limitSell, stopLoss, takeProfit, onTemplateExecuted]);

  const handleTemplateClick = (template: OrderTemplate) => {
    setSelectedTemplate(template);
  };

  const handleOrderSubmit = async (quantity: number, price?: number, stopPrice?: number) => {
    if (!selectedTemplate) return;
    await executeTemplate(selectedTemplate, quantity, price, stopPrice);
  };

  return (
    <>
      <div className="dex-order-templates">
        <div className="dex-order-templates-header">
          <h4>Quick Orders</h4>
          <span className="dex-order-templates-symbol">{symbol}</span>
        </div>
        
        {error && (
          <div className="dex-order-templates-error">
            ⚠️ {(error instanceof Error ? error.message : String(error)) || 'Failed to connect'}
          </div>
        )}
        
        <div className="dex-order-templates-grid">
          {allTemplates.map(template => (
            <button
              key={template.id}
              className="dex-order-template-card"
              onClick={() => handleTemplateClick(template)}
              disabled={!!loading}
            >
              <div className="dex-order-template-icon">
                {template.type === 'market' ? '⚡' : 
                 template.type === 'limit' ? '🎯' : 
                 template.id === 'stop-loss' ? '🛡️' : '💰'}
              </div>
              <div className="dex-order-template-name">{template.name}</div>
              <div className="dex-order-template-description">{template.description}</div>
              <div className={`dex-order-template-side dex-order-template-${template.side}`}>
                {template.side.toUpperCase()}
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedTemplate && (
        <OrderInputDialog
          template={selectedTemplate}
          symbol={symbol}
          onSubmit={handleOrderSubmit}
          onCancel={() => setSelectedTemplate(null)}
          loading={!!loading}
        />
      )}
    </>
  );
}

