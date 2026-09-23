import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BADGES, freshState, localDay } from '../src/core.js';
import { decodeTransfer, encodeTransfer, transferTokenFromHash, transferUrl } from '../src/transfer.js';
import { qrcode } from '../src/vendor/qrcode.js';

test('a full progress snapshot survives transfer and fits in a locally generated QR code', async () => {
  const catalog = JSON.parse(await readFile(new URL('../content/catalog.json', import.meta.url), 'utf8'));
  const lessons = (await Promise.all(catalog.topics.map(async topic => JSON.parse(await readFile(new URL(`../content/${topic.file}`, import.meta.url), 'utf8'))))).flat();
  const state = freshState();
  state.day = localDay(); state.daily = 3; state.total = 345;
  state.characters = 23456; state.perfect = 123; state.streak = 9; state.maxStreak = 20; state.best = 75;
  state.badges = BADGES.map(badge => badge.id);
  state.saved = lessons.flatMap(lesson => lesson.phrases.map(phrase => phrase.id)).toSorted((a, b) => b.length - a.length).slice(0, 20);
  state.reviews = lessons.toSorted((a, b) => b.id.length - a.id.length).slice(0, 14).map((lesson, index) => ({ id: lesson.id, due: state.day + index, box: index % 4 }));
  state.prefs = { translation: false, keyboard: false, sound: false, level: 'C2', topic: 'cinema' };

  const token = await encodeTransfer(state);
  assert.deepEqual(await decodeTransfer(token), state);
  const url = transferUrl(token, 'https://example.com/lingotype/index.html');
  assert.ok(url.startsWith('https://example.com/lingotype/#progress='));
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  assert.ok(qr.getModuleCount() > 0);
  assert.match(qr.createSvgTag(), /<svg/);
});

test('invalid transfer data is rejected before it can replace progress', async () => {
  for (const token of ['', 'g1_bad!', 'r1_YmFk', 'x1_abc', 'g1_' + 'a'.repeat(6001)]) {
    await assert.rejects(decodeTransfer(token));
  }
  assert.equal(transferTokenFromHash('#progress=g1_abc'), 'g1_abc');
  assert.equal(transferTokenFromHash('#practice'), null);
});

test('local development produces a link to the published site', () => {
  assert.equal(transferUrl('r1_abc', 'http://127.0.0.1:4173/'), 'https://meldxkviel.github.io/lingotype/#progress=r1_abc');
});
