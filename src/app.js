import { TypingSession, BADGES, MAX_SAVED, awardBadges, completeLesson, dueReviews, freshState, localDay, randomLesson, youglishUrl } from './core.js';
import { loadState, saveState } from './storage.js';
import { icon, hydrateIcons } from './icons.js';
import { playKeySound, setSoundEnabled, prepareKeySound } from './sound.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let state = loadState();
let topics = [], lessons = [], phraseMap = new Map(), session = null;
let view = 'practice', mode = 'practice', allowEarlyReview = false, round = 0;
let positions = [], lastLessonId = null, toastTimer;
const keyAnimations = new Map();
const visited = new Set();
const reviewed = new Set();
const titles = {
  practice: ['Поймай свой ритм', 'Тренируй пальцы. Находи новые слова.'],
  phrases: ['Слова, которые с тобой', 'Сохраняй выражения. Возвращайся к ним в своём темпе.'],
  awards: ['Маленькие победы', 'Каждое занятие — ещё немного уверенности.'],
};

function persist() { $('#storage-warning').hidden = saveState(state); }
function focusTyping() {
  if (view === 'practice' && session && !session.completed && !document.querySelector('dialog[open]')) {
    $('#typing-input')?.focus({ preventScroll: true });
  }
}
function syncSound() {
  setSoundEnabled(state.prefs.sound);
  $('#sound-toggle').innerHTML = `${icon(state.prefs.sound ? 'volume' : 'muted')}<span>Звук</span>`;
  $('#sound-toggle').setAttribute('aria-pressed', state.prefs.sound);
  $('#sound-toggle').setAttribute('aria-label', state.prefs.sound ? 'Выключить звук клавиш' : 'Включить звук клавиш');
  $('#sound-toggle').title = state.prefs.sound ? 'Выключить звук клавиш' : 'Включить звук клавиш';
}
function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3800);
}
function wordForm(number, one, few, many) {
  const n = number % 100;
  return n >= 11 && n <= 14 ? many : number % 10 === 1 ? one : number % 10 >= 2 && number % 10 <= 4 ? few : many;
}
function updateProgress() {
  const daily = state.day === localDay() ? state.daily : 0;
  const streak = state.day >= localDay() - 1 ? state.streak : 0;
  $('#daily-count').textContent = `${Math.min(daily, 3)} / 3 текста`;
  $('#daily-fill').style.width = `${Math.min(daily / 3, 1) * 100}%`;
  $('#daily-description').textContent = daily >= 3 ? 'На сегодня уже отлично. Можно отдохнуть.' : 'Три текста — хорошее начало.';
  $('#streak-count').textContent = streak;
  $('#streak-label').textContent = `${wordForm(streak, 'день', 'дня', 'дней')} подряд`;
  $('#saved-count').textContent = state.saved.length;
  $('#review-count').textContent = dueReviews(state).filter(r => lessons.some(l => l.id === r.id)).length;
}
async function fetchJSON(path) {
  const response = await fetch(new URL(path, new URL('../content/', import.meta.url)));
  if (!response.ok) throw new Error(`Content ${response.status}`);
  return response.json();
}
async function boot() {
  try {
    const catalog = await fetchJSON('catalog.json'); topics = catalog.topics;
    const files = await Promise.all(topics.map(async topic => (await fetchJSON(topic.file)).map(lesson => ({ ...lesson, topic: topic.id, topicTitle: topic.title }))));
    lessons = files.flat();
    lessons.forEach(lesson => lesson.phrases.forEach(phrase => phraseMap.set(phrase.id, { ...phrase, lessonId: lesson.id })));
    state.saved = state.saved.filter(id => phraseMap.has(id));
    state.reviews = state.reviews.filter(r => lessons.some(l => l.id === r.id));
    // Avoid recent completed texts when starting a new visit, too.
    state.reviews.forEach(review => visited.add(review.id));
    if (!topics.some(topic => topic.id === state.prefs.topic)) state.prefs.topic = 'all';
    $('#topic-select').innerHTML = '<option value="all">Все темы</option>' + topics.map(topic => `<option value="${escape(topic.id)}">${escape(topic.title)}</option>`).join('');
    $('#topic-select').value = state.prefs.topic; $('#level-select').value = state.prefs.level;
    updateProgress(); renderKeyboard(); pickLesson(); persist(); focusTyping();
  } catch (error) {
    $('#practice-card').innerHTML = `<div class="empty-state">${icon('help')}<h2>Не удалось загрузить тексты</h2><p>Проверь соединение и попробуй ещё раз. Если открываешь проект на компьютере, запусти его через локальный сервер.</p><button id="retry-load" class="primary-button">Попробовать снова</button></div>`;
    $('#practice-card').setAttribute('aria-busy', 'false');
    $('#retry-load').addEventListener('click', boot);
    console.error('Lingotype: failed to load content', error);
  }
}
function showView(next) {
  session?.pause(); view = next;
  for (const id of ['practice', 'phrases', 'awards']) $(`#${id}-view`).hidden = id !== next;
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === next; button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  $('#page-title').innerHTML = `${titles[next][0]}<span>.</span>`;
  $('#page-description').textContent = titles[next][1];
  if (next === 'phrases') renderSaved(); if (next === 'awards') renderAwards(); updateProgress(); focusTyping();
}
function candidates() {
  if (mode === 'review') {
    const entries = allowEarlyReview ? [...state.reviews].sort((a, b) => a.due - b.due) : dueReviews(state);
    return entries.map(r => lessons.find(l => l.id === r.id)).filter(Boolean);
  }
  return lessons.filter(lesson => lesson.level === state.prefs.level && (state.prefs.topic === 'all' || lesson.topic === state.prefs.topic));
}
function pickLesson() {
  session?.pause(); const pool = candidates();
  if (!pool.length) { session = null; renderEmptyPractice(); return; }
  let lesson;
  if (mode === 'review') {
    let unseen = pool.filter(l => !reviewed.has(l.id));
    if (!unseen.length) { pool.forEach(l => reviewed.delete(l.id)); unseen = pool; }
    lesson = unseen.find(l => l.id !== lastLessonId) || unseen[0];
    reviewed.add(lesson.id);
  } else {
    lesson = randomLesson(pool, visited, lastLessonId);
  }
  session = new TypingSession(lesson); lastLessonId = lesson.id; round += 1;
  renderPractice(); updateKeyboard(); focusTyping();
}
function renderEmptyPractice() {
  const review = mode === 'review';
  const nextReview = [...state.reviews].sort((a, b) => a.due - b.due)[0];
  const waitDays = nextReview ? Math.max(1, nextReview.due - localDay()) : 0;
  $('#practice-card').innerHTML = `<div class="empty-state">${icon(review ? 'check' : 'type')}<h2>${review ? 'Сегодня всё свежее в памяти' : 'Здесь пока нет текстов'}</h2><p>${review ? nextReview ? `Следующее повторение через ${waitDays} ${wordForm(waitDays, 'день', 'дня', 'дней')}. Паузы между занятиями помогают запоминать надолго.` : 'Заверши первый текст. Завтра он появится здесь для повторения.' : 'Попробуй другой уровень или выбери все темы.'}</p><button id="empty-action" class="primary-button">${review && nextReview ? 'Повторить сейчас' : 'К практике'} ${icon('arrow-right')}</button></div>`;
  $('#practice-card').setAttribute('aria-busy', 'false'); $('#keyboard-section').hidden = true;
  $('#empty-action').addEventListener('click', () => {
    if (review && nextReview) { allowEarlyReview = true; pickLesson(); }
    else { state.prefs.topic = 'all'; $('#topic-select').value = 'all'; changeMode('practice'); persist(); }
  });
}
function renderCharacters(text, start = 0) {
  let index = start;
  return text.split(/( +)/).filter(Boolean).map(part => {
    const chars = [...part].map(char => `<span class="char${char === ' ' ? ' space' : ''}" data-pos="${index++}">${escape(char)}</span>`).join('');
    return part.trim() ? `<span class="word">${chars}</span>` : chars;
  }).join('');
}
function renderTarget(lesson) {
  const ranges = lesson.phrases.map(phrase => ({ phrase, start: lesson.text.indexOf(phrase.text) })).filter(r => r.start >= 0).sort((a, b) => a.start - b.start);
  let cursor = 0, html = '';
  for (const { phrase, start } of ranges) {
    html += renderCharacters(lesson.text.slice(cursor, start), cursor);
    html += `<button class="phrase-token" data-phrase="${escape(phrase.id)}" aria-label="Разобрать выражение: ${escape(phrase.text)}">${renderCharacters(phrase.text, start)}</button>`;
    cursor = start + phrase.text.length;
  }
  return html + renderCharacters(lesson.text.slice(cursor), cursor);
}
function renderPractice() {
  const lesson = session.lesson;
  $('#practice-card').setAttribute('aria-busy', 'false');
  $('#practice-card').innerHTML = `<div class="card-top"><div class="lesson-meta"><span class="lesson-number">${String(round).padStart(2, '0')}</span><span class="lesson-tag">${escape(lesson.topicTitle)}</span></div><div class="stats"><div class="stat wpm" title="Знаков в минуту, делённых на 5. Скорость короткого текста приблизительна."><strong id="live-wpm">—</strong><span>слов/мин</span></div><div class="stat"><strong id="live-accuracy">100<span>%</span></strong><span>точность</span></div></div></div>
    <div class="card-body"><div class="text-heading"><span class="text-title">${escape(lesson.title)}</span><span class="small-pill">${lesson.level} · ${mode === 'review' ? 'закрепляем' : 'случайный текст'}</span></div>
      <div class="typing-surface"><input id="typing-input" class="typing-capture" type="text" lang="en" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" inputmode="text" aria-label="Печатай английский текст. Ошибки исправляй Backspace." aria-describedby="target-text input-feedback" /><div id="target-text" class="target-text" lang="en" aria-label="Текст для печати">${renderTarget(lesson)}</div></div>
      <p id="translation" class="translation"${state.prefs.translation ? '' : ' hidden'}>${escape(lesson.translation)}</p>
      <p id="input-feedback" class="input-feedback" role="status"></p><span id="typing-status" class="sr-only" role="status"></span>
    </div><div class="card-bottom"><label class="toggle-label"><input id="translation-toggle" type="checkbox" role="switch"${state.prefs.translation ? ' checked' : ''} />Показывать перевод</label><div class="card-actions"><button id="restart-button" class="text-button" aria-label="Начать текст заново" title="Начать заново">${icon('restart')}<span>Заново</span></button><button id="next-button" class="next-button">Другой текст ${icon('arrow-right')}</button></div></div><div class="lesson-progress" role="progressbar" aria-label="Текст напечатан" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"><span id="lesson-fill"></span></div>`;
  hydrateIcons($('#practice-card'));
  positions = [...document.querySelectorAll('[data-pos]')]; positions[0]?.classList.add('current');
  const input = $('#typing-input');
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', event => {
    animatePhysicalKey(event);
    if (event.key === 'Backspace') { event.preventDefault(); if (session.typed.length) playKeySound(false, true); session.backspace(); paintTyping(); feedback(''); }
    if (event.key === 'Escape') { input.blur(); session.pause(); }
    if (event.getModifierState?.('CapsLock')) feedback('Включён Caps Lock. Проверь регистр букв.');
  });
  input.addEventListener('beforeinput', event => {
    if (event.inputType.startsWith('delete')) { event.preventDefault(); animateKey('Backspace'); if (session.typed.length) playKeySound(false, true); session.backspace(); paintTyping(); }
    if (['insertFromPaste', 'insertFromDrop', 'insertReplacementText'].includes(event.inputType)) { event.preventDefault(); feedback('Попробуй набрать текст самостоятельно.'); }
  });
  for (const name of ['paste', 'drop']) input.addEventListener(name, event => { event.preventDefault(); feedback('Здесь тренируются пальцы — набирай по одной букве.'); });
  input.addEventListener('blur', () => session?.pause());
  $('#target-text').addEventListener('click', event => { if (!event.target.closest('button')) input.focus(); });
  $('#translation-toggle').addEventListener('change', event => { state.prefs.translation = event.target.checked; $('#translation').hidden = !state.prefs.translation; persist(); });
  $('#restart-button').addEventListener('click', () => { session = new TypingSession(lesson); renderPractice(); updateKeyboard(); $('#typing-input').focus(); });
  $('#next-button').addEventListener('click', () => { pickLesson(); $('#typing-input')?.focus(); });
  $('#keyboard-section').hidden = false; syncKeyboardVisibility();
}
function feedback(message, isError = false) {
  const element = $('#input-feedback');
  if (element) { element.textContent = message; element.classList.toggle('error', isError); }
}
function onInput(event) {
  if (event.isComposing) return;
  const input = event.target, value = input.value; input.value = '';
  if (!session || session.completed || !value) return;
  if (/[а-яё]/i.test(value)) { feedback('Переключи раскладку на английскую (EN).', true); return; }
  if (value.length !== 1 || !/^[\x20-\x7E]$/.test(value)) { feedback('Набирай по одному символу в английской раскладке.'); return; }
  if (session.blocked) { feedback('Сначала исправь выделенную ошибку клавишей Backspace.', true); return; }
  session.type(value); animateKey(value); playKeySound(session.blocked); paintTyping();
  if (session.blocked) feedback('Небольшая опечатка. Нажми Backspace и попробуй ещё раз.', true);
  else feedback('');
  if (session.completed) finishLesson();
}
function paintTyping() {
  if (!session || !$('#target-text')) return;
  positions.forEach((element, index) => {
    const typed = session.typed[index];
    element.classList.toggle('correct', typed !== undefined && typed === session.lesson.text[index]);
    element.classList.toggle('wrong', typed !== undefined && typed !== session.lesson.text[index]);
    element.classList.toggle('current', index === session.typed.length);
  });
  const percent = Math.round(session.typed.length / session.lesson.text.length * 100);
  $('#lesson-fill').style.width = `${percent}%`; $('.lesson-progress').setAttribute('aria-valuenow', percent);
  $('#typing-status').textContent = session.blocked ? 'Ошибка. Исправь её клавишей Backspace.' : `Напечатано ${session.typed.length} из ${session.lesson.text.length} символов`;
  updateStats(); updateKeyboard();
}
function updateStats() {
  if (!session || !$('#live-wpm')) return;
  const stats = session.metrics(); $('#live-wpm').textContent = stats.elapsedMs >= 1000 ? stats.wpm : '—';
  $('#live-accuracy').innerHTML = `${stats.accuracy}<span>%</span>`;
}
function finishLesson() {
  const result = session.metrics(), unlocked = completeLesson(state, result);
  persist(); updateProgress();
  // The next exercise is ready immediately. No result screen or memory quiz.
  if (mode === 'review' && !allowEarlyReview && !dueReviews(state).length) changeMode('practice');
  else pickLesson();
  const speed = result.wpm ? ` · ~${result.wpm} слов/мин` : '';
  toast(`${result.errors === 0 ? 'Чисто!' : 'Текст готов'} ${result.accuracy}%${speed}${unlocked.length ? ` · ${unlocked.map(b => b.name).join(' + ')}` : ''}`);
  focusTyping();
}
function changeMode(next) {
  mode = next; allowEarlyReview = false;
  document.querySelectorAll('[data-mode]').forEach(button => { const selected = button.dataset.mode === next; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected); });
  $('#topic-select').disabled = next === 'review'; $('#level-select').disabled = next === 'review'; pickLesson();
}
function renderKeyboard() {
  const rows = [
    ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace'],
    ['Tab', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
    ['Caps', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'", 'Enter'],
    ['ShiftLeft', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', 'ShiftRight'], [' '],
  ];
  $('#keyboard').innerHTML = `<div class="keyboard-hand-labels"><span>ЛЕВАЯ РУКА</span><span>ПРАВАЯ РУКА</span></div>` + rows.map((row, index) => `<div class="key-row${index === 2 ? ' key-home-row' : ''}">${row.map(key => `<span class="key finger-${fingerZone(key)}${key.length > 1 ? ' wide' : ''}${key.startsWith('Shift') ? ' shift' : ''}${key === ' ' ? ' spacebar' : ''}${['f', 'j'].includes(key) ? ' home' : ''}" data-key="${escape(key)}">${key.startsWith('Shift') ? 'shift' : key === 'Backspace' ? '⌫' : key === 'Enter' ? 'enter' : key === ' ' ? 'space' : escape(key)}</span>`).join('')}</div>`).join('') + `<div class="finger-legend"><span><i class="finger-pinky"></i>Мизинец</span><span><i class="finger-ring"></i>Безымянный</span><span><i class="finger-middle"></i>Средний</span><span><i class="finger-index"></i>Указательный</span><span><i class="finger-thumb"></i>Большой</span></div>`;
  syncKeyboardVisibility();
}
function fingerZone(key) {
  if (key === ' ') return 'thumb';
  if ('45rtfgvb67yuhjnm'.includes(key)) return 'index';
  if ('3edc8ik,'.includes(key)) return 'middle';
  if ('2wsx9ol.'.includes(key)) return 'ring';
  return 'pinky';
}
function animateKey(char) {
  const shiftMap = { '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/' };
  const name = char.length === 1 ? shiftMap[char] || char.toLowerCase() : char;
  const key = [...document.querySelectorAll('[data-key]')].find(el => el.dataset.key === name);
  if (!key || !state.prefs.keyboard) return;
  clearTimeout(keyAnimations.get(name));
  key.classList.add('pressed');
  keyAnimations.set(name, setTimeout(() => { key.classList.remove('pressed'); keyAnimations.delete(name); }, 140));
}
function animatePhysicalKey(event) {
  const codeMap = { ShiftLeft: 'ShiftLeft', ShiftRight: 'ShiftRight', Space: ' ', Backspace: 'Backspace', Enter: 'Enter', Tab: 'Tab', CapsLock: 'Caps' };
  animateKey(codeMap[event.code] || event.key);
}
function syncKeyboardVisibility() {
  $('#keyboard').hidden = !state.prefs.keyboard;
  $('#keyboard-toggle').textContent = state.prefs.keyboard ? 'Скрыть клавиатуру' : 'Показать клавиатуру';
  $('#keyboard-toggle').setAttribute('aria-expanded', state.prefs.keyboard);
}
function updateKeyboard() {
  document.querySelectorAll('.key.active').forEach(key => key.classList.remove('active'));
  if (!session || session.completed) return;
  const char = session.blocked ? 'Backspace' : session.lesson.text[session.typed.length]; if (!char) return;
  const shifted = { '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/' };
  const key = char === 'Backspace' ? char : shifted[char] || char.toLowerCase();
  const fingers = [ ['`1qaz', 'Мизинец левой руки'], ['2wsx', 'Безымянный палец левой руки'], ['3edc', 'Средний палец левой руки'], ['45rtfgvb', 'Указательный палец левой руки'], ['67yuhjnm', 'Указательный палец правой руки'], ['8ik,', 'Средний палец правой руки'], ['9ol.', 'Безымянный палец правой руки'], ["0p;/-=[]'\\", 'Мизинец правой руки'] ];
  const fingerIndex = fingers.findIndex(([keys]) => keys.includes(key));
  const needsShift = Boolean(shifted[char]) || /^[A-Z]$/.test(char), active = [key];
  if (needsShift) active.push(fingerIndex < 4 ? 'ShiftRight' : 'ShiftLeft');
  document.querySelectorAll('[data-key]').forEach(el => el.classList.toggle('active', active.includes(el.dataset.key)));
  $('#finger-hint').textContent = char === 'Backspace' ? 'Исправь опечатку клавишей Backspace' : char === ' ' ? 'Пробел — любой большой палец' : `${fingers[fingerIndex]?.[1] || 'Верни пальцы на F и J'}${needsShift ? ' + Shift другой рукой' : ''}`;
}
function openPhrase(id) {
  const phrase = phraseMap.get(id); if (!phrase) return; session?.pause();
  const saved = state.saved.includes(id);
  $('#phrase-dialog').innerHTML = `<div class="dialog-top"><span class="dialog-eyebrow">АНГЛИЙСКИЙ В ЖИЗНИ</span><button class="dialog-close" data-close="phrase-dialog" aria-label="Закрыть">${icon('close')}</button></div><h2 id="phrase-title" lang="en">${escape(phrase.text)}</h2><p class="phrase-meaning">${escape(phrase.meaning)}</p><p class="phrase-explanation">${escape(phrase.note)}</p><blockquote class="phrase-example" lang="en">${escape(phrase.example)}</blockquote><a class="youglish-link" href="${escape(youglishUrl(phrase.text))}" target="_blank" rel="noopener noreferrer">${icon('play')}Услышать в живой речи ${icon('external')}</a><p class="link-note">YouGlish откроет примеры из видео в новой вкладке.</p><button id="save-phrase" class="save-phrase" aria-pressed="${saved}">${icon(saved ? 'check' : 'bookmark')}${saved ? 'Сохранено в моих фразах' : 'Сохранить выражение'}</button>`;
  $('#save-phrase').addEventListener('click', () => {
    if (!toggleSaved(id)) return; const nowSaved = state.saved.includes(id);
    $('#save-phrase').innerHTML = `${icon(nowSaved ? 'check' : 'bookmark')}${nowSaved ? 'Сохранено в моих фразах' : 'Сохранить выражение'}`;
    $('#save-phrase').setAttribute('aria-pressed', nowSaved);
  });
  if (!$('#phrase-dialog').open) $('#phrase-dialog').showModal();
}
function toggleSaved(id) {
  if (state.saved.includes(id)) state.saved = state.saved.filter(saved => saved !== id);
  else {
    if (state.saved.length >= MAX_SAVED) { toast(`В копилке место для ${MAX_SAVED} фраз. Удали одну, чтобы добавить новую.`); return false; }
    state.saved.push(id); toast('Выражение в твоей копилке');
  }
  const unlocked = awardBadges(state); if (unlocked.length) toast(`Новая награда: ${unlocked[0].name}`);
  persist(); updateProgress(); if (view === 'phrases') renderSaved(); return true;
}
function renderSaved() {
  const saved = state.saved.map(id => phraseMap.get(id)).filter(Boolean);
  $('#phrases-view').innerHTML = saved.length ? `<p class="section-intro">${saved.length} из ${MAX_SAVED} выражений в копилке. Вспомни перевод, прежде чем открывать разбор.</p><div class="phrase-grid">${saved.map(phrase => `<article class="phrase-card"><div class="phrase-card-top"><h2 lang="en">${escape(phrase.text)}</h2><button class="icon-button" data-remove="${escape(phrase.id)}" aria-label="Убрать ${escape(phrase.text)} из сохранённых">${icon('bookmark')}</button></div><p lang="en">${escape(phrase.example)}</p><button class="text-button" data-phrase="${escape(phrase.id)}">Вспомнить значение ${icon('arrow-right')}</button></article>`).join('')}</div>` : `<div class="practice-card empty-state">${icon('bookmark')}<h2>Твоя копилка выражений</h2><p>Нажми на подчёркнутую фразу в тексте и сохрани её. Здесь будут твои небольшие языковые открытия.</p><button class="primary-button" data-go-practice>Найти первое выражение ${icon('arrow-right')}</button></div>`;
}
function renderAwards() {
  $('#awards-view').innerHTML = `<div class="progress-summary"><div class="summary-card"><strong>${state.total}</strong><span>${wordForm(state.total, 'текст завершён', 'текста завершено', 'текстов завершено')}</span></div><div class="summary-card"><strong>${state.best || '—'}</strong><span>лучший темп, слов/мин</span></div><div class="summary-card"><strong>${state.badges.length} / ${BADGES.length}</strong><span>маленьких побед</span></div></div><p class="section-intro">Награды за внимание и регулярность. Лучший темп учитывается при точности от 95% и времени печати от 10 секунд.</p><div class="award-grid">${BADGES.map(badge => `<article class="award-card${state.badges.includes(badge.id) ? ' earned' : ''}"><div class="award-symbol">${icon(badge.icon)}</div><div><h2>${badge.name}</h2><p>${badge.description}</p><span class="award-status">${state.badges.includes(badge.id) ? 'Получено · так держать' : 'Всё ещё впереди'}</span></div></article>`).join('')}</div>`;
}
function openInfo(kind) {
  session?.pause(); const storage = kind === 'storage';
  $('#info-dialog').innerHTML = `<div class="dialog-top"><span class="dialog-eyebrow">${storage ? 'ТВОИ ДАННЫЕ' : 'ПРАКТИКА БЕЗ СПЕШКИ'}</span><button class="dialog-close" data-close="info-dialog" aria-label="Закрыть">${icon('close')}</button></div><h2 id="info-title">${storage ? 'Только в этом браузере' : 'Два навыка, понемногу'}</h2>${storage ? `<p>Результаты, награды, до ${MAX_SAVED} фраз и последние 14 текстов для повторения хранятся в небольшом cookie на год с последнего сохранения. Аккаунт не нужен.</p><p>На другом устройстве прогресс будет отдельным. Очистка cookies или закрытие приватного окна может удалить его.</p><p>У приложения нет аналитики. Шрифты загружаются с Google Fonts, а YouGlish открывается только по твоему клику.</p><button id="reset-progress" class="danger-button">Сбросить мой прогресс</button>` : `<ol><li><strong>Сначала точность.</strong> Поставь пальцы на A S D F и J K L ;. Найди выступы на F и J. Смотри на текст, а не на руки. Экранная клавиатура подскажет палец.</li><li><strong>Коротко, но регулярно.</strong> Начни с 3 текстов в день. A1–B1 — повседневный английский; B2–C2 — более сложные конструкции и оттенки смысла. Уставшим рукам дай отдохнуть.</li><li><strong>Замечай выражения.</strong> Нажми на подчёркнутые слова, прочитай разбор и послушай их на YouGlish. Придумай собственный пример.</li><li><strong>Вспоминай без подсказки.</strong> По желанию скрывай перевод. В копилке сначала вспоминай значение выражения, затем открывай разбор.</li><li><strong>Возвращайся через паузу.</strong> В практике тексты выбираются случайно, без повторов за круг. Для знакомых текстов открой «Повторение»: они будут готовы через 1, 3, 7 и 14 дней. Между текстами ничего нажимать не нужно.</li></ol><p>Опечатка подсвечивается: исправь её Backspace. Паузы при уходе со страницы и чтении разбора не снижают темп. После 15 секунд без ввода отсчёт приостанавливается.</p><p class="source-links">О методике: <a href="https://www.typing.com/blog/typing-accuracy/" target="_blank" rel="noopener noreferrer">точность печати</a> · <a href="https://www.retrievalpractice.org/retrievalpractice/" target="_blank" rel="noopener noreferrer">активное вспоминание</a> · <a href="https://www.retrievalpractice.org/spacing/" target="_blank" rel="noopener noreferrer">практика с интервалами</a></p>`}`;
  if (storage) $('#reset-progress').addEventListener('click', () => {
    $('#info-dialog').innerHTML = `<div class="dialog-top"><span class="dialog-eyebrow">НАЧАТЬ С ЧИСТОГО ЛИСТА</span><button class="dialog-close" data-close="info-dialog" aria-label="Закрыть">${icon('close')}</button></div><h2 id="info-title">Сбросить прогресс?</h2><p>Сохранённые фразы, награды и результаты будут удалены из этого браузера. Настройки останутся.</p><div class="result-actions"><button class="secondary-button" data-close="info-dialog">Оставить</button><button id="confirm-reset" class="danger-button">Да, сбросить</button></div>`;
    $('#confirm-reset').addEventListener('click', () => {
      const prefs = state.prefs; state = freshState(); state.prefs = prefs; visited.clear(); reviewed.clear(); persist(); updateProgress();
      if (view === 'awards') renderAwards(); if (view === 'phrases') renderSaved();
      changeMode('practice'); $('#info-dialog').close(); toast('Можно начать с чистого листа');
    });
  });
  $('#info-dialog').showModal();
}

hydrateIcons();
void prepareKeySound();
const soundToggle = document.createElement('button');
soundToggle.id = 'sound-toggle'; soundToggle.className = 'sound-toggle';
$('.filters').append(soundToggle); syncSound();
soundToggle.addEventListener('click', () => {
  state.prefs.sound = !state.prefs.sound; syncSound(); persist();
  if (state.prefs.sound) playKeySound();
  focusTyping();
});
// Typing can resume after clicking empty space. Native controls keep their keys.
document.addEventListener('keydown', event => {
  if (view !== 'practice' || !session || session.completed || document.querySelector('dialog[open]') || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
  if (event.target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
  if (event.key.length === 1 || event.key === 'Backspace') {
    animatePhysicalKey(event);
    event.preventDefault(); focusTyping();
    if (event.key === 'Backspace') {
      if (session.typed.length) playKeySound(false, true);
      session.backspace(); paintTyping();
    } else {
      const input = $('#typing-input'); if (input) { input.value = event.key; onInput({ target: input }); }
    }
  }
});
document.addEventListener('click', event => {
  const phrase = event.target.closest('[data-phrase]'); if (phrase) openPhrase(phrase.dataset.phrase);
  const close = event.target.closest('[data-close]'); if (close) $(`#${close.dataset.close}`).close();
  const remove = event.target.closest('[data-remove]'); if (remove) toggleSaved(remove.dataset.remove);
  if (event.target.closest('[data-go-practice]')) showView('practice');
});
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => changeMode(button.dataset.mode)));
for (const kind of ['topic', 'level']) $(`#${kind}-select`).addEventListener('change', event => { state.prefs[kind] = event.target.value; persist(); pickLesson(); });
$('#keyboard-toggle').addEventListener('click', () => { state.prefs.keyboard = !state.prefs.keyboard; syncKeyboardVisibility(); persist(); });
$('#how-button').addEventListener('click', () => openInfo('how')); $('#storage-button').addEventListener('click', () => openInfo('storage'));
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => {
  if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); }
});
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => queueMicrotask(focusTyping));
document.addEventListener('visibilitychange', () => { if (document.hidden) session?.pause(); else updateProgress(); });
window.addEventListener('blur', () => session?.pause());
setInterval(() => { if (!document.hidden && view === 'practice') updateStats(); }, 500);
boot();
