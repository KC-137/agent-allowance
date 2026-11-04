// Adds testnet NEAR to the contract's treasury from one of your accounts.
// Usage:  node --env-file=../.env fund.mjs approver2 4      (sends 4 NEAR; or use "owner" instead of "approver2")
import { connect, keyStores, KeyPair, utils } from 'near-api-js';

const E = process.env;
const [who, amount] = process.argv.slice(2);
const from = { owner: [E.OWNER_ID, E.OWNER_KEY], approver2: [E.APPROVER2_ID, E.APPROVER2_KEY] }[who];
if (!from || !from[0] || !amount) throw new Error('Usage: node --env-file=../.env fund.mjs approver2 4');

const ks = new keyStores.InMemoryKeyStore();
await ks.setKey('testnet', from[0], KeyPair.fromString(from[1]));
const near = await connect({ networkId: 'testnet', nodeUrl: E.NEAR_RPC || 'https://test.rpc.fastnear.com', keyStore: ks });
const res = await (await near.account(from[0])).sendMoney(E.CONTRACT_ID, BigInt(utils.format.parseNearAmount(amount)));
console.log(`Sent ${amount} NEAR from ${from[0]} to ${E.CONTRACT_ID}: https://testnet.nearblocks.io/txns/${res.transaction.hash}`);
const st = await (await near.account(E.CONTRACT_ID)).state();
console.log(`Treasury spendable balance now: ${utils.format.formatNearAmount((BigInt(st.amount) - BigInt(st.storage_usage) * 10n ** 19n).toString())} NEAR`);
