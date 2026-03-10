import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

type ThemePreference = 'light' | 'dark' | 'system';

const options: { value: ThemePreference; icon: React.ReactNode; label: string }[] = [
  { value: 'light', icon: <Sun size={14} />, label: 'Light' },
  { value: 'dark', icon: <Moon size={14} />, label: 'Dark' },
  { value: 'system', icon: <Monitor size={14} />, label: 'System' },
];

export const ThemeToggle: React.FC = () => {
  const { preference, setPreference } = useTheme();

  return (
    <div
      className="flex items-center gap-1 p-1 rounded-full"
      style={{ background: 'var(--bg-soft)', border: '1px solid var(--border-subtle)' }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setPreference(opt.value)}
          title={opt.label}
          className="flex items-center justify-center w-7 h-7 rounded-full transition-all duration-200"
          style={{
            background: preference === opt.value ? 'var(--bg-elevated)' : 'transparent',
            color: preference === opt.value ? 'var(--ink-primary)' : 'var(--ink-tertiary)',
            boxShadow: preference === opt.value ? 'var(--shadow-sm)' : 'none',
          }}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
};
