// runner.mjs v5 - local runner + dashboard server. Open http://localhost:8787 (this PC only).
// Runs ONLY the fixed commands below. Requests must come from this same page (Origin + Host checks).
// Serving the page from here also stops editors' live-reload tools from refreshing it when scripts write files.
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, '..');
const PORT = 8787;
const HOSTS = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
const RUN = {
  demo: ['demo.mjs'],
  invoices: ['invoice.mjs', 'invoices'],
  api: ['api-demo.mjs'],
  selftest: ['selftest.mjs'],
  aitest: ['test-ai.mjs'],
  fund_approver2: ['fund.mjs', 'approver2', '4'],
  fund_owner: ['fund.mjs', 'owner', '2'],
  unfreeze: ['review.mjs', 'unfreeze'],
};
const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/styles.css': 'styles.css', '/app.js': 'app.js', '/near-logo.svg': 'near-logo.svg', '/rules.json': 'rules.json', '/logo.svg': 'logo.svg', '/favicon.svg': 'favicon.svg' };
const TYPE = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
const DATA = { ledger: 'ledger.json', receipts: 'api-receipts.json' };
const FALLBACK_LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.5 -0.5 30 30"><circle fill="#00ec97" cx="14.5" cy="14.5" r="13.719"/><path fill="#060607" fill-rule="evenodd" d="M6.832,8.094A2.2,2.2,0,0,1,9.763,7.068L19.729,18.94V10l-3.371,2.931a0.406,0.406,0,0,1-.44-0.44l3.517-5.276a1.706,1.706,0,0,1,2.638.733v12.9s-0.447,1.651-2.638,1.172L9.323,10,9.177,19.086l3.517-2.931s0.7-.129.44,0.44L9.323,21.871A1.771,1.771,0,0,1,6.832,20.7V8.094Z"/></svg>';
const VERSION = 5;
let busy = false, child = null, curCmd = '', stopped = false;
// What the scripts will really see: ask Node itself to load ../.env (same parser as real runs). Prints booleans, never key values.
const EFF_SCRIPT = "const e=process.env;console.log(JSON.stringify({order:e.AI_PROVIDERS||'',budget:e.AI_DAILY_BUDGET||'',gemini:!!e.GEMINI_API_KEY,groq:!!e.GROQ_API_KEY,cloudflare:!!(e.CF_ACCOUNT_ID&&e.CF_API_TOKEN),openrouter:!!e.OPENROUTER_API_KEY}))";
function aiStatus() {
  let eff = null;
  try { eff = JSON.parse(execFileSync(process.execPath, ['--env-file=../.env', '-e', EFF_SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 5000 })); } catch {}
  if (!eff) { // fallback: tolerant parse of .env text (last value wins, quotes and "export" allowed)
    let env = ''; try { env = fs.readFileSync(path.join(root, '.env'), 'utf8'); } catch {}
    const lines = env.split(/\r?\n/).map((l) => l.replace(/^\s*export\s+/, '').trim()).filter((l) => l && !l.startsWith('#'));
    const val = (k) => { let v = ''; for (const l of lines) { const i = l.indexOf('='); if (i > 0 && l.slice(0, i).trim() === k) v = l.slice(i + 1).trim().replace(/^["']|["']$/g, ''); } return v; };
    eff = { order: val('AI_PROVIDERS'), budget: val('AI_DAILY_BUDGET'), gemini: !!val('GEMINI_API_KEY'), groq: !!val('GROQ_API_KEY'), cloudflare: !!(val('CF_ACCOUNT_ID') && val('CF_API_TOKEN')), openrouter: !!val('OPENROUTER_API_KEY') };
  }
  const json = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return {}; } };
  const st = json('.ai-status.json'), cache = json('.screen-cache.json');
  const order = (eff.order || 'gemini,groq,cloudflare,openrouter').split(',').map((x) => x.trim()).filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);
  return { order, shellOverride: process.env.AI_PROVIDERS !== undefined, providers: order.map((n) => ({ name: n, configured: !!eff[n], ...(st[n] || {}) })), budget: { limit: Number(eff.budget || 40), used: cache.day === today ? cache.calls || 0 : 0 } };
}
// Public account ids only (never keys), read from ../.env, for the dashboard's hidden funds panel.
function accountIds() {
  const o = {};
  try { for (const l of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^(\w+_ID)=(\S+)/); if (m) o[m[1]] = m[2]; } } catch {}
  return { treasury: o.CONTRACT_ID, owner: o.OWNER_ID, approver2: o.APPROVER2_ID, vendor: o.PAYEE_ID, attacker: o.ATTACKER_ID, agent: o.AGENT_ID, guardian: o.GUARDIAN_ID };
}

