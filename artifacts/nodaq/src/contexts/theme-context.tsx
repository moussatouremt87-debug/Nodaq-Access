import { createContext, useContext, useState, useCallback } from 'react';

type Theme = 'dark' | 'light';
const STORAGE_KEY = 'nodaq-theme';

/**
 * Le thème à appliquer (US-A8.1).
 *
 * Ordre : un choix explicite de l'utilisateur d'abord — il a tranché, on ne
 * revient pas dessus —, sinon la préférence du système. Le défaut sombre en
 * dur qui régnait ici supposait un usage de bureau ; en plein soleil un fond
 * sombre est le pire cas, indépendamment de son contraste calculé.
 *
 * Le repli reste le sombre : sans `window` (rendu hors navigateur) et sans
 * `matchMedia` (jsdom n'en fournit pas nativement), on ne devine pas.
 *
 * DOIT rester d'accord avec le script anti-flash de `index.html`, qui décide
 * du premier rendu. Un désaccord se voit à l'œil : l'écran bascule après le
 * premier paint. `theme-context.test.ts` compare les deux.
 */
function readTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const choisi = localStorage.getItem(STORAGE_KEY);
  if (choisi === 'light' || choisi === 'dark') return choisi;
  if (typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme: Theme) {
  const html = document.documentElement;
  if (theme === 'dark') {
    html.classList.add('dark');
  } else {
    html.classList.remove('dark');
  }
  localStorage.setItem(STORAGE_KEY, theme);
}

type ThemeContextValue = { theme: Theme; toggle: () => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  const toggle = useCallback(() => {
    setThemeState(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Must be used inside ThemeProvider. */
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
