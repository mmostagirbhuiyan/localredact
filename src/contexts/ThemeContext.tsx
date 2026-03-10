import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeContextType {
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('lr-theme');
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored;
      }
    }
    return 'system';
  });

  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      let effectiveDark: boolean;

      if (preference === 'system') {
        effectiveDark = mediaQuery.matches;
      } else {
        effectiveDark = preference === 'dark';
      }

      setIsDark(effectiveDark);

      if (effectiveDark) {
        root.classList.add('dark');
        root.classList.remove('light');
      } else {
        root.classList.add('light');
        root.classList.remove('dark');
      }
    };

    applyTheme();

    const handleChange = () => applyTheme();
    mediaQuery.addEventListener('change', handleChange);

    localStorage.setItem('lr-theme', preference);

    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [preference]);

  return (
    <ThemeContext.Provider value={{ preference, setPreference, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
