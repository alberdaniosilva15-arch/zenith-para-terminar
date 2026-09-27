import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { MapSingleton } from '../lib/mapInstance';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  /** Call this to start the theme toggle (with pour animation if ThemePour is mounted) */
  toggle: () => void;
  /** True while the golden pour animation is running */
  isTransitioning: boolean;
  /** Internal: called by ThemePour to register itself as the animation handler */
  _registerPourHandler: (handler: (() => void) | null) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggle: () => {},
  isTransitioning: false,
  _registerPourHandler: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem('zr-theme');
  return stored === 'light' ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const pourHandlerRef = useRef<(() => void) | null>(null);

  // Apply data-theme + color-scheme on mount and change
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('data-theme', theme);
    html.style.colorScheme = theme;

    // Update <meta name="theme-color"> if it exists
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme === 'dark' ? '#050505' : '#f0eeeb');
    }

    // Persist
    localStorage.setItem('zr-theme', theme);

    // O mapa tem de acompanhar: `dark-v11` -> `light-v11`. É no-op se o mapa
    // ainda não tiver sido criado (o `MapSingleton.init` lê o `data-theme`
    // que acabámos de escrever, por isso arranca já com o estilo certo).
    MapSingleton.applyTheme(theme);
  }, [theme]);

  const _registerPourHandler = useCallback((handler: (() => void) | null) => {
    pourHandlerRef.current = handler;
  }, []);

  const toggle = useCallback(() => {
    if (isTransitioning) return;

    // If ThemePour registered a handler, use it (animated pour)
    if (pourHandlerRef.current) {
      pourHandlerRef.current();
    } else {
      // No pour handler — instant swap
      setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
    }
  }, [isTransitioning]);

  // Expose setTheme for ThemePour to call after animation
  const contextValue: ThemeContextValue & { _setTheme: typeof setTheme; _setTransitioning: typeof setIsTransitioning } = {
    theme,
    toggle,
    isTransitioning,
    _registerPourHandler,
    _setTheme: setTheme,
    _setTransitioning: setIsTransitioning,
  };

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Internal hook — only for ThemePour */
export function useThemeInternal() {
  return useContext(ThemeContext) as ReturnType<typeof useTheme> & {
    _setTheme: React.Dispatch<React.SetStateAction<Theme>>;
    _setTransitioning: React.Dispatch<React.SetStateAction<boolean>>;
  };
}
