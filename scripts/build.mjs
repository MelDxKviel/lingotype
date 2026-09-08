import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { validateContent } from './validate-content.mjs';

console.log('Content valid:', await validateContent());
const output = resolve('dist');
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'styles.css', 'favicon.svg', '.nojekyll', 'src', 'assets']) {
  await cp(resolve(file), join(output, file), { recursive: true });
}
await mkdir(join(output, 'content'), { recursive: true });
for (const file of await readdir('content')) {
  if (file.endsWith('.json') && file !== 'lesson.schema.json') await cp(resolve('content', file), join(output, 'content', file));
}
const bytes = async dir => (await Promise.all((await readdir(dir, { withFileTypes: true })).map(async file => file.isDirectory() ? bytes(join(dir, file.name)) : (await stat(join(dir, file.name))).size))).reduce((sum, size) => sum + size, 0);
console.log(`Built dist/ (${Math.round(await bytes(output) / 1024)} KB). Static files, no runtime dependencies.`);
