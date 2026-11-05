// Brings the ledger up to date with what happened on-chain, then writes spreadsheet files.
// Usage: node --env-file=../.env ledger.mjs     -> ledger.csv (every invoice) and journal.csv (accounting entries for paid ones)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, keyStores } from 'near-api-js';

const E = process.env;
const dir = path.dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8'));
const near = await connect({ networkId: 'testnet', nodeUrl: E.NEAR_RPC || 'https://test.rpc.fastnear.com', keyStore: new keyStores.InMemoryKeyStore() });
const acct = await near.account(E.OWNER_ID);
const log = await acct.viewFunction({ contractId: E.CONTRACT_ID, methodName: 'get_log', args: {} });
const pending = await acct.viewFunction({ contractId: E.CONTRACT_ID, methodName: 'get_pending', args: {} });

for (const r of rows.filter((x) => x.request_id && ['QUEUED', 'WAITING'].includes(x.status))) {
  if (log.some((l) => l.includes(`|APPROVED #${r.request_id} `))) r.status = 'PAID';
  else if (log.some((l) => l.includes(`|REJECTED #${r.request_id} `))) r.status = 'REJECTED';
  else if (pending.some((p) => p.id === r.request_id)) r.status = 'QUEUED';
  else r.status = 'EXPIRED OR UNKNOWN';
}
fs.writeFileSync(path.join(dir, 'ledger.json'), JSON.stringify(rows, null, 2));

const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const link = (h) => (h ? `https://testnet.nearblocks.io/txns/${h}` : '');
const cols = ['time', 'file', 'invoice_number', 'vendor_name', 'payee_account', 'amount_near', 'category', 'due_date', 'status', 'reason', 'tx_link', 'extraction', 'screen'];
fs.writeFileSync(path.join(dir, 'ledger.csv'), [cols.join(','), ...rows.map((r) => cols.map((c) => q(c === 'tx_link' ? link(r.tx) : r[c])).join(','))].join('\n'));

const paid = rows.filter((r) => r.status === 'PAID');
fs.writeFileSync(path.join(dir, 'journal.csv'), ['date,debit_account,credit_account,amount_near,memo,reference',
  ...paid.map((r) => [r.time.slice(0, 10), `Expenses:${r.category}`, 'Assets:NEAR Treasury', r.amount_near, `Invoice ${r.invoice_number} - ${r.vendor_name}`, link(r.tx)].map(q).join(','))].join('\n'));

console.log('\nInvoice ledger');
for (const r of rows) console.log(`  #${(r.invoice_number || '?').padEnd(5)} ${String(r.amount_near).padStart(5)} NEAR  ${r.status.padEnd(9)} ${r.vendor_name || r.file}`);
const byCat = {}; for (const r of paid) byCat[r.category] = (byCat[r.category] || 0) + r.amount_near;
console.log('\nPaid so far by category:', Object.keys(byCat).length ? byCat : 'nothing yet');
console.log('Wrote ledger.csv and journal.csv in the scripts folder.');
