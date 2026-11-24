import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';

const output = new URL('../dist/', import.meta.url);
const source = new URL('../src/', import.meta.url);
let html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const offline = await readFile(new URL('../offline.js', import.meta.url), 'utf8');
const repository = process.env.ASCII_REPOSITORY_URL;
if (repository) {
  const url = new URL(repository);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use a public HTTPS repository URL.');
  const value = url.href.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  html = html.replace('name="ascii-repository" content=""', 'name="ascii-repository" content="' + value + '"');
}

const hash = createHash('sha256').update(html).update(offline);
async function hashDirectory(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) {
      await hashDirectory(new URL(entry.name + '/', directory), path + '/');
    } else if (entry.isFile()) {
      hash.update(path + '\0').update(await readFile(new URL(entry.name, directory))).update('\0');
    }
  }
}
await hashDirectory(source);
const release = hash.digest('hex').slice(0, 16);
const assets = './assets/' + release + '/';
await mkdir(new URL('assets/', output), { recursive: true });
await Promise.all([
  cp(source, new URL(assets, output), { recursive: true }),
  cp(source, new URL('src/', output), { recursive: true }),
]);
await Promise.all([
  writeFile(new URL('index.html', output), html.replaceAll('"./src/', '"' + assets)),
  writeFile(new URL('offline.js', output), offline.replace("const ASSETS = './src/';", "const ASSETS = '" + assets + "';")),
]);
console.log('Built dist/ for static hosting with asset version ' + release + '.');
