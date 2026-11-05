// api-demo.mjs v1 - pay-per-use API demo (x402 style). Step 5. UNTESTED on testnet.
// A local shop answers 402 Payment Required. The agent pays through the allowance
// contract. The shop verifies the payment on the NEAR testnet before answering.
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as nearAPI from 'near-api-js';

const { connect, keyStores, KeyPair, utils } = nearAPI;
const E = process.env;
const RPC = E.NEAR_RPC || 'https://test.rpc.fastnear.com';
const PORT = 8402;
const BASE = `http://localhost:${PORT}`;
const toYocto = (n) => utils.format.parseNearAmount(String(n));

for (const k of ['CONTRACT_ID', 'AGENT_ID', 'AGENT_KEY', 'PAYEE_ID']) {
  if (!E[k]) { console.error(`Missing ${k} in .env`); process.exit(1); }
}

// ---------- the shop (service side) ----------
const PRODUCTS = {
  '/api/quote': { price: '0.05', body: { quote: 'Spend like the contract is watching.' } },
  '/api/premium': { price: '1.8', body: { premium: 'Premium report (should never be delivered in scene 3).' } },
};
const offers = new Map(); // nonce -> offer
const usedReceipts = new Set(); // tx hashes already redeemed

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'x', method, params }),
  });
  return r.json();
}

// Checks the payment really happened on chain. Returns {ok, why}.
async function verifyPayment(hash, nonce) {
  const offer = offers.get(nonce);
  if (!offer) return { ok: false, why: 'unknown or already used offer' };
  if (usedReceipts.has(hash)) return { ok: false, why: 'receipt already used (replay)' };
  const res = await rpc('EXPERIMENTAL_tx_status', {
    tx_hash: hash, sender_account_id: E.AGENT_ID, wait_until: 'FINAL',
  });
  const t = res.result;
  if (!t) return { ok: false, why: 'cannot read transaction: ' + JSON.stringify(res.error || res).slice(0, 200) };
  if (t.transaction.signer_id !== E.AGENT_ID) return { ok: false, why: 'wrong signer' };
  if (t.transaction.receiver_id !== E.CONTRACT_ID) return { ok: false, why: 'not sent to the allowance contract' };
  const fc = t.transaction.actions?.[0]?.FunctionCall;
  if (!fc || fc.method_name !== 'pay') return { ok: false, why: 'not a pay call' };
  let args;
  try { args = JSON.parse(Buffer.from(fc.args, 'base64').toString()); } catch { return { ok: false, why: 'bad args' }; }
  if (args.to !== offer.payTo) return { ok: false, why: 'paid the wrong account' };
  if (args.memo !== offer.memo) return { ok: false, why: 'memo does not match this offer' };
  if (BigInt(args.amount) < BigInt(offer.yocto)) return { ok: false, why: 'amount too low' };
  if (t.status?.Failure) return { ok: false, why: 'transaction failed' };
  // Money must really have moved: a Transfer from the contract to the seller.
  const moved = (t.receipts || []).some((r) =>
    r.receiver_id === offer.payTo && r.predecessor_id === E.CONTRACT_ID &&
    (r.receipt?.Action?.actions || []).some((a) => a.Transfer && BigInt(a.Transfer.deposit) >= BigInt(offer.yocto)));
  if (!moved) return { ok: false, why: 'no money moved (the contract blocked or queued the payment)' };
  usedReceipts.add(hash);
  offers.delete(nonce);
  return { ok: true, why: 'payment verified on chain' };
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const product = PRODUCTS[req.url];
  if (!product) return send(404, { error: 'not found' });
  const pay = req.headers['x-payment']; // "<txhash>:<nonce>"
  if (!pay) {
    const nonce = crypto.randomBytes(8).toString('hex');
    const offer = { payTo: E.PAYEE_ID, yocto: toYocto(product.price), memo: `api:${nonce}` };
    offers.set(nonce, offer);
    return send(402, { error: 'Payment Required', price_near: product.price, price_yocto: offer.yocto,
      pay_to: offer.payTo, via_contract: E.CONTRACT_ID, memo: offer.memo, nonce });
  }
  const [hash, nonce] = String(pay).split(':');
  const v = await verifyPayment(hash, nonce);
  if (!v.ok) return send(402, { error: 'Payment not accepted', reason: v.why });
  return send(200, { paid: true, hash, data: product.body });
});

// ---------- the agent (client side) ----------
const keyStore = new keyStores.InMemoryKeyStore();
await keyStore.setKey('testnet', E.AGENT_ID, KeyPair.fromString(E.AGENT_KEY));
const near = await connect({ networkId: 'testnet', keyStore, nodeUrl: RPC });
const agent = await near.account(E.AGENT_ID);
const receipts = [];

async function lastLog() {
  const log = await agent.viewFunction({ contractId: E.CONTRACT_ID, methodName: 'get_log', args: {} });
  return Array.isArray(log) ? log[log.length - 1] : String(log);
}

async function buy(path) {
  console.log(`\n> agent asks for ${path}`);
  const r1 = await fetch(BASE + path);
  const offer = await r1.json();
  if (r1.status !== 402) { console.log('  unexpected reply', r1.status, offer); return; }
  console.log(`  shop says 402: pay ${offer.price_near} NEAR to ${offer.pay_to}`);
  console.log('  agent pays through the contract...');
  const out = await agent.functionCall({
    contractId: E.CONTRACT_ID, methodName: 'pay',
    args: { to: offer.pay_to, amount: offer.price_yocto, memo: offer.memo },
    gas: '60000000000000', attachedDeposit: '0',
  });
  const hash = out.transaction.hash;
  console.log('  contract decision:', await lastLog());
  console.log('  tx:', `https://testnet.nearblocks.io/txns/${hash}`);
  const r2 = await fetch(BASE + path, { headers: { 'X-Payment': `${hash}:${offer.nonce}` } });
  const body = await r2.json();
  console.log(`  shop reply ${r2.status}:`, JSON.stringify(body));
  receipts.push({ path, price_near: offer.price_near, tx: hash, status: r2.status, delivered: r2.status === 200, at: new Date().toISOString() });
  return { hash, offer };
}

await new Promise((ok) => server.listen(PORT, ok));
try {
  console.log('=== Scene 1: cheap item, should be PAID and delivered ===');
  const first = await buy('/api/quote');

  console.log('\n=== Scene 2: replay the same receipt for a free second answer ===');
  if (first) {
    const r = await fetch(BASE + '/api/quote', { headers: { 'X-Payment': `${first.hash}:${first.offer.nonce}` } });
    console.log(`  shop reply ${r.status}:`, JSON.stringify(await r.json()));
  }

  console.log('\n=== Scene 3: greedy price (1.8 NEAR), the contract should BLOCK it ===');
  await buy('/api/premium');
} catch (e) {
  console.error('\nERROR:', e.message || e);
} finally {
  fs.writeFileSync('api-receipts.json', JSON.stringify(receipts, null, 2));
  console.log('\nSaved api-receipts.json');
  server.close();
}
