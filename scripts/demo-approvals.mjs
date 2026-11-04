// Shows "2 people must approve". Needs APPROVER2_ID / APPROVER2_KEY in .env (a second testnet account).
// Usage: node --env-file=../.env demo-approvals.mjs
import { connect, keyStores, KeyPair, utils } from 'near-api-js';

const E = process.env;
if (!E.APPROVER2_ID || !E.APPROVER2_KEY) throw new Error('Set APPROVER2_ID and APPROVER2_KEY in .env first');
const ks = new keyStores.InMemoryKeyStore();
for (const [id, k] of [[E.OWNER_ID, E.OWNER_KEY], [E.AGENT_ID, E.AGENT_KEY], [E.APPROVER2_ID, E.APPROVER2_KEY]])
  await ks.setKey('testnet', id, KeyPair.fromString(k));
const near = await connect({ networkId: 'testnet', nodeUrl: E.NEAR_RPC || 'https://test.rpc.fastnear.com', keyStore: ks });
const _st = await (await near.account(E.CONTRACT_ID)).state();
const _spendable = BigInt(_st.amount) - BigInt(_st.storage_usage) * 10n ** 19n;
console.log(`Treasury spendable balance: ${utils.format.formatNearAmount(_spendable.toString())} NEAR`);
if (_spendable < 3n * 10n ** 24n) throw new Error('Treasury is too low to run this demo. Add funds first: node --env-file=../.env fund.mjs approver2 4');

const call = async (who, methodName, args) =>
  (await (await near.account(who)).functionCall({ contractId: E.CONTRACT_ID, methodName, args, gas: 100000000000000n })).transaction.hash;
const view = async (m) => (await near.account(E.OWNER_ID)).viewFunction({ contractId: E.CONTRACT_ID, methodName: m, args: {} });
const link = (h) => `https://testnet.nearblocks.io/txns/${h}`;
const lastLog = async () => (await view('get_log')).at(-1).split('|').slice(1).join('|');

console.log('== Rule change: payments that need a human now need TWO different people');
await call(E.OWNER_ID, 'set_approvers', { accounts: [E.APPROVER2_ID], required: 2 });
console.log(`  contract says: ${await lastLog()}`);

console.log('\n== The agent asks to pay a 1.3 NEAR invoice (above the auto-approve limit)');
console.log(`  ${link(await call(E.AGENT_ID, 'pay', { to: E.PAYEE_ID, amount: utils.format.parseNearAmount('1.3'), memo: 'Invoice 2001 server upgrade' }))}`);
const p = (await view('get_pending')).at(-1);
console.log(`  contract says: ${await lastLog()}`);
console.log(`  waiting: Send ${utils.format.formatNearAmount(p.amount)} NEAR to ${p.to} for "${p.memo}"`);

console.log('\n== Person 1 (owner) approves: money must NOT move yet');
console.log(`  ${link(await call(E.OWNER_ID, 'approve', { id: p.id }))}`);
console.log(`  contract says: ${await lastLog()}`);

console.log('\n== The same person tries to approve again: must be refused');
try { await call(E.OWNER_ID, 'approve', { id: p.id }); throw new Error('NOT REFUSED'); }
catch (e) { if (e.message === 'NOT REFUSED') throw e; console.log('  OK, refused: one person cannot approve twice'); }

console.log('\n== Person 2 approves: now it pays');
console.log(`  ${link(await call(E.APPROVER2_ID, 'approve', { id: p.id }))}`);
console.log(`  contract says: ${await lastLog()}`);

await call(E.OWNER_ID, 'set_approvers', { accounts: [E.APPROVER2_ID], required: 1 });
console.log('\n(reset: one approval needed again, so the main demo works as before)');
