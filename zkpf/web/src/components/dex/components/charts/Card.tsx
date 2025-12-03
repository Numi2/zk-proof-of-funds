/**
 * Card Component
 * 
 * Simple card component for the footprint chart
 */

import type { ReactNode } from "react";
import "./Card.css";

export interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = "" }: CardProps) {
  return <div className={`footprint-card ${className}`}>{children}</div>;
}

