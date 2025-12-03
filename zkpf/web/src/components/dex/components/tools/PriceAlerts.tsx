import React, { useState } from 'react';
import type { API } from '@orderly.network/types';
import './PriceAlerts.css';

interface PriceAlert {
  id: string;
  symbol: string;
  price: number;
  condition: 'above' | 'below';
  active: boolean;
}

interface PriceAlertsProps {
  symbol: API.Symbol;
}

export function PriceAlerts({ symbol }: PriceAlertsProps) {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [alertPrice, setAlertPrice] = useState<number>(0);
  const [alertCondition, setAlertCondition] = useState<'above' | 'below'>('above');

  const handleCreateAlert = () => {
    if (!alertPrice) return;

    const newAlert: PriceAlert = {
      id: Date.now().toString(),
      symbol: symbol.symbol,
      price: alertPrice,
      condition: alertCondition,
      active: true,
    };

    setAlerts([...alerts, newAlert]);
    setAlertPrice(0);
  };

  const handleToggleAlert = (id: string) => {
    setAlerts(alerts.map(alert => 
      alert.id === id ? { ...alert, active: !alert.active } : alert
    ));
  };

  const handleDeleteAlert = (id: string) => {
    setAlerts(alerts.filter(alert => alert.id !== id));
  };

  return (
    <div className="dex-price-alerts">
      <h4>Price Alerts</h4>
      
      <div className="dex-alert-form">
        <div className="dex-alert-inputs">
          <input
            type="number"
            value={alertPrice || ''}
            onChange={(e) => setAlertPrice(Number(e.target.value) || 0)}
            placeholder="Alert price"
            className="dex-alert-input"
          />
          <select
            value={alertCondition}
            onChange={(e) => setAlertCondition(e.target.value as 'above' | 'below')}
            className="dex-alert-select"
          >
            <option value="above">Above</option>
            <option value="below">Below</option>
          </select>
          <button
            onClick={handleCreateAlert}
            disabled={!alertPrice}
            className="dex-alert-create-button"
          >
            Create
          </button>
        </div>
      </div>

      <div className="dex-alerts-list">
        {alerts.length === 0 ? (
          <div className="dex-alerts-empty">No alerts set</div>
        ) : (
          alerts.map(alert => (
            <div key={alert.id} className={`dex-alert-item ${alert.active ? '' : 'dex-alert-inactive'}`}>
              <div className="dex-alert-info">
                <span className="dex-alert-symbol">{alert.symbol}</span>
                <span className="dex-alert-condition">
                  {alert.condition === 'above' ? '↑' : '↓'} ${alert.price.toLocaleString()}
                </span>
              </div>
              <div className="dex-alert-actions">
                <button
                  onClick={() => handleToggleAlert(alert.id)}
                  className="dex-alert-toggle"
                  title={alert.active ? 'Disable' : 'Enable'}
                >
                  {alert.active ? '✓' : '○'}
                </button>
                <button
                  onClick={() => handleDeleteAlert(alert.id)}
                  className="dex-alert-delete"
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

