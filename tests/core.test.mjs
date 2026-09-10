import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LEVELS } from '../src/core.js';
import { TypingSession, freshState, sanitizeState, completeLesson, dueReviews, localDay, MAX_REVIEWS, MAX_SAVED, youglishUrl, awardBadges, scheduledPracticeReview } from '../src/core.js';
import { validateContent } from '../scripts/validate-content.mjs';

const lesson = { id: 'test-01', text: 'Hello world.' };
const result = (overrides = {}) => ({ id: 'test-01', completed: true, length: 100, attempts: 100, errors: 0, accuracy: 100, elapsedMs: 20000, wpm: 60, ...overrides });

test('all lesson content has valid IDs, phrases and typeable text', async () => {
  const report = await validateContent();
  assert.ok(report.lessons >= 36); assert.ok(report.phrases >= 36);
});
test('a completed accurate lesson measures standard five-character WPM', () => {
  let time = 0; const session = new TypingSession(lesson, () => time);
  for (const char of lesson.text) { session.type(char); time += 1000; }
  assert.equal(session.completed, true); assert.equal(session.metrics().accuracy, 100);
  assert.equal(session.metrics().elapsedMs, 11000); assert.equal(session.metrics().wpm, 13);
  assert.equal(session.type('!'), false); session.backspace(); assert.equal(session.typed, lesson.text);
});
test('errors require correction and still affect accuracy after Backspace', () => {
  let time = 0; const session = new TypingSession(lesson, () => time);
  session.type('x'); time += 1000;
  assert.equal(session.blocked, true); assert.equal(session.type('H'), false); assert.equal(session.attempts, 1);
  session.backspace(); assert.equal(session.blocked, false);
  for (const char of lesson.text) { session.type(char); time += 1000; }
  assert.equal(session.metrics().errors, 1); assert.equal(session.metrics().accuracy, 92);
  assert.equal(session.completed, true);
});
test('wrong punctuation and case count as errors; no paste-sized input', () => {
  const session = new TypingSession(lesson); assert.equal(session.type('Hello'), false);
  session.type('h'); assert.equal(session.blocked, true); assert.equal(session.metrics().errors, 1);
});
test('leaving the input excludes time spent reading phrase explanations', () => {
  let time = 0; const session = new TypingSession(lesson, () => time);
  session.type('H'); time = 1000; session.pause(); time = 60000; session.type('e'); time += 1000;
  assert.equal(session.metrics().elapsedMs, 2000);
});
test('idle time stops after 15 seconds and typing resumes cleanly', () => {
  let time = 0; const session = new TypingSession(lesson, () => time);
  session.type('H'); time = 120000; assert.equal(session.metrics().elapsedMs, 15000);
  session.type('e'); time += 1000; assert.equal(session.metrics().elapsedMs, 16000);
});
test('first completion earns badges only once and schedules tomorrow', () => {
  const state = freshState();
  const unlocked = completeLesson(state, result(), 100);
  assert.deepEqual(unlocked.map(b => b.id), ['first', 'perfect']); assert.equal(state.streak, 1);
  assert.deepEqual(state.reviews, [{ id: 'test-01', due: 101, box: 0 }]);
  assert.equal(completeLesson(state, result(), 100).length, 0); assert.equal(state.streak, 1); assert.equal(state.daily, 2);
});
test('consecutive local days increase streak; a missed day resets it', () => {
  const state = freshState();
  for (const day of [100, 101, 102]) completeLesson(state, result(), day);
  assert.equal(state.streak, 3); assert.ok(state.badges.includes('three')); assert.equal(state.daily, 1);
  completeLesson(state, result(), 104); assert.equal(state.streak, 1); assert.equal(state.maxStreak, 3);
});
test('review intervals grow after successful scheduled practice and reset after difficulty', () => {
  const state = freshState(); completeLesson(state, result(), 100); completeLesson(state, result(), 101);
  assert.equal(state.reviews[0].due, 104); assert.equal(state.reviews[0].box, 1);
  assert.equal(dueReviews(state, 103).length, 0); assert.equal(dueReviews(state, 104).length, 1);
  completeLesson(state, result({ accuracy: 90, errors: 10, attempts: 110 }), 104);
  assert.deepEqual(state.reviews[0], { id: 'test-01', due: 105, box: 0 });
});
test('incomplete text never earns progress', () => {
  const state = freshState(); completeLesson(state, result({ completed: false }), 100);
  assert.equal(state.total, 0); assert.equal(state.reviews.length, 0);
});
test('opening practice or skipping texts never triggers automatic reviews', () => {
  const state = freshState();
  state.reviews = [{ id: 'day-18', due: 0, box: 0 }, { id: 'day-19', due: 0, box: 0 }];
  const pool = [...state.reviews.map(({ id }) => ({ id })), { id: 'new-text' }];
  assert.equal(scheduledPracticeReview(state, pool), null);
  assert.equal(scheduledPracticeReview(state, pool, { afterCompletion: true }), null);
  for (const completedThisVisit of [0, 3, 6]) {
    for (const lastLessonId of ['day-18', 'day-19']) {
      assert.equal(scheduledPracticeReview(state, pool, {
        completedThisVisit, lastLessonId, retryQueue: [{ id: 'day-18', after: 0 }],
      }), null);
    }
  }
});

