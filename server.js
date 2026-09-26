/* ============================================================
   BV MARKETPLACE — SERVER v4 (SECURITY EDITION)
   ------------------------------------------------------------
   v4 mein naya:
   - RATE LIMIT: ek IP sirf 80 requests / minute (spam/DoS bachav)
   - BODY LIMIT: 10 MB (pehle 60 MB tha — abuse se bachav)
   - sendBeacon support (app band karte waqt data save hota hai)
   - Security headers + x-powered-by hidden
   v3 se sab kuch included: /api/health, auto-backup,
   atomic write, activity log, CORS, allowed-keys filter.

   ENDPOINTS:
   GET  /api/state  -> poora marketplace data
   POST /api/state  -> naya data save (JSON ya text/plain beacon)
   GET  /api/health -> server status
   ============================================================ */

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const BACKUP_FILE = path.join(__dirname, 'data.backup.json');
const LOG_FILE = path.join(__dirname, 'sync.log');

const ALLOWED_KEYS = [
  'bv_products', 'bv_orders', 'bv_shops', 'bv_reviews', 'bv_stats',
  'bv_coupons', 'bv_reports', 'bv_returns', 'bv_kyc', 'bv_audit',
  'bv_adminverified', 'bv_official_msgs', 'bv_accounts'
];

/* ---------- SECURITY: basic headers ---------- */
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

/* ---------- CORS: koi bhi site (GitHub Pages etc.) se allow ---------- */
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ---------- SECURITY: RATE LIMIT (per-IP, 80 req/min) ----------
   Render ke aage proxy hota hai, isliye x-forwarded-for use karte hain */
const RATE = { max: 80, windowMs: 60000, hits: {} };
setInterval(() => { RATE.hits = {}; }, RATE.windowMs);
function rateLimit(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  RATE.hits[ip] = (RATE.hits[ip] || 0) + 1;
  if (RATE.hits[ip] > RATE.max) {
    return res.status(429).json({ ok: false, error: 'Too many requests — thodi der baad try karo' });
  }
  next();
}
app.use('/api/', rateLimit);

/* ---------- BODY PARSER ----------
   text/plain bhi accept karta hai — app band karte waqt
   sendBeacon isi format mein bhejta hai */
app.use(express.json({ limit: '10mb', type: ['application/json', 'text/plain'] }));
app.use(express.static(__dirname));

/* ---------- helpers ---------- */
function readState() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) {
    try {
      const b = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
      fs.writeFileSync(DATA_FILE, JSON.stringify(b));
      console.log('[BV] data.json corrupt — backup se recover kiya');
      return b;
    } catch (e2) { return {}; }
  }
}

function writeState(state) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  try { if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, BACKUP_FILE); } catch (e) {}
  fs.renameSync(tmp, DATA_FILE);
}

function logLine(msg) {
  const t = new Date().toLocaleString('en-IN');
  console.log('[BV] ' + msg);
  try { fs.appendFileSync(LOG_FILE, '[' + t + '] ' + msg + '\n'); } catch (e) {}
}

function countProducts(state) {
  try {
    const p = JSON.parse(state.bv_products || '[]');
    return Array.isArray(p) ? p.length : 0;
  } catch (e) { return 0; }
}

/* ---------- HEALTH ---------- */
app.get('/api/health', (req, res) => {
  const s = readState();
  res.json({
    ok: true,
    server: 'BV Marketplace v4',
    time: Date.now(),
    products: countProducts(s),
    keys: Object.keys(s).filter(k => ALLOWED_KEYS.includes(k)).length
  });
});

/* ---------- STATE READ ---------- */
app.get('/api/state', (req, res) => {
  const s = readState();
  logLine('PULL — ' + countProducts(s) + ' products bheje');
  res.json(s);
});

/* ---------- STATE WRITE (last-write-wins) ---------- */
app.post('/api/state', (req, res) => {
  const body = req.body || {};
  // agar text/plain beacon aaya ho aur body string bachi ho to parse karo
  let data = body;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = {}; } }

  const clean = {};
  ALLOWED_KEYS.forEach(k => { if (data[k] !== undefined) clean[k] = data[k]; });
  clean._ts = Date.now();

  const old = readState();
  const dropped = Object.keys(data).filter(k => !ALLOWED_KEYS.includes(k));
  writeState(clean);

  logLine('PUSH — ' + countProducts(clean) + ' products saved'
    + (dropped.length ? ' (blocked: ' + dropped.join(',') + ')' : '')
    + ' (before: ' + countProducts(old) + ')');
  res.json({ ok: true, saved: Object.keys(clean).length, products: countProducts(clean) });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
  const s = readState();
  console.log('BV server v4 (security edition) — port ' + PORT);
  console.log('[BV] Data: ' + countProducts(s) + ' products');
});
