// Reads invoices, checks them two ways, screens them, pays through the contract rules, and records a ledger.
// Usage: node --env-file=../.env invoice.mjs invoices          (a folder, or one or more .txt files)
// Placeholders in sample files: {{VENDOR}} {{ATTACKER}} {{NEWVENDOR}} are filled from your .env accounts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, keyStores, KeyPair, utils } from 'near-api-js';
import { runTask, screen } from './screen.mjs';
import { EXTRACT, rulesExtract } from './invoice-lib.mjs';

const E = process.env;
const LEDGER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ledger.json');
const inputs = process.argv.slice(2);
if (!inputs.length) throw new Error('Usage: node --env-file=../.env invoice.mjs invoices');
const files = inputs.flatMap((p) => fs.statSync(p).isDirectory()
  ? fs.readdirSync(p).filter((f) => f.endsWith('.txt')).sort().map((f) => path.join(p, f)) : [p]);
const fill = (t) => t.replaceAll('{{VENDOR}}', E.PAYEE_ID).replaceAll('{{ATTACKER}}', E.ATTACKER_ID).replaceAll('{{NEWVENDOR}}', E.APPROVER2_ID || E.ATTACKER_ID);

const ks = new keyStores.InMemoryKeyStore();
for (const [id, k] of [[E.AGENT_ID, E.AGENT_KEY], [E.GUARDIAN_ID, E.GUARDIAN_KEY]]) await ks.setKey('testnet', id, KeyPair.fromString(k));
const near = await connect({ networkId: 'testnet', nodeUrl: E.NEAR_RPC || 'https://test.rpc.fastnear.com', keyStore: ks });
const call = async (who, methodName, args) =>
  (await (await near.account(who)).functionCall({ contractId: E.CONTRACT_ID, methodName, args, gas: 100000000000000n })).transaction.hash;
const view = async (m) => (await near.account(E.AGENT_ID)).viewFunction({ contractId: E.CONTRACT_ID, methodName: m, args: {} });
const lastLog = async () => (await view('get_log')).at(-1).split('|').slice(1).join('|');
const link = (h) => `https://testnet.nearblocks.io/txns/${h}`;
const saveLedger = (row) => {
  let rows = []; try { rows = JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { /* first row */ }
  rows.push(row); fs.writeFileSync(LEDGER, JSON.stringify(rows, null, 2));
};

for (const file of files) {
  const name = path.basename(file);
  console.log(`\n== ${name}`);
  const text = fill(fs.readFileSync(file, 'utf8'));
  const row = { time: new Date().toISOString(), file: name, invoice_number: '', vendor_name: '', payee_account: '', amount_near: 0,
    category: '', due_date: '', status: '', reason: '', request_id: null, tx: '', extraction: '', screen: '' };
  const finish = (status, reason) => { row.status = status; row.reason = reason; saveLedger(row); console.log(`  RESULT: ${status} - ${reason}`); };

  // 1. Read it two independent ways
  const rules = rulesExtract(text);
  const { result: ai, tried } = await runTask(EXTRACT, { text });
  const fails = tried.filter((t) => !/: ok$/.test(t));
  if (fails.length) console.log(`  (AI fallback notes: ${fails.join(' | ')})`);
  console.log(`  rules read: ${rules ? `${rules.amount} NEAR to ${rules.payee_account}` : 'could not read confidently'}`);
  console.log(`  AI read:    ${ai ? `${ai.amount} NEAR to ${ai.payee_account} (${ai.provider}:${ai.model})` : 'unavailable'}`);
  row.extraction = ai ? `${ai.provider}:${ai.model}` : 'rules-only';
  const src = rules || ai;
  if (src) Object.assign(row, { invoice_number: ai?.invoice_number || rules?.invoice_number || '', vendor_name: ai?.vendor_name || rules?.vendor_name || '',
    payee_account: rules?.payee_account || ai.payee_account, amount_near: rules?.amount ?? ai.amount,
    category: ai?.category || rules?.category || 'Uncategorised', due_date: ai?.due_date || rules?.due_date || '' });

  // 2. Screen the whole invoice for tricks (the invoice is untrusted text)
  const v = await screen({ instruction: text, to: row.payee_account || 'unknown', amountNear: row.amount_near, maxLen: 2500 });
  row.screen = v.source;
  console.log(`  AI screen (${v.source}): ${v.verdict.toUpperCase()} - ${v.reason}`);
  if (v.verdict === 'block') {
    await call(E.GUARDIAN_ID, 'freeze', { reason: `invoice ${name}: ${v.reason}`.slice(0, 120) });
    finish('REFUSED', `guardian froze the contract: ${v.reason}`); continue;
  }

  // 3. The two readings must agree and make sense
  if (!rules) { finish('REFUSED', 'the pattern rules could not read the payee and total with confidence'); continue; }
  if (ai && (ai.payee_account !== rules.payee_account || Math.abs(ai.amount - rules.amount) > 1e-9)) {
    finish('REFUSED', `AI read ${ai.amount} NEAR to ${ai.payee_account} but the rules read ${rules.amount} NEAR to ${rules.payee_account}`); continue; }
  if (ai && ai.currency !== 'NEAR') { finish('REFUSED', `invoice currency is ${ai.currency}; this prototype pays NEAR only`); continue; }
  if (!/^[a-z0-9_-]+(\.[a-z0-9_-]+)*\.testnet$/.test(row.payee_account)) { finish('REFUSED', 'payee is not a valid testnet account'); continue; }

  // 4. Submit to the contract, which makes the final decision
  const memo = `INV ${row.invoice_number} ${row.vendor_name}`.slice(0, 100);
  row.tx = await call(E.AGENT_ID, 'pay', { to: row.payee_account, amount: utils.format.parseNearAmount(String(row.amount_near)), memo });
  const said = await lastLog();
  console.log(`  submitted ${link(row.tx)}\n  contract says: ${said}`);
  const status = said.split(' ')[0];
  if (status === 'QUEUED') row.request_id = Number(said.match(/#(\d+)/)[1]);
  finish(status, said.replace(/^\S+\s+\S+\s+\S+\s+\S+\s*/, '').slice(0, 120));
}
console.log('\nDone. Next: node --env-file=../.env ledger.mjs');
