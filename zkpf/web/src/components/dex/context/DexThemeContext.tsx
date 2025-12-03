import { createContext, useContext, ReactNode } from 'react';
import { useTheme } from '../../../context/ThemeContext';

interface DexThemeContextType {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

const DexThemeContext = createContext<DexThemeContextType | undefined>(undefined);

export function DexThemeProvider({ children }: { children: ReactNode }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <DexThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </DexThemeContext.Provider>
  );
}

export function useDexTheme() {
  const context = useContext(DexThemeContext);
  if (context === undefined) {
    throw new Error('useDexTheme must be used within a DexThemeProvider');
  }
  return context;
}