test('scheduled practice reviews appear only after every third completion and respect the pool', () => {
  const state = freshState();
  state.reviews = [
    { id: 'other-level', due: 0, box: 0 }, { id: 'previous', due: 0, box: 0 },
    { id: 'due', due: 0, box: 0 }, { id: 'future', due: localDay() + 1, box: 0 },
  ];
  const pool = [{ id: 'previous' }, { id: 'due' }, { id: 'future' }, { id: 'new-text' }];
  for (const completedThisVisit of [1, 2, 3, 4, 5, 6]) {
    const review = scheduledPracticeReview(state, pool, { afterCompletion: true, completedThisVisit, lastLessonId: 'previous' });
    assert.equal(review?.id ?? null, completedThisVisit % 3 === 0 ? 'due' : null);
  }
  assert.equal(scheduledPracticeReview(state, [{ id: 'future' }], { afterCompletion: true, completedThisVisit: 3 }), null);
});

test('difficult texts retry after two other completions, take priority and respect the pool', () => {
  const state = freshState();
  state.reviews = [{ id: 'due', due: 0, box: 0 }];
  const pool = [{ id: 'due' }, { id: 'difficult' }];
  const retryQueue = [{ id: 'outside-pool', after: 0 }, { id: 'difficult', after: 3 }];
  const options = { afterCompletion: true, retryQueue };
  assert.equal(scheduledPracticeReview(state, pool, { ...options, completedThisVisit: 2 }), null);
  assert.equal(scheduledPracticeReview(state, pool, { ...options, completedThisVisit: 3 }).id, 'difficult');
  assert.equal(scheduledPracticeReview(state, pool, { ...options, completedThisVisit: 4 }).id, 'difficult');
  assert.equal(scheduledPracticeReview(state, pool, { ...options, completedThisVisit: 4, lastLessonId: 'difficult' }), null);
  assert.equal(scheduledPracticeReview(state, [{ id: 'due' }], { ...options, completedThisVisit: 4 }), null);
});

