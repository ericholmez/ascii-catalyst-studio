import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = resolve(process.argv.includes('--dist') ? 'dist' : '.');
const port = Number(process.env.ASCII_PORT || 4173);
const mime = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2' };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    relative = relative.replace(/^tools\/ascii-catalyst(?:\/|$)/, '');
    if (!relative) relative = 'index.html';
    if (!/^(index\.html|offline\.js|src\/)/.test(relative)) throw new Error('Unknown path');
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep)) throw new Error('Invalid path');
    const contentType = mime[file.split('.').pop()];
    if (!contentType) throw new Error('Unknown file type');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + port + '/'));
