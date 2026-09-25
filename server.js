/* ============================================================
   BV MARKETPLACE — SERVER v3
   ------------------------------------------------------------
   Kya karta hai: sab users ka shared data ek jagah rakhta hai
   (data.json) — koi bhi user product banata hai to sabko dikhta hai.

   PEHLE SE BEHTAR (v3):
   - /api/health  -> server zinda hai ya nahi, turant check
   - Auto-backup  -> data kharab hone se bachav (data.backup.json)
   - Atomic write -> likhte waqt file kabhi adhoori nahi hoti
   - Activity log -> kaun kab data bheja (debugging ke liye)

   ENDPOINTS (client waise hi kaam karta hai — kuch nahi badalna):
   GET  /api/state  -> poora marketplace data
   POST /api/state  -> naya data save karo
   GET  /api/health -> server status + kitne products hain
   ============================================================ */

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const BACKUP_FILE = path.join(__dirname, 'data.backup.json');
const LOG_FILE = path.join(__dirname, 'sync.log');

// Sirf yehi keys save hoti hain — personal data (cart, wishlist,
// addresses, notifications) server pe kabhi nahi jaata
const ALLOWED_KEYS = [
  'bv_products', 'bv_orders', 'bv_shops', 'bv_reviews', 'bv_stats',
  'bv_coupons', 'bv_reports', 'bv_returns', 'bv_kyc', 'bv_audit',
  'bv_adminverified', 'bv_official_msgs', 'bv_accounts'
];

/* ---------- CORS: koi bhi site (GitHub Pages etc.) se allow ---------- */
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '60mb' }));
app.use(express.static(__dirname));

/* ---------- helpers ---------- */
function readState() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) {
    // data.json kharab ho to backup se wapas laao
    try {
      const b = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
      fs.writeFileSync(DATA_FILE, JSON.stringify(b));
      console.log('[BV] data.json kharab thi — backup se recover kiya');
      return b;
    } catch (e2) { return {}; }
  }
}

// Atomic write: pehle temp file, phir rename — kabhi adhoori file nahi
function writeState(state) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  // purani file ko backup banao
  try { if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, BACKUP_FILE); } catch (e) {}
  fs.renameSync(tmp, DATA_FILE);
}

function logLine(msg) {
  const t = new Date().toLocaleString('en-IN');
  const line = '[' + t + '] ' + msg + '\n';
  console.log('[BV] ' + msg);
  try { fs.appendFileSync(LOG_FILE, line); } catch (e) {}
}

function countProducts(state) {
  try {
    const p = JSON.parse(state.bv_products || '[]');
    return Array.isArray(p) ? p.length : 0;
  } catch (e) { return 0; }
}

/* ---------- HEALTH: server zinda hai? ---------- */
app.get('/api/health', (req, res) => {
  const s = readState();
  res.json({
    ok: true,
    server: 'BV Marketplace v3',
    time: Date.now(),
    products: countProducts(s),
    keys: Object.keys(s).filter(k => ALLOWED_KEYS.includes(k)).length
  });
});

/* ---------- STATE: poora data padho ---------- */
app.get('/api/state', (req, res) => {
  const s = readState();
  logLine('PULL — ' + countProducts(s) + ' products bheje');
  res.json(s);
});

/* ---------- STATE: naya data save karo (last-write-wins) ---------- */
app.post('/api/state', (req, res) => {
  const body = req.body || {};
  const clean = {};
  ALLOWED_KEYS.forEach(k => { if (body[k] !== undefined) clean[k] = body[k]; });
  clean._ts = Date.now();

  const old = readState();
  const dropped = Object.keys(body).filter(k => !ALLOWED_KEYS.includes(k));
  writeState(clean);

  logLine('PUSH — ' + countProducts(clean) + ' products save hue'
    + (dropped.length ? ' (blocked keys: ' + dropped.join(',') + ')' : '')
    + ' (pehle: ' + countProducts(old) + ' products)');
  res.json({ ok: true, saved: Object.keys(clean).length, products: countProducts(clean) });
});

/* ---------- home ---------- */
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
  const s = readState();
  console.log('BV server v3 chal raha hai — port ' + PORT);
  console.log('[BV] Data: ' + countProducts(s) + ' products, ' + Object.keys(s).length + ' keys');
});
