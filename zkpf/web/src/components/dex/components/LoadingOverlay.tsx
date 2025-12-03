import React from 'react';
import { motion } from 'framer-motion';
import './LoadingOverlay.css';

interface LoadingOverlayProps {
  message?: string;
  fullScreen?: boolean;
}

export function LoadingOverlay({ message = 'Loading...', fullScreen = false }: LoadingOverlayProps) {
  return (
    <motion.div
      className={`dex-loading-overlay ${fullScreen ? 'dex-loading-fullscreen' : ''}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="dex-loading-spinner">
        <div className="dex-spinner-ring" />
        <div className="dex-spinner-ring" />
        <div className="dex-spinner-ring" />
      </div>
      {message && <p className="dex-loading-message">{message}</p>}
    </motion.div>
  );
}