test('repeating early does not skip ahead through spaced repetition intervals', () => {
  const state = freshState(); completeLesson(state, result(), 100);
  for (let i = 0; i < 5; i++) completeLesson(state, result(), 100);
  assert.deepEqual(state.reviews[0], { id: 'test-01', due: 101, box: 0 });
});
test('sound defaults on and a saved mute preference survives validation', () => {
  assert.equal(freshState().prefs.sound, true);
  const state = freshState(); state.prefs.sound = false;
  assert.equal(sanitizeState(state).prefs.sound, false);
});
test('best speed ignores inaccurate or extremely short sessions', () => {
  const state = freshState(); completeLesson(state, result({ accuracy: 90, wpm: 300 }), 100);
  assert.equal(state.best, 0); completeLesson(state, result({ elapsedMs: 1000, wpm: 600 }), 100);
  assert.equal(state.best, 0); completeLesson(state, result(), 100); assert.equal(state.best, 60);
});
test('cookie-bound collections stay bounded and newest reviews are retained', () => {
  const state = freshState();
  for (let i = 0; i < 80; i++) completeLesson(state, result({ id: `test-${i}` }), 100);
  assert.equal(state.reviews.length, MAX_REVIEWS); assert.equal(state.reviews.at(-1).id, 'test-79');
  const raw = { ...state, saved: Array.from({ length: 80 }, (_, i) => `phrase-${i}`) };
  assert.equal(sanitizeState(raw).saved.length, MAX_SAVED);
});
test('corrupt cookie objects cannot add arbitrary state or invalid preferences', () => {
  assert.deepEqual(sanitizeState(null), freshState()); assert.deepEqual(sanitizeState({ v: 2 }), freshState());
  const state = sanitizeState({ v: 1, total: -1, day: 'yesterday', saved: ['ok', 'ok', '<script>'], reviews: [null, { id: 'a', due: -1, box: 999 }], prefs: { level: 'C9', translation: 'false' } });
  assert.equal(state.total, 0); assert.deepEqual(state.saved, ['ok']); assert.equal(state.prefs.translation, true);
  assert.equal(state.prefs.level, 'A2'); assert.deepEqual(state.reviews, [{ id: 'a', due: 0, box: 3 }]);
});
test('saving five phrases awards a permanent collection badge', () => {
  const state = freshState(); state.saved = ['one', 'two', 'three', 'four', 'five'];
  assert.equal(awardBadges(state)[0].id, 'collector'); state.saved = []; assert.ok(state.badges.includes('collector'));
});
test('local date uses calendar days, including month and year boundaries', () => {
  assert.equal(localDay(new Date(2026, 0, 1)) - localDay(new Date(2025, 11, 31)), 1);
  assert.equal(localDay(new Date(2026, 8, 8, 0)), localDay(new Date(2026, 8, 8, 23)));
});
test('YouGlish phrase is safely encoded in its URL', () => {
  assert.equal(youglishUrl('take my time'), 'https://youglish.com/pronounce/take%20my%20time/english');
  assert.ok(youglishUrl('a/b?c').includes('a%2Fb%3Fc'));
});
test('advanced levels survive a cookie round-trip', () => {
  for (const level of LEVELS) {
    const state = freshState(); state.prefs.level = level;
    assert.equal(sanitizeState(JSON.parse(JSON.stringify(state))).prefs.level, level);
  }
});
test('every topic offers texts at all six levels, including IT and cinema', async () => {
  const catalog = JSON.parse(await readFile(new URL('../content/catalog.json', import.meta.url), 'utf8'));
  for (const required of ['it', 'cinema']) assert.ok(catalog.topics.some(t => t.id === required));
  for (const topic of catalog.topics) {
    const lessons = JSON.parse(await readFile(new URL(`../content/${topic.file}`, import.meta.url), 'utf8'));
    for (const level of LEVELS) assert.ok(lessons.some(l => l.level === level), `${topic.id} has no ${level} text`);
  }
});
test('typewriter sample is a short PCM WAV with no clipping', async () => {
  const wav = await readFile(new URL('../assets/audio/typewriter-key.wav', import.meta.url));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(20), 1); assert.equal(wav.readUInt16LE(22), 1); assert.equal(wav.readUInt16LE(34), 16);
  const duration = wav.readUInt32LE(40) / wav.readUInt32LE(28);
  assert.ok(duration > 0.1 && duration < 0.2);
  let peak = 0;
  for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
  assert.ok(peak > 1000 && peak < 22000);
  assert.equal(wav.readInt16LE(44), 0); assert.equal(wav.readInt16LE(wav.length - 2), 0);
});
