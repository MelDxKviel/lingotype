// Run from the project root. Copy to output/add-content.mjs and replace the data.
// Default: validate and preview. Pass --write to append the prepared lessons.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

// Requested ADDITIONS by level, not the final collection totals.
const expected = { A2: 2 };
const batches = new Map();

function add(topic, source) {
  const rows = source.trim().split(/\r?\n/).map((line, index) => {
    const fields = line.split('|');
    const tag = `${topic}, row ${index + 1}`;
    assert([8, 12, 16].includes(fields.length), `${tag}: expected 8, 12 or 16 fields`);
    assert(fields.every(field => field && field === field.trim()), `${tag}: empty field or extra spaces`);
    const [level, title, text, translation, ...details] = fields;
    const phrases = [];
    for (let i = 0; i < details.length; i += 4) {
      const [text, meaning, note, example] = details.slice(i, i + 4);
      phrases.push({ text, meaning, note, example });
    }
    return { level, title, text, translation, phrases };
  });
  assert(!batches.has(topic), `Combine all ${topic} rows in one add() call`);
  batches.set(topic, rows);
}

// One line per lesson: level|title|text|translation|phrase|meaning|note|example
// Append another |phrase|meaning|note|example group for each extra phrase (up to 3).
add('travel', `
A2|Свободные руки|We left our bags at the station. Now we can explore the town without carrying them.|Мы оставили сумки на вокзале. Теперь можно гулять по городу, не таская их с собой.|left our bags|оставили наши сумки|Leave something somewhere — оставить вещь в определённом месте. Left — прошедшая форма leave.|We left our bags at the hotel.
A2|У выхода на посадку|Please keep your ticket ready. We will board the plane in a few minutes.|Пожалуйста, держите билет наготове. Через несколько минут мы сядем в самолёт.|keep your ticket ready|держать билет наготове|Keep something ready — держать что-то подготовленным к использованию.|Keep your ticket ready when you enter the station.
`);

const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
assert(Object.keys(expected).every(level => levels.includes(level)), 'Unknown expected level');
assert(Object.values(expected).every(count => Number.isInteger(count) && count >= 0), 'Invalid expected count');
assert(process.argv.slice(2).every(arg => arg === '--write'), 'Usage: node output/add-content.mjs [--write]');
const counts = Object.fromEntries(levels.map(level => [level, 0]));
const catalog = JSON.parse(readFileSync('content/catalog.json', 'utf8'));
const originals = new Map();
const ids = new Set();
const texts = new Set();

for (const topic of catalog.topics) {
  assert(/^[a-z0-9-]+\.json$/.test(topic.file), 'Invalid catalog filename');
  const path = `content/${topic.file}`;
  const raw = readFileSync(path, 'utf8');
  const lessons = JSON.parse(raw);
  assert(Array.isArray(lessons) && lessons.length, `${path}: expected a nonempty array`);
  originals.set(topic.id, { path, raw, lessons });
  for (const lesson of lessons) {
    for (const id of [lesson.id, ...lesson.phrases.map(phrase => phrase.id)]) {
      assert(!ids.has(id), `Existing ID collision: ${id}`);
      ids.add(id);
    }
    texts.add(lesson.text.toLowerCase());
  }
}

function reserveId(id) {
  assert(/^[a-z0-9-]{1,48}$/.test(id) && !ids.has(id), `Invalid or duplicate ID: ${id}`);
  ids.add(id);
  return id;
}

const writes = [];
for (const [topic, rows] of batches) {
  assert(originals.has(topic), `Unknown topic: ${topic}`);
  const { path, raw, lessons: before } = originals.get(topic);
  const numberedIds = before.map(lesson => lesson.id.match(/^([a-z0-9-]+)-(\d+)$/));
  assert(numberedIds.every(Boolean), `${topic}: expected numbered lesson IDs`);
  const prefix = numberedIds[0][1];
  assert(numberedIds.every(match => match[1] === prefix), `${topic}: mixed lesson prefixes`);
  let number = Math.max(...numberedIds.map(match => Number(match[2])));

  const additions = rows.map(row => {
    const id = reserveId(`${prefix}-${String(++number).padStart(2, '0')}`);
    assert(levels.includes(row.level), `${id}: unknown level`);
    counts[row.level]++;
    assert(row.text.length >= 20 && row.text.length <= 240, `${id}: text length must be 20-240`);
    assert(/^[\x20-\x7E]+$/.test(row.text) && !/[<>]|  /.test(row.text), `${id}: invalid text characters or spaces`);
    assert(!texts.has(row.text.toLowerCase()), `${id}: duplicate text (possibly an already applied batch)`);
    texts.add(row.text.toLowerCase());
    const ranges = [];
    const phrases = row.phrases.map((phrase, index) => {
      const phraseId = reserveId(`${id}-p${index + 1}`);
      const start = row.text.indexOf(phrase.text), end = start + phrase.text.length;
      assert(start >= 0 && row.text.indexOf(phrase.text, end) === -1, `${phraseId}: phrase must occur exactly once`);
      assert(start === 0 || !/[A-Za-z]/.test(row.text[start - 1]), `${phraseId}: phrase begins inside a word`);
      assert(end === row.text.length || !/[A-Za-z]/.test(row.text[end]), `${phraseId}: phrase ends inside a word`);
      assert(!ranges.some(range => start < range.end && end > range.start), `${phraseId}: overlapping phrases`);
      ranges.push({ start, end });
      assert.notEqual(phrase.example, row.text, `${phraseId}: use a separate example`);
      return { id: phraseId, ...phrase };
    });
    return { id, ...row, phrases };
  });

  const ending = raw.match(/(\r?\n)\]\s*$/);
  const indent = raw.match(/\r?\n([ \t]+)\{/);
  assert(ending && indent, `${path}: expected a formatted JSON array`);
  const block = JSON.stringify(additions, null, indent[1]).slice(2, -2).replaceAll('\n', ending[1]);
  const updated = raw.slice(0, ending.index) + ',' + ending[1] + block + ending[0];
  const parsed = JSON.parse(updated);
  assert.deepEqual(parsed.slice(0, before.length), before, `${path}: existing lessons changed`);
  assert.deepEqual(parsed.slice(before.length), additions, `${path}: additions differ`);
  writes.push({ path, raw, updated, count: additions.length });
}

assert(writes.length > 0, 'No batches supplied');
assert.deepEqual(counts, Object.fromEntries(levels.map(level => [level, expected[level] ?? 0])), 'Addition counts differ from the request');
// Recheck every source before writing any file, preserving concurrent user edits.
for (const { path, raw } of writes) assert.equal(readFileSync(path, 'utf8'), raw, `${path}: changed during preparation`);
const write = process.argv.includes('--write');
for (const { path, updated, count } of writes) {
  if (write) writeFileSync(path, updated, 'utf8');
  console.log(`${write ? 'Added' : 'Planned'} ${count} texts: ${path}`);
}
console.log('Additions by level:', counts);
console.log(write ? 'Next: npm run validate and git diff --check' : 'Preview only. Pass --write to apply this batch.');
