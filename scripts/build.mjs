import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

const output = new URL('../dist/', import.meta.url);
await mkdir(output, { recursive: true });
await Promise.all(
  ['index.html', 'src', 'offline.js'].map((path) =>
    cp(new URL('../' + path, import.meta.url), new URL(path, output), { recursive: true }))
);
const repository = process.env.ASCII_REPOSITORY_URL;
if (repository) {
  const url = new URL(repository);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use a public HTTPS repository URL.');
  const html = new URL('index.html', output);
  const source = await readFile(html, 'utf8');
  const value = url.href.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  await writeFile(html, source.replace('name="ascii-repository" content=""', 'name="ascii-repository" content="' + value + '"'));
}
console.log('Built dist/ for static hosting.');
