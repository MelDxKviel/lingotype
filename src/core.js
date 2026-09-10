export const DAY = 86_400_000;
export const MAX_SAVED = 20;
export const MAX_REVIEWS = 14;
export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const BADGES = [
  { id: 'first', name: 'Первый шаг', description: 'Завершить первый текст', icon: 'sprout', test: s => s.total >= 1 },
  { id: 'perfect', name: 'Чистая работа', description: 'Напечатать текст без единой ошибки', icon: 'target', test: s => s.perfect >= 1 },
  { id: 'three', name: 'Вошло в привычку', description: 'Позаниматься три дня подряд', icon: 'flame', test: s => s.maxStreak >= 3 },
  { id: 'ten', name: 'Слово за словом', description: 'Завершить десять текстов', icon: 'type', test: s => s.total >= 10 },
  { id: 'collector', name: 'Находки в копилке', description: 'Сохранить пять выражений', icon: 'bookmark', test: s => s.saved.length >= 5 },
  { id: 'thousand', name: 'Тысяча касаний', description: 'Напечатать 1 000 символов в завершённых текстах', icon: 'award', test: s => s.characters >= 1000 },
];

export function localDay(date = new Date()) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
}

export function freshState() {
  return { v: 1, day: 0, daily: 0, total: 0, characters: 0, perfect: 0, streak: 0, maxStreak: 0, best: 0, badges: [], saved: [], reviews: [], prefs: { translation: true, keyboard: true, sound: true, level: 'A2', topic: 'all' } };
}

const boundedInt = (value, max = 9999999) => Number.isSafeInteger(value) && value >= 0 ? Math.min(max, value) : 0;
const safeId = value => typeof value === 'string' && /^[a-z0-9-]{1,48}$/.test(value);

export function sanitizeState(raw) {
  const clean = freshState();
  if (!raw || raw.v !== 1) return clean;
  for (const key of ['day', 'daily', 'total', 'characters', 'perfect', 'streak', 'maxStreak', 'best']) clean[key] = boundedInt(raw[key]);
  clean.saved = [...new Set(Array.isArray(raw.saved) ? raw.saved.filter(safeId) : [])].slice(0, MAX_SAVED);
  clean.badges = [...new Set(Array.isArray(raw.badges) ? raw.badges.filter(id => BADGES.some(b => b.id === id)) : [])];
  const seen = new Set();
  clean.reviews = (Array.isArray(raw.reviews) ? raw.reviews : []).filter(r => {
    if (!r || !safeId(r.id) || seen.has(r.id)) return false;
    seen.add(r.id); return true;
  }).slice(-MAX_REVIEWS).map(r => ({ id: r.id, due: boundedInt(r.due), box: boundedInt(r.box, 3) }));
  if (raw.prefs) {
    for (const key of ['translation', 'keyboard', 'sound']) if (typeof raw.prefs[key] === 'boolean') clean.prefs[key] = raw.prefs[key];
    if (LEVELS.includes(raw.prefs.level)) clean.prefs.level = raw.prefs.level;
    if (safeId(raw.prefs.topic)) clean.prefs.topic = raw.prefs.topic;
  }
  return clean;
}

export function awardBadges(state) {
  const unlocked = BADGES.filter(badge => !state.badges.includes(badge.id) && badge.test(state));
  state.badges.push(...unlocked.map(b => b.id));
  return unlocked;
}

export function completeLesson(state, result, day = localDay()) {
  if (!result.completed || result.attempts < result.length || result.accuracy < 0 || result.accuracy > 100) return [];
  const previousDay = state.day;
  if (previousDay !== day) {
    state.daily = 0;
    state.streak = previousDay === day - 1 ? state.streak + 1 : 1;
  }
  state.day = day;
  state.daily += 1;
  state.total += 1;
  state.characters += result.length;
  state.maxStreak = Math.max(state.maxStreak, state.streak);
  if (result.errors === 0) state.perfect += 1;
  if (result.accuracy >= 95 && result.elapsedMs >= 10000) state.best = Math.max(state.best, result.wpm);
  const existing = state.reviews.find(r => r.id === result.id);
  const early = existing && existing.due > day;
  const box = result.accuracy < 95 ? 0 : early ? existing.box : Math.min(3, (existing?.box ?? -1) + 1);
  const due = early && result.accuracy >= 95 ? existing.due : day + [1, 3, 7, 14][box];
  state.reviews = state.reviews.filter(r => r.id !== result.id);
  state.reviews.push({ id: result.id, due, box });
  state.reviews = state.reviews.slice(-MAX_REVIEWS);
  return awardBadges(state);
}

export function dueReviews(state, day = localDay()) {
  return state.reviews.filter(r => r.due <= day).sort((a, b) => a.due - b.due);
}

export function randomLesson(pool, visited, lastLessonId = null, random = Math.random) {
  if (!pool.length) return null;
  let unseen = pool.filter(lesson => !visited.has(lesson.id));
  if (!unseen.length) {
    // Reset only this pool: changing filters must not erase other topics' history.
    pool.forEach(lesson => visited.delete(lesson.id));
    unseen = pool;
  }
  let choices = unseen.filter(lesson => lesson.id !== lastLessonId);
  // The last unseen text may be the one just shown in the review mode.
  if (!choices.length) choices = pool.filter(lesson => lesson.id !== lastLessonId);
  if (!choices.length) choices = unseen;
  const lesson = choices[Math.floor(random() * choices.length)];
  visited.add(lesson.id);
  return lesson;
}

export function youglishUrl(phrase) {
  return `https://youglish.com/pronounce/${encodeURIComponent(phrase)}/english`;
}

export class TypingSession {
  constructor(lesson, clock = () => performance.now()) {
    this.lesson = lesson; this.clock = clock; this.typed = ''; this.attempts = 0; this.errors = 0;
    this.activeAt = null; this.lastKey = null; this.elapsed = 0; this.completed = false;
  }
  resume() { if (this.activeAt === null && !this.completed) this.activeAt = this.clock(); }
  pause() {
    if (this.activeAt !== null) {
      const end = this.lastKey === null ? this.clock() : Math.min(this.clock(), this.lastKey + 15000);
      this.elapsed += Math.max(0, end - this.activeAt); this.activeAt = null;
    }
  }
  get blocked() { return this.typed.length > 0 && this.typed.at(-1) !== this.lesson.text[this.typed.length - 1]; }
  type(char) {
    if (this.completed || this.blocked || char.length !== 1) return false;
    if (this.lastKey !== null && this.clock() - this.lastKey > 15000) this.pause();
    this.resume(); this.lastKey = this.clock(); this.attempts += 1;
    if (char !== this.lesson.text[this.typed.length]) this.errors += 1;
    this.typed += char;
    if (this.typed === this.lesson.text) { this.pause(); this.completed = true; }
    return true;
  }
  backspace() {
    if (this.completed || !this.typed.length) return;
    this.typed = this.typed.slice(0, -1);
  }
  metrics() {
    const running = this.activeAt === null ? 0 : Math.max(0, Math.min(this.clock(), (this.lastKey ?? this.clock()) + 15000) - this.activeAt);
    const elapsedMs = this.elapsed + running;
    const correct = [...this.typed].filter((char, i) => char === this.lesson.text[i]).length;
    return { id: this.lesson.id, completed: this.completed, length: this.lesson.text.length, attempts: this.attempts, errors: this.errors,
      accuracy: this.attempts ? Math.round((this.attempts - this.errors) / this.attempts * 100) : 100,
      wpm: elapsedMs >= 1000 ? Math.round(correct / 5 / (elapsedMs / 60000)) : 0, elapsedMs };
  }
}
