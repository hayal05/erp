import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { applyTheme, otherTheme, saveTheme } from './theme.js';

// The theme is applied before first paint by the inline script in index.html; this only toggles it.
export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const flip = () => {
    const next = otherTheme(theme);
    applyTheme(next); saveTheme(next); setTheme(next);
  };
  return (
    <button type="button" className="icon-btn" onClick={flip} aria-label={`Switch to ${otherTheme(theme)} theme`}>
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
