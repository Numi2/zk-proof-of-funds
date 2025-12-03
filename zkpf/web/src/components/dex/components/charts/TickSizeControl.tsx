/**
 * Tick Size Control Component
 * 
 * Allows users to manually set the tick size for the footprint chart
 */

import { useState } from "react";
import "./TickSizeControl.css";

export interface TickSizeControlProps {
  currentTickSize: number | null;
  onTickSizeChange: (tickSize: number | null) => void;
  label?: string;
}

const COMMON_TICK_SIZES = [0.01, 0.1, 1, 10, 100];

export function TickSizeControl({
  currentTickSize,
  onTickSizeChange,
  label = "Tick Size",
}: TickSizeControlProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = (tickSize: number | null) => {
    onTickSizeChange(tickSize);
    setIsOpen(false);
  };

  return (
    <div className="tick-size-control">
      <button
        className="tick-size-button"
        onClick={() => setIsOpen(!isOpen)}
        title={currentTickSize ? `Tick: ${currentTickSize}` : "Auto tick size"}
      >
        <span className="tick-size-label">{label}:</span>
        <span className="tick-size-value">
          {currentTickSize ? currentTickSize.toFixed(2) : "Auto"}
        </span>
        <span className="tick-size-arrow">{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <div className="tick-size-dropdown">
          <button
            className={`tick-size-option ${currentTickSize === null ? "active" : ""}`}
            onClick={() => handleSelect(null)}
          >
            Auto
          </button>
          {COMMON_TICK_SIZES.map((size) => (
            <button
              key={size}
              className={`tick-size-option ${currentTickSize === size ? "active" : ""}`}
              onClick={() => handleSelect(size)}
            >
              {size.toFixed(2)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

