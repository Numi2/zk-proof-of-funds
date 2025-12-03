import React from 'react';
import { motion } from 'framer-motion';
import './OrderBottomSheet.css';

interface OrderBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function OrderBottomSheet({ isOpen, onClose, children }: OrderBottomSheetProps) {
  if (!isOpen) return null;

  return (
    <>
      <motion.div
        className="dex-bottom-sheet-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="dex-bottom-sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      >
        <div className="dex-bottom-sheet-handle" />
        <div className="dex-bottom-sheet-content">
          {children}
        </div>
      </motion.div>
    </>
  );
}

