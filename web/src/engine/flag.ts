/**
 * The old engine flag. The web always runs on the engine stream now (the legacy decision UI was removed);
 * `?engine=0` (or a stored "off" from the old settings toggle) is still read so the page can say the legacy UI is
 * gone instead of silently ignoring it. `?engine=1` clears nothing and changes nothing.
 */
const KEY = "ti4online.engine";

function readParam(): boolean | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("engine");
  if (v === "1" || v === "on" || v === "true") return true;
  if (v === "0" || v === "off" || v === "false") return false;
  return null;
}

function readStored(): boolean | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "on" ? true : v === "off" ? false : null;
  } catch {
    return null;
  }
}

/** This browser's explicit choice (URL beats storage; a URL choice is remembered), or null to follow the server. */
export function engineOverride(): boolean | null {
  const param = readParam();
  if (param !== null) setEngineOverride(param);
  return param ?? readStored();
}

export function setEngineOverride(on: boolean | null) {
  try {
    if (on === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable: the choice lasts for this page */
  }
}
