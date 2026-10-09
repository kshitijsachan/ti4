const TOKEN_KEY = "ti4online.token";

/*
 * The seat token lives per tab (sessionStorage), so a host can play several
 * seats side by side in separate tabs. localStorage keeps the most recent
 * link as the default for new tabs and survives closing the browser.
 */

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string | null) {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    /* private mode: the token lives for this page only */
  }
}

const tab = () => window.sessionStorage;
const device = () => window.localStorage;

/** The seat token this tab plays as: the tab's own, else the device default. */
export function getToken(): string | null {
  return read(tab, TOKEN_KEY) ?? read(device, TOKEN_KEY);
}

/**
 * Pins the token to this tab. Unless `tabOnly`, it also becomes the default
 * for new tabs on this device.
 */
export function setToken(token: string, tabOnly = false) {
  write(tab, TOKEN_KEY, token);
  if (!tabOnly) write(device, TOKEN_KEY, token);
}

/** Forgets this tab's seat (and the device default when it is the same seat). */
export function clearToken() {
  const current = getToken();
  write(tab, TOKEN_KEY, null);
  if (read(device, TOKEN_KEY) === current) write(device, TOKEN_KEY, null);
}

/**
 * Moves a `?t=` token from the address bar into storage, so the secret is not
 * left in history or a screenshot. Returns the token in effect. A link with
 * `&tab=1` (the host's "Open as" links) only claims this tab, leaving the
 * device's default seat alone.
 */
export function adoptTokenFromUrl(): string | null {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("t");
  if (!fromUrl) {
    const current = getToken();
    // Pin the inherited default to this tab so a later link elsewhere does not swap seats here.
    if (current && !read(tab, TOKEN_KEY)) write(tab, TOKEN_KEY, current);
    return current;
  }
  setToken(fromUrl, url.searchParams.get("tab") === "1");
  url.searchParams.delete("t");
  url.searchParams.delete("tab");
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

/** A link that opens a seat in a new tab without changing the device's default seat. */
export function seatTabLink(token: string) {
  return `${window.location.origin}/play?t=${token}&tab=1`;
}
