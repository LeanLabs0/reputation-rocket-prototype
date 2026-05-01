const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

loadDotEnv(path.join(__dirname, '.env.local'));

const agentHandler = require('./api/agent');
const notifyHandler = require('./api/notify');

const PORT = Number(process.env.PORT || 8888);
const ROOT = __dirname;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/api/agent') {
      return callApiHandler(agentHandler, req, res);
    }

    if (url.pathname === '/api/notify') {
      return callApiHandler(notifyHandler, req, res);
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Local dev server error', message: error.message }));
  }
});

server.listen(PORT, () => {
  console.log(`Reputation Rocket local dev server running at http://localhost:${PORT}`);
  console.log(`Try: http://localhost:${PORT}/lean-labs/?name=Edward+Test&email=edward@leanlabs.com`);
});

async function callApiHandler(handler, req, nodeRes) {
  req.body = await readJsonBody(req);

  const res = {
    statusCode: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.setHeader('Content-Type', 'application/json');
      nodeRes.writeHead(this.statusCode, this.headers);
      nodeRes.end(JSON.stringify(payload));
    },
    send(payload) {
      nodeRes.writeHead(this.statusCode, this.headers);
      nodeRes.end(payload);
    },
  };

  return handler(req, res);
}

function serveStatic(rawPathname, res) {
  let pathname = decodeURIComponent(rawPathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(filePath).pipe(res);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method !== 'POST') return resolve({});

    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    value = value.replace(/^['"]|['"]$/g, '');

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
