// TESTNET setup. Safe to run again any time: it deploys the latest contract, then makes sure the
// settings, trusted vendor and funding are all in place.
// Usage (after copying contract/build/allowance.wasm):  node --env-file=../.env setup.mjs
import fs from 'node:fs';
import { connect, keyStores, KeyPair, utils } from 'near-api-js';

const E = process.env;
for (const k of ['CONTRACT_ID', 'CONTRACT_KEY', 'OWNER_ID', 'OWNER_KEY', 'AGENT_ID', 'GUARDIAN_ID', 'PAYEE_ID'])
  if (!E[k] || E[k].includes('YOURNAME') || E[k].includes('PASTE')) throw new Error(`Set ${k} in .env first`);

const ks = new keyStores.InMemoryKeyStore();
await ks.setKey('testnet', E.CONTRACT_ID, KeyPair.fromString(E.CONTRACT_KEY));
await ks.setKey('testnet', E.OWNER_ID, KeyPair.fromString(E.OWNER_KEY));
const near = await connect({ networkId: 'testnet', nodeUrl: E.NEAR_RPC || 'https://test.rpc.fastnear.com', keyStore: ks });
const contract = await near.account(E.CONTRACT_ID);
const owner = await near.account(E.OWNER_ID);
const gas = 100000000000000n;
const nearAmt = (n) => utils.format.parseNearAmount(String(n));
const view = (m) => owner.viewFunction({ contractId: E.CONTRACT_ID, methodName: m, args: {} });
const ownerCall = (methodName, args) => owner.functionCall({ contractId: E.CONTRACT_ID, methodName, args, gas });

const wasm = fs.readFileSync(new URL('../contract/build/allowance.wasm', import.meta.url));
console.log(`Deploying contract (${wasm.length} bytes)...`);
await contract.deployContract(wasm);

let policy = null;
try { policy = await view('get_policy'); } catch { /* not set up yet */ }
if (policy?.owner) {
  console.log('Already initialised: keeping existing settings.');
} else {
  console.log('Initialising...');
  await contract.functionCall({ contractId: E.CONTRACT_ID, methodName: 'init', gas, args: {
    owner: E.OWNER_ID, agent: E.AGENT_ID, guardian: E.GUARDIAN_ID,
    per_tx: nearAmt(2), daily: nearAmt(5), approval_threshold: nearAmt(1) } });
}

console.log('Applying limits: 2 NEAR per payment, 5 NEAR per day, auto-approve up to 1 NEAR...');
await ownerCall('set_limits', { per_tx: nearAmt(2), daily: nearAmt(5), approval_threshold: nearAmt(1) });

console.log('Making sure the vendor is trusted (max 1.5 NEAR per payment)...');
await ownerCall('add_payee', { account: E.PAYEE_ID, cap: nearAmt(1.5) });

policy = await view('get_policy');
if (BigInt(policy.balance) < BigInt(nearAmt(3))) {
  console.log('Funding treasury with 5 NEAR...');
  await owner.sendMoney(E.CONTRACT_ID, BigInt(nearAmt(5)));
}

console.log('Policy:', await view('get_policy'));
console.log('Done. Next: node --env-file=../.env demo.mjs');
