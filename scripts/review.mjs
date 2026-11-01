// The human's approval tool.
//   node --env-file=../.env review.mjs            -> list requests waiting for you
//   node --env-file=../.env review.mjs approve 3  -> pay request #3
//   node --env-file=../.env review.mjs reject 3   -> refuse request #3
import { connect, keyStores, KeyPair, utils } from 'near-api-js';

const E = process.env;
const ks = new keyStores.InMemoryKeyStore();
await ks.setKey('testnet', E.OWNER_ID, KeyPair.fromString(E.OWNER_KEY));
const near = await connect({ networkId: 'testnet', nodeUrl: E.NEAR_RPC || 'https://test.rpc.fastnear.com', keyStore: ks });
const owner = await near.account(E.OWNER_ID);
const [action, idArg] = process.argv.slice(2);

if (action === 'approve' || action === 'reject') {
  const res = await owner.functionCall({ contractId: E.CONTRACT_ID, methodName: action, args: { id: Number(idArg) }, gas: 100000000000000n });
  console.log(`${action} #${idArg} done: https://testnet.nearblocks.io/txns/${res.transaction.hash}`);
} else {
  const list = await owner.viewFunction({ contractId: E.CONTRACT_ID, methodName: 'get_pending', args: {} });
  if (!list.length) console.log('Nothing is waiting for your approval.');
  for (const p of list) {
    console.log(`\n#${p.id}  Send ${utils.format.formatNearAmount(p.amount)} NEAR to ${p.to}`);
    console.log(`     note: "${p.memo}"`);
    console.log(`     why it needs you: ${p.reason}`);
    console.log(`     approve: node --env-file=../.env review.mjs approve ${p.id}   |   reject: ... reject ${p.id}`);
  }
}
