// Swaps the agent's and guardian's master keys for LIMITED keys (TESTNET).
//   agent key    -> can only call `pay`    on the contract
//   guardian key -> can only call `freeze` on the contract
// Safe to re-run: roles that are already limited are skipped.
// Usage:  node --env-file=../.env lock-keys.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connect, keyStores, KeyPair, utils } from 'near-api-js';

const E = process.env;
const RPC = E.NEAR_RPC || 'https://test.rpc.fastnear.com';
const ENV_PATH = fileURLToPath(new URL('../.env', import.meta.url));
const gas = 100000000000000n;
const allowance = BigInt(utils.format.parseNearAmount('0.5')); // fee budget the limited key may spend
const ROLES = [
  { name: 'agent', id: E.AGENT_ID, envKey: 'AGENT_KEY', methods: ['pay'], forbidden: { methodName: 'freeze', args: { reason: 'test' } } },
  { name: 'guardian', id: E.GUARDIAN_ID, envKey: 'GUARDIAN_KEY', methods: ['freeze'], forbidden: { methodName: 'unfreeze', args: {} } },
];

const connectWith = async (id, keyPair) => {
  const ks = new keyStores.InMemoryKeyStore();
  await ks.setKey('testnet', id, keyPair);
  return connect({ networkId: 'testnet', nodeUrl: RPC, keyStore: ks });
};
const short = (e) => String(e.type || e.message || e).replace(/\s+/g, ' ').slice(0, 90);
async function mustBeRefused(label, fn) {
  let worked = false;
  try { await fn(); worked = true; } catch (e) { console.log(`  OK, refused: ${label}  (${short(e)})`); }
  if (worked) throw new Error(`SECURITY PROBLEM: the limited key was allowed to ${label}. Stopping before touching anything else.`);
}

const owner = await (await connectWith(E.OWNER_ID, KeyPair.fromString(E.OWNER_KEY))).account(E.OWNER_ID);
const readLog = async () => (await owner.viewFunction({ contractId: E.CONTRACT_ID, methodName: 'get_log', args: {} })).at(-1).split('|').slice(1).join('|');
let envText = fs.readFileSync(ENV_PATH, 'utf8');

for (const role of ROLES) {
  console.log(`\n== ${role.name} (${role.id})`);
  const oldPair = KeyPair.fromString(E[role.envKey]);
  const oldPub = oldPair.getPublicKey().toString();
  const acct = await (await connectWith(role.id, oldPair)).account(role.id);
  const res = await acct.getAccessKeys();
  const mine = (Array.isArray(res) ? res : res.keys).find((k) => k.public_key === oldPub);
  if (!mine) throw new Error(`The ${role.envKey} in .env is not a key of ${role.id}`);
  if (mine.access_key.permission !== 'FullAccess') { console.log('  already limited, skipping'); continue; }

  const newPair = KeyPair.fromRandom('ed25519');
  await acct.addKey(newPair.getPublicKey().toString(), E.CONTRACT_ID, role.methods, allowance);
  console.log(`  added a limited key: may only call ${role.methods.join(', ')} on ${E.CONTRACT_ID}`);

  const limited = await (await connectWith(role.id, newPair)).account(role.id);
  await mustBeRefused(`send money straight out of the ${role.name} account`, () => limited.sendMoney(E.OWNER_ID, 1000000000000000000000n));
  await mustBeRefused(`call ${role.forbidden.methodName}`, () => limited.functionCall({ contractId: E.CONTRACT_ID, methodName: role.forbidden.methodName, args: role.forbidden.args, gas }));

  if (role.name === 'agent') {
    await limited.functionCall({ contractId: E.CONTRACT_ID, methodName: 'pay', gas,
      args: { to: E.PAYEE_ID, amount: utils.format.parseNearAmount('0.01'), memo: 'limited-key test' } });
    console.log(`  OK, allowed: pay  -> contract says: ${await readLog()}`);
  } else {
    await limited.functionCall({ contractId: E.CONTRACT_ID, methodName: 'freeze', gas, args: { reason: 'limited-key test' } });
    console.log(`  OK, allowed: freeze -> contract says: ${await readLog()}`);
    await owner.functionCall({ contractId: E.CONTRACT_ID, methodName: 'unfreeze', gas, args: {} });
    console.log('  owner unfroze it again');
  }

  // Save the new key first, THEN remove the master key.
  envText = envText.replace(new RegExp(`^${role.envKey}=.*$`, 'm'), `${role.envKey}=${newPair.toString()}`);
  fs.writeFileSync(ENV_PATH, envText);
  console.log(`  saved the new key into .env as ${role.envKey}`);
  await acct.deleteKey(oldPub);
  console.log('  master key removed from the account');
}
console.log('\nDone. The agent and guardian now hold limited keys. Next: node --env-file=../.env demo.mjs');
