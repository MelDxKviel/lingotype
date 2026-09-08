import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { LEVELS } from '../src/core.js';

const contentRoot = new URL('../content/', import.meta.url);
export async function validateContent() {
  const catalog = JSON.parse(await readFile(new URL('catalog.json', contentRoot), 'utf8'));
  const errors = [], ids = new Set(), phraseIds = new Set(), topicIds = new Set();
  let total = 0;
  const check = (condition, message) => { if (!condition) errors.push(message); };
  const nonempty = value => typeof value === 'string' && value.trim().length > 0;
  const validId = value => typeof value === 'string' && /^[a-z0-9-]{1,48}$/.test(value);
  check(Array.isArray(catalog.topics) && catalog.topics.length > 0, 'catalog.json: topics must be a nonempty array');
  for (const topic of catalog.topics || []) {
    check(validId(topic.id) && !topicIds.has(topic.id), `Invalid or duplicate topic ID: ${topic.id}`); topicIds.add(topic.id);
    check(nonempty(topic.title), `${topic.id}: missing title`);
    const validFile = typeof topic.file === 'string' && /^[a-z0-9-]+\.json$/.test(topic.file);
    check(validFile, `${topic.id}: file must be a JSON filename in content/`); if (!validFile) continue;
    const items = JSON.parse(await readFile(new URL(topic.file, contentRoot), 'utf8'));
    check(Array.isArray(items) && items.length > 0, `${topic.file}: expected nonempty array`);
    if (!Array.isArray(items)) continue;
    for (const lesson of items) {
      total += 1;
      const tag = `${topic.file} / ${lesson.id}`;
      check(validId(lesson.id) && !ids.has(lesson.id), `${tag}: invalid or duplicate lesson ID`); ids.add(lesson.id);
      check(LEVELS.includes(lesson.level), `${tag}: level must be one of ${LEVELS.join(', ')}`);
      for (const field of ['title', 'text', 'translation']) check(nonempty(lesson[field]), `${tag}: missing ${field}`);
      if (typeof lesson.text !== 'string') continue;
      check(/^[\x20-\x7E]+$/.test(lesson.text), `${tag}: text must use printable English ASCII (straight quotes)`);
      check(lesson.text.length >= 20 && lesson.text.length <= 240, `${tag}: text must be 20–240 characters`);
      check(lesson.text === lesson.text.trim() && !lesson.text.includes('  '), `${tag}: remove extra spaces`);
      check(Array.isArray(lesson.phrases) && lesson.phrases.length >= 1 && lesson.phrases.length <= 3, `${tag}: provide 1–3 phrases`);
      const ranges = [];
      for (const phrase of lesson.phrases || []) {
        check(validId(phrase.id) && !phraseIds.has(phrase.id), `${tag}: invalid or duplicate phrase ID ${phrase.id}`); phraseIds.add(phrase.id);
        for (const field of ['text', 'meaning', 'note', 'example']) check(nonempty(phrase[field]), `${tag} / ${phrase.id}: missing ${field}`);
        if (typeof phrase.text !== 'string' || !phrase.text.length) continue;
        const index = lesson.text.indexOf(phrase.text), end = index + phrase.text.length;
        check(index >= 0, `${tag}: phrase "${phrase.text}" is not an exact substring`);
        check(index >= 0 && lesson.text.indexOf(phrase.text, end) === -1, `${tag}: phrase must occur exactly once`);
        if (index >= 0) {
          check(index === 0 || !/[A-Za-z]/.test(lesson.text[index - 1]), `${tag}: phrase begins inside a word`);
          check(end === lesson.text.length || !/[A-Za-z]/.test(lesson.text[end]), `${tag}: phrase ends inside a word`);
          check(!ranges.some(r => index < r.end && end > r.start), `${tag}: phrase spans overlap`);
          ranges.push({ start: index, end });
        }
      }
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return { topics: topicIds.size, lessons: total, phrases: phraseIds.size };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log('Content valid:', await validateContent()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
