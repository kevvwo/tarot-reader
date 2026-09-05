#!/usr/bin/env node
/**
 * Tarot Reader - static server plus a thin Ollama proxy.
 *
 * The browser cannot call ollama.com directly (it sends no CORS headers), and
 * the local Ollama daemon only accepts requests from localhost. Proxying both
 * the app and the model through one origin solves that, keeps the phone from
 * ever holding a key, and means the daemon needs no reconfiguring.
 *
 *   node server.js [--port 8000] [--ollama http://127.0.0.1:11434]
 */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const PORT = Number(argOf('--port', process.env.PORT || 8000));
const OLLAMA = (argOf('--ollama', process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'))
  .replace(/\/$/, '');
const ROOT = path.join(__dirname, 'app');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-cache', ...headers });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => {
      chunks.push(c);
      // Guard against a runaway upload filling memory.
      if (chunks.reduce((n, b) => n + b.length, 0) > 4 * 1024 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Pipe a request through to the Ollama daemon, streaming the response back. */
function proxy(req, res, targetPath, body) {
  const target = new URL(OLLAMA + targetPath);
  const options = {
    hostname: target.hostname,
    port: target.port || 80,
    path: target.pathname + target.search,
    method: req.method,
    headers: { 'content-type': 'application/json' },
  };
  if (body) options.headers['content-length'] = Buffer.byteLength(body);

  const upstream = http.request(options, (up) => {
    res.writeHead(up.statusCode || 502, {
      'content-type': up.headers['content-type'] || 'application/json',
      'cache-control': 'no-cache',
      // NDJSON must reach the client token by token, not in buffered lumps.
      'x-accel-buffering': 'no',
    });
    up.pipe(res);
  });

  upstream.on('error', (err) => {
    if (!res.headersSent) {
      send(res, 502, JSON.stringify({
        error: `Cannot reach Ollama at ${OLLAMA}. Is it running? (${err.code || err.message})`,
      }), { 'content-type': 'application/json' });
    } else {
      res.end();
    }
  });

  // If the browser gives up (user navigates away), stop generating.
  res.on('close', () => upstream.destroy());

  if (body) upstream.write(body);
  upstream.end();
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';

  const filePath = path.join(ROOT, rel);
  // Never serve outside app/.
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, 'index.html')) {
    return send(res, 403, 'Forbidden');
  }

  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) return send(res, 404, 'Not found');

    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': stat.size,
      'last-modified': stat.mtime.toUTCString(),
    };
    // The corpus is large and changes only when rebuilt; let the SW cache it.
    if (ext === '.json') headers['cache-control'] = 'no-cache, must-revalidate';
    // The scans are immutable — refetching 78 of them on every load is waste.
    if (ext === '.webp') headers['cache-control'] = 'public, max-age=604800';

    // Not send(): that injects its own Cache-Control, which would contradict
    // the one set above.
    if (req.method === 'HEAD') { res.writeHead(200, headers); return res.end(); }
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  } catch {
    send(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  // Parsing has to be guarded: a path Node cannot parse as a URL — "//" is
  // enough, and scanners send worse — throws out of this async handler as an
  // unhandled rejection, which takes the whole process down.
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return send(res, 400, 'Bad request');
  }
  const { pathname } = url;

  try {
    if (pathname === '/api/health') {
      return send(res, 200, JSON.stringify({ ok: true, ollama: OLLAMA }),
        { 'content-type': 'application/json' });
    }
    if (pathname === '/api/models' && req.method === 'GET') {
      return proxy(req, res, '/api/tags', null);
    }
    if (pathname === '/api/chat' && req.method === 'POST') {
      return proxy(req, res, '/api/chat', await readBody(req));
    }
    if (pathname.startsWith('/api/')) {
      return send(res, 404, JSON.stringify({ error: 'no such endpoint' }),
        { 'content-type': 'application/json' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'Method not allowed');
    }
    await serveStatic(req, res, pathname);
  } catch (err) {
    if (!res.headersSent) send(res, 500, String(err && err.message));
  }
});

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

function announce() {
  const lan = lanAddress();
  console.log(`\n  Tarot Reader`);
  console.log(`  ------------`);
  console.log(`  local     http://localhost:${PORT}`);
  if (lan) console.log(`  on phone  http://${lan}:${PORT}`);
  console.log(`  ollama    ${OLLAMA}\n`);
}

// '::' is the dual-stack wildcard: it accepts both native IPv6 (so
// "localhost" resolves and connects whichever family the browser tries
// first) and IPv4-mapped connections (so the phone, and 127.0.0.1, still
// work). Binding IPv4-only here is what leaves "localhost" unreachable on a
// machine where it resolves to ::1 before 127.0.0.1.
server.listen(PORT, '::', announce).on('error', (err) => {
  if (err.code !== 'EAFNOSUPPORT' && err.code !== 'EADDRNOTAVAIL') throw err;
  // No IPv6 stack available at all: fall back to plain IPv4.
  server.listen(PORT, '0.0.0.0', announce);
});
