import { useCallback, useEffect, useState } from "react";

/**
 * Tiny theme store: class on <html> plus localStorage. A matching inline script in index.html
 * applies the stored theme before first paint, so the app never flashes light in dark mode.
 * No provider is needed; every consumer reads the same localStorage key and the DOM class.
 */
const KEY = "sp_theme";
const prefersDark = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
const stored = () => {
  try { return localStorage.getItem(KEY); } catch { return null; }
};

export function applyTheme(theme) {
  if (typeof document === "undefined") return;
  const dark = theme === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b0f16" : "#4f46e5");
}

export function useTheme() {
  const [theme, setTheme] = useState(() => stored() || (prefersDark() ? "dark" : "light"));

  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
  }, [theme]);

  // Follow the OS only while the user has not made an explicit choice.
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = (e) => { if (!stored()) setTheme(e.matches ? "dark" : "light"); };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return { theme, toggle };
}
