import { BADGES, LEVELS, MAX_REVIEWS, MAX_SAVED, sanitizeState } from './core.js';

const MAX_TOKEN_LENGTH = 6000;
const MAX_PAYLOAD_BYTES = 8192;
const idPattern = /^[a-z0-9-]{1,48}$/;
const validNumber = value => Number.isSafeInteger(value) && value >= 0 && value <= 9999999;
const validIds = (items, limit) => Array.isArray(items) && items.length <= limit && items.every(id => typeof id === 'string' && idPattern.test(id)) && new Set(items).size === items.length;

function payloadFromState(raw) {
  const state = sanitizeState(raw);
  return [
    1, state.day, state.daily, state.total, state.characters, state.perfect,
    state.streak, state.maxStreak, state.best, state.badges, state.saved,
    state.reviews.map(({ id, due, box }) => [id, due, box]),
    [state.prefs.translation, state.prefs.keyboard, state.prefs.sound, state.prefs.level, state.prefs.topic],
  ];
}

function stateFromPayload(payload) {
  if (!Array.isArray(payload) || payload.length !== 13 || payload[0] !== 1 ||
      !payload.slice(1, 9).every(validNumber) ||
      !validIds(payload[9], BADGES.length) || !payload[9].every(id => BADGES.some(badge => badge.id === id)) ||
      !validIds(payload[10], MAX_SAVED) ||
      !Array.isArray(payload[11]) || payload[11].length > MAX_REVIEWS ||
      !payload[11].every(item => Array.isArray(item) && item.length === 3 && typeof item[0] === 'string' && idPattern.test(item[0]) && validNumber(item[1]) && Number.isInteger(item[2]) && item[2] >= 0 && item[2] <= 3) ||
      new Set(payload[11].map(item => item[0])).size !== payload[11].length ||
      !Array.isArray(payload[12]) || payload[12].length !== 5 ||
      !payload[12].slice(0, 3).every(value => typeof value === 'boolean') ||
      !LEVELS.includes(payload[12][3]) || typeof payload[12][4] !== 'string' || !idPattern.test(payload[12][4])) {
    throw new Error('Invalid progress link');
  }
  const [v, day, daily, total, characters, perfect, streak, maxStreak, best, badges, saved, reviews, prefs] = payload;
  return sanitizeState({
    v, day, daily, total, characters, perfect, streak, maxStreak, best, badges, saved,
    reviews: reviews.map(([id, due, box]) => ({ id, due, box })),
    prefs: { translation: prefs[0], keyboard: prefs[1], sound: prefs[2], level: prefs[3], topic: prefs[4] },
  });
}

function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid progress link');
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function readLimited(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_PAYLOAD_BYTES) { await reader.cancel(); throw new Error('Progress link is too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function encodeTransfer(state) {
  const bytes = new TextEncoder().encode(JSON.stringify(payloadFromState(state)));
  if (bytes.length > MAX_PAYLOAD_BYTES) throw new Error('Progress is too large to transfer');
  if (typeof CompressionStream !== 'function') return `r1_${toBase64Url(bytes)}`;
  const compressed = await readLimited(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')));
  return `g1_${toBase64Url(compressed)}`;
}

export async function decodeTransfer(token) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || !/^[gr]1_[A-Za-z0-9_-]+$/.test(token)) throw new Error('Invalid progress link');
  const bytes = fromBase64Url(token.slice(3));
  let decoded;
  if (token.startsWith('g1_')) {
    if (typeof DecompressionStream !== 'function') throw new Error('Compressed progress links are not supported here');
    decoded = await readLimited(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')));
  } else {
    if (bytes.length > MAX_PAYLOAD_BYTES) throw new Error('Progress link is too large');
    decoded = bytes;
  }
  return stateFromPayload(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded)));
}

export function transferTokenFromHash(hash) {
  return hash.startsWith('#progress=') ? hash.slice('#progress='.length) : null;
}

export function transferUrl(token, href = location.href) {
  const url = new URL('.', href);
  if (['localhost', '127.0.0.1'].includes(url.hostname)) return `https://meldxkviel.github.io/lingotype/#progress=${token}`;
  url.hash = `progress=${token}`;
  return url.href;
}
