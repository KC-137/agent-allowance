// recycle.mjs v1 - move practice NEAR between your own testnet accounts (for example vendor -> treasury).
// Usage: node --env-file=../.env recycle.mjs <from> <to> <amount|all>
//   from: owner | approver2 | vendor | attacker   (each needs its key in .env: OWNER_KEY, APPROVER2_KEY, VENDOR_KEY, ATTACKER_KEY)
//   to:   treasury | owner | approver2 | vendor | attacker | any-account.testnet
// Testnet only. "all" leaves a 0.05 NEAR reserve so the account can still pay fees.
import * as nearAPI from 'near-api-js';
const { connect, keyStores, KeyPair, utils } = nearAPI;
const E = process.env;
const RPC = E.NEAR_RPC || 'https://test.rpc.fastnear.com';
const IDS = { owner: E.OWNER_ID, approver2: E.APPROVER2_ID, vendor: E.PAYEE_ID, attacker: E.ATTACKER_ID, treasury: E.CONTRACT_ID };
const KEYS = { owner: E.OWNER_KEY, approver2: E.APPROVER2_KEY, vendor: E.VENDOR_KEY, attacker: E.ATTACKER_KEY };
const [from, toArg, amountArg] = process.argv.slice(2);
if (!from || !toArg || !amountArg) throw new Error('Usage: node --env-file=../.env recycle.mjs <owner|approver2|vendor|attacker> <to> <amount|all>');
if (!KEYS.hasOwnProperty(from)) throw new Error(`Cannot send from "${from}". Allowed: owner, approver2, vendor, attacker.`);
const fromId = IDS[from];
if (!fromId) throw new Error(`The account id for "${from}" is missing in .env.`);
if (!KEYS[from]) throw new Error(`No key for ${fromId}. Add ${from === 'vendor' ? 'VENDOR' : from.toUpperCase()}_KEY to .env (export it on your PC with: near account export-account ${fromId}). Never paste it in chat.`);
const toId = IDS[toArg] || toArg;
if (!/^[a-z0-9_.-]{2,64}\.testnet$/.test(toId)) throw new Error(`"${toArg}" is not a testnet account.`);
if (toId === fromId) throw new Error('Source and destination are the same account.');

const keyStore = new keyStores.InMemoryKeyStore();
await keyStore.setKey('testnet', fromId, KeyPair.fromString(KEYS[from]));
const near = await connect({ networkId: 'testnet', keyStore, nodeUrl: RPC });
const account = await near.account(fromId);
const show = (y) => utils.format.formatNearAmount(y, 3);

const bal = await account.getAccountBalance();
const available = BigInt(bal.available);
const reserve = BigInt(utils.format.parseNearAmount('0.05'));
let amt;
if (amountArg === 'all') amt = available - reserve;
else {
  amt = BigInt(utils.format.parseNearAmount(amountArg));
  if (available < amt + BigInt(utils.format.parseNearAmount('0.01'))) throw new Error(`${fromId} has only ${show(bal.available)} NEAR available, not enough for ${amountArg} plus fees.`);
}
if (amt <= 0n) throw new Error(`${fromId} has only ${show(bal.available)} NEAR available. Nothing to move.`);

console.log(`Moving ${show(amt.toString())} NEAR: ${fromId} -> ${toId}`);
const out = await account.sendMoney(toId, amt);
console.log('Done. tx: https://testnet.nearblocks.io/txns/' + out.transaction.hash);
console.log(`${fromId} now has ${show((await account.getAccountBalance()).available)} NEAR available.`);
try { console.log(`${toId} now has ${show((await (await near.account(toId)).getAccountBalance()).available)} NEAR available.`); } catch {}
