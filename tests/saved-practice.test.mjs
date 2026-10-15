import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/core.js';

const lessons = [
  { id: 'daily-01', level: 'A1', topic: 'daily', phrases: [{ id: 'daily-01-a' }, { id: 'daily-01-b' }] },
  { id: 'work-01', level: 'C1', topic: 'work', phrases: [{ id: 'work-01-a' }] },
  { id: 'daily-02', level: 'A1', topic: 'daily', phrases: [{ id: 'daily-02-a' }] },
];

test('saved practice includes whole source lessons across topics and levels only once', () => {
  const saved = ['work-01-a', 'daily-01-b', 'daily-01-a', 'work-01-a'];
  const pool = core.savedLessons(lessons, saved);
  assert.deepEqual(pool.map(lesson => lesson.id), ['daily-01', 'work-01']);
  assert.equal(pool[0], lessons[0]);
  assert.deepEqual(saved, ['work-01-a', 'daily-01-b', 'daily-01-a', 'work-01-a']);
  assert.equal(lessons.length, 3);
});

test('an empty or stale collection offers no unrelated lessons and removals update the pool', () => {
  assert.deepEqual(core.savedLessons(lessons, []), []);
  assert.deepEqual(core.savedLessons(lessons, ['missing-phrase', 'daily-01']), []);
  assert.deepEqual(core.savedLessons(lessons, ['missing-phrase', 'work-01-a']).map(lesson => lesson.id), ['work-01']);
  assert.deepEqual(core.savedLessons(lessons, ['daily-01-b']).map(lesson => lesson.id), ['daily-01']);
});

test('saved practice cycles through source texts without duplicates or consecutive repeats', () => {
  const pool = core.savedLessons(lessons, ['daily-01-a', 'daily-01-b', 'work-01-a']);
  const visited = new Set();
  let previous = null;
  const picked = [];
  for (let i = 0; i < 4; i++) {
    const next = core.randomLesson(pool, visited, previous, () => 0).id;
    picked.push(next); previous = next;
  }
  assert.deepEqual(picked, ['daily-01', 'work-01', 'daily-01', 'work-01']);
});
