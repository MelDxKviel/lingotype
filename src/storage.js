import { freshState, sanitizeState } from './core.js';

// Scope the cookie to this GitHub Pages project, so sibling sites don't collide.
export const COOKIE_NAME = 'lingotype_v1';
export const cookiePath = new URL('.', location.href).pathname;

export function loadState() {
  try {
    const entry = document.cookie.split('; ').find(item => item.startsWith(`${COOKIE_NAME}=`));
    return entry ? sanitizeState(JSON.parse(decodeURIComponent(entry.slice(COOKIE_NAME.length + 1)))) : freshState();
  } catch { return freshState(); }
}

export function saveState(state) {
  try {
    const safe = sanitizeState(state);
    let value = encodeURIComponent(JSON.stringify(safe));
    // Preserve the counters and bookmarks first. The review queue is intentionally small.
    while (value.length > 3400 && safe.reviews.length) { safe.reviews.shift(); value = encodeURIComponent(JSON.stringify(safe)); }
    if (value.length > 3400) return false;
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${COOKIE_NAME}=${value}; Path=${cookiePath}; Max-Age=31536000; SameSite=Lax${secure}`;
    return document.cookie.split('; ').some(item => item === `${COOKIE_NAME}=${value}`);
  } catch { return false; }
}
