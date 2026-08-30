export const THEME_COOKIE = "aavis-theme";

export type Theme = "light" | "dark";

/** One year, readable by the server on the next request. */
export function persistTheme(theme: Theme) {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}

export function readThemeCookie(): Theme | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=(light|dark)`));
  return (match?.[1] as Theme) ?? null;
}
