const TOKEN_KEY = "ti4online.token";

/** The player's seat token from their `/play?t=` link. Survives reloads. */
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode: the token lives for this page only */
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing stored */
  }
}

/**
 * Moves a `?t=` token from the address bar into storage, so the secret is not
 * left in history or a screenshot. Returns the token in effect.
 */
export function adoptTokenFromUrl(): string | null {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("t");
  if (!fromUrl) return getToken();
  setToken(fromUrl);
  url.searchParams.delete("t");
  window.history.replaceState(
    window.history.state,
    "",
    url.pathname + url.search + url.hash,
  );
  return fromUrl;
}

export function inviteLink(token: string) {
  return `${window.location.origin}/play?t=${token}`;
}
