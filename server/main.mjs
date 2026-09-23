// 零依赖生产静态服务器：托管 Vite 构建产物 dist/
// 仅使用 Node.js 内置模块，无需任何外部账号或第三方服务。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    // 防目录穿越：规范化后必须仍在 DIST_DIR 内
    let pathname = decodeURIComponent(url.pathname);
    let filePath = normalize(join(DIST_DIR, pathname));
    if (!filePath.startsWith(DIST_DIR)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    let info;
    try {
      info = await stat(filePath);
      if (info.isDirectory()) filePath = join(filePath, 'index.html');
    } catch {
      // 未知路径回退到 index.html（SPA 友好）
      filePath = join(DIST_DIR, 'index.html');
    }

    const content = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(content);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`服务器内部错误：${err?.message ?? err}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`展馆水路检修隔离网页已启动： http://${HOST}:${PORT}`);
});
