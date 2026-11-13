// policy.mjs v1 - change the contract's rules as the OWNER (testnet only). Normally run from the dashboard.
//   node --env-file=../.env policy.mjs limits <per_tx> <daily> <auto>      (amounts in NEAR)
//   node --env-file=../.env policy.mjs approvers <required> [acc1,acc2]    (omit accounts to keep the current ones)
//   node --env-file=../.env policy.mjs addvendor <account> [cap]           (cap in NEAR; re-run to change it)
//   node --env-file=../.env policy.mjs removevendor <account>
import * as nearAPI from 'near-api-js';
const { connect, keyStores, KeyPair, utils } = nearAPI;
const E = process.env;
const RPC = E.NEAR_RPC || 'https://test.rpc.fastnear.com';
for (const k of ['CONTRACT_ID', 'OWNER_ID', 'OWNER_KEY']) if (!E[k]) throw new Error(`Missing ${k} in .env`);
const [kind, a, b, c] = process.argv.slice(2);
const Y = (n) => utils.format.parseNearAmount(String(n));
const show = (y) => utils.format.formatNearAmount(y, 2);
const keyStore = new keyStores.InMemoryKeyStore();
await keyStore.setKey('testnet', E.OWNER_ID, KeyPair.fromString(E.OWNER_KEY));
const near = await connect({ networkId: 'testnet', keyStore, nodeUrl: RPC });
const owner = await near.account(E.OWNER_ID);
const view = () => owner.viewFunction({ contractId: E.CONTRACT_ID, methodName: 'get_policy', args: {} });
const call = (methodName, args) => owner.functionCall({ contractId: E.CONTRACT_ID, methodName, args, gas: '60000000000000', attachedDeposit: '0' });
const before = await view();
let out;
if (kind === 'limits') {
  const [per, day, auto] = [Number(a), Number(b), Number(c)];
  if (!(auto > 0 && auto <= per && per <= day)) throw new Error('Limits must satisfy: auto-approve <= max per payment <= daily budget, all above 0.');
  console.log(`Setting limits: per payment ${per}, auto-approve ${auto}, daily ${day} NEAR`);
  out = await call('set_limits', { per_tx: Y(per), daily: Y(day), approval_threshold: Y(auto) });
} else if (kind === 'approvers') {
  const required = parseInt(a, 10);
  const accounts = b ? b.split(',').map((s) => s.trim()).filter(Boolean) : before.approvers || [];
  if (!(required >= 1 && required <= accounts.length + 1)) throw new Error(`Approvals needed must be between 1 and ${accounts.length + 1} (approvers plus the owner).`);
  console.log(`Setting approvals: ${required} needed, approvers: ${accounts.join(', ') || '(none)'}`);
  out = await call('set_approvers', { accounts, required });
} else if (kind === 'addvendor') {
  if (!a) throw new Error('Vendor account missing.');
  console.log(`Trusting ${a}${b ? ' with a cap of ' + b + ' NEAR' : ''}`);
  out = await call('add_payee', b ? { account: a, cap: Y(b) } : { account: a });
} else if (kind === 'removevendor') {
  if (!a) throw new Error('Vendor account missing.');
  console.log(`Removing ${a} from trusted vendors`);
  out = await call('remove_payee', { account: a });
} else throw new Error('Usage: policy.mjs limits|approvers|addvendor|removevendor ...');
console.log('Done. tx: https://testnet.nearblocks.io/txns/' + out.transaction.hash);
const p = await view();
console.log(`Now: max per payment ${show(p.per_tx)}, auto-approve ${show(p.approval_threshold)}, daily ${show(p.daily)} NEAR; approvals needed ${p.required ?? 1}; vendors: ${(p.payees || []).join(', ') || '(none)'}`);