http.createServer((req, res) => {
  const u = new URL(req.url, `http://${HOSTS[0]}`);
  const text = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' };
  if (!HOSTS.includes(req.headers.host)) { res.writeHead(403); return res.end('forbidden'); }
  if (req.method === 'GET' && STATIC[u.pathname]) {
    const f = STATIC[u.pathname];
    const fp = path.join(root, f);
    if (!fs.existsSync(fp)) {
      if (f === 'near-logo.svg') { res.writeHead(200, { 'Content-Type': TYPE['.svg'] }); return res.end(FALLBACK_LOGO); }
      res.writeHead(404, text); return res.end(`Missing file: ${f}. Save it next to index.html in the project folder.\n`);
    }
    res.writeHead(200, { 'Content-Type': TYPE[path.extname(f)], 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(fp));
  }
  if (req.method === 'GET' && u.pathname.startsWith('/data/') && DATA[u.pathname.slice(6)]) {
    const f = path.join(dir, DATA[u.pathname.slice(6)]);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(fs.existsSync(f) ? fs.readFileSync(f) : '[]');
  }
  if (req.method === 'GET' && u.pathname === '/data/accounts') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify(accountIds()));
  }
  if (req.method === 'GET' && u.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({ version: VERSION, busy, cmd: curCmd }));
  }
  if (req.method === 'GET' && u.pathname === '/data/ai') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify(aiStatus()));
  }
  if (req.method === 'GET' && u.pathname === '/ping') { res.writeHead(200); return res.end('ok'); }
  if (req.method === 'POST' && u.pathname === '/stop') {
    if (!HOSTS.some((h) => req.headers.origin === `http://${h}`)) { res.writeHead(403); return res.end('forbidden'); }
    res.writeHead(200, text);
    if (!child) return res.end('nothing is running\n');
    stopped = true;
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']); else child.kill('SIGTERM');
    return res.end('stopping\n');
  }
  if (req.method !== 'POST' || u.pathname !== '/run') { res.writeHead(404); return res.end('not found'); }
  if (!HOSTS.some((h) => req.headers.origin === `http://${h}`)) { res.writeHead(403, text); return res.end('forbidden: open the dashboard at http://localhost:8787\n'); }
  const c = u.searchParams.get('cmd');
  const id = u.searchParams.get('id') || '';
  let args;
  if (c === 'approve' || c === 'reject') {
    if (!/^\d{1,6}$/.test(id)) { res.writeHead(400, text); return res.end('bad id\n'); }
    args = ['review.mjs', c, id];
  } else if (c === 'clear') {
    fs.rmSync(path.join(dir, '.screen-cache.json'), { force: true });
    res.writeHead(200, text); return res.end('AI screening cache cleared.\n');
  } else if (c === 'recycle') {
    const f = u.searchParams.get('from') || '', t = u.searchParams.get('to') || '', a = u.searchParams.get('amount') || '';
    if (!/^(owner|approver2|vendor|attacker)$/.test(f) || !/^(treasury|owner|approver2|vendor|attacker|[a-z0-9_.-]{2,64}\.testnet)$/.test(t) || !/^(all|\d{1,4}(\.\d{1,4})?)$/.test(a)) { res.writeHead(400, text); return res.end('bad recycle request\n'); }
    args = ['recycle.mjs', f, t, a];
  } else if (c === 'policy') {
    const g = (k) => (u.searchParams.get(k) || '').trim();
    const num = (v) => /^\d{1,6}(\.\d{1,4})?$/.test(v), acct = (v) => /^[a-z0-9_.-]{2,64}\.testnet$/.test(v);
    const k = g('kind');
    if (k === 'limits' && num(g('per')) && num(g('daily')) && num(g('auto'))) args = ['policy.mjs', 'limits', g('per'), g('daily'), g('auto')];
    else if (k === 'approvers' && /^\d{1,2}$/.test(g('required')) && (g('accounts') === '' || g('accounts').split(',').every((x) => acct(x.trim())))) args = ['policy.mjs', 'approvers', g('required'), ...(g('accounts') ? [g('accounts')] : [])];
    else if (k === 'addvendor' && acct(g('account')) && (g('cap') === '' || num(g('cap')))) args = ['policy.mjs', 'addvendor', g('account'), ...(g('cap') ? [g('cap')] : [])];
    else if (k === 'removevendor' && acct(g('account'))) args = ['policy.mjs', 'removevendor', g('account')];
    else { res.writeHead(400, text); return res.end('bad policy request\n'); }
  } else args = RUN[c];
  if (!args) { res.writeHead(400, text); return res.end('unknown command\n'); }
  if (busy) { res.writeHead(409, text); return res.end('Another scenario is still running. Wait for it to finish.\n'); }
  busy = true;
  res.writeHead(200, text);
  const p = spawn(process.execPath, ['--dns-result-order=ipv4first', '--env-file=../.env', ...args], { cwd: dir });
  child = p; curCmd = c; stopped = false;
  const out = (d) => { if (!res.writableEnded) res.write(String(d).replace(/\x1b\[[0-9;]*m/g, '')); };
  p.stdout.on('data', out);
  p.stderr.on('data', out);
  p.on('error', (e) => { busy = false; res.end('Could not start: ' + e.message + '\n'); });
  p.on('close', (code) => { busy = false; child = null; if (stopped) { stopped = false; if (!res.writableEnded) res.end('\n[stopped by you]\n'); return; } if (!res.writableEnded) res.end(`\n[finished${code ? ' with error code ' + code : ''}]\n`); });
}).listen(PORT, '127.0.0.1', () => console.log(`Runner ready. Open http://localhost:${PORT} in your browser and leave this window open.`));
