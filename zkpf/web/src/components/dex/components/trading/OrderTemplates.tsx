import React, { useState } from 'react';
import type { API } from '@orderly.network/types';
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
];

interface OrderTemplatesProps {
  symbol: API.Symbol;
  onSelectTemplate: (template: OrderTemplate) => void;
}

export function OrderTemplates({ symbol, onSelectTemplate }: OrderTemplatesProps) {
  const [customTemplates, setCustomTemplates] = useState<OrderTemplate[]>([]);
  const allTemplates = [...DEFAULT_TEMPLATES, ...customTemplates];

  return (
    <div className="dex-order-templates">
      <div className="dex-order-templates-header">
        <h4>Quick Orders</h4>
        <button className="dex-add-template-button">+</button>
      </div>
      <div className="dex-order-templates-grid">
        {allTemplates.map(template => (
          <button
            key={template.id}
            className="dex-order-template-card"
            onClick={() => onSelectTemplate(template)}
          >
            <div className="dex-order-template-name">{template.name}</div>
            <div className="dex-order-template-description">{template.description}</div>
            <div className={`dex-order-template-side dex-order-template-${template.side}`}>
              {template.side.toUpperCase()}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

