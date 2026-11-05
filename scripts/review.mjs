// The approvers' tool.
//   node --env-file=../.env review.mjs                     list requests waiting
//   node --env-file=../.env review.mjs approve 3           approve #3 (as the owner)
//   node --env-file=../.env review.mjs reject 3            reject #3
//   node --env-file=../.env review.mjs unfreeze           lift a freeze (owner only)
//   add  --as=approver2  to act as the second approver
import { connect, keyStores, KeyPair, utils } from 'near-api-js';

const E = process.env;
const args = process.argv.slice(2);
const second = args.includes('--as=approver2');
const [id, key] = second ? [E.APPROVER2_ID, E.APPROVER2_KEY] : [E.OWNER_ID, E.OWNER_KEY];
const [action, idArg] = args.filter((a) => !a.startsWith('--'));

const ks = new keyStores.InMemoryKeyStore();
await ks.setKey('testnet', id, KeyPair.fromString(key));
const near = await connect({ networkId: 'testnet', nodeUrl: E.NEAR_RPC || 'https://test.rpc.fastnear.com', keyStore: ks });
const me = await near.account(id);

if (action === 'unfreeze') {
  const res = await me.functionCall({ contractId: E.CONTRACT_ID, methodName: 'unfreeze', args: {}, gas: 100000000000000n });
  console.log(`unfrozen: https://testnet.nearblocks.io/txns/${res.transaction.hash}`);
} else if (action === 'approve' || action === 'reject') {
  const res = await me.functionCall({ contractId: E.CONTRACT_ID, methodName: action, args: { id: Number(idArg) }, gas: 100000000000000n });
  console.log(`${action} #${idArg} as ${id}: https://testnet.nearblocks.io/txns/${res.transaction.hash}`);
} else {
  const policy = await me.viewFunction({ contractId: E.CONTRACT_ID, methodName: 'get_policy', args: {} });
  const list = await me.viewFunction({ contractId: E.CONTRACT_ID, methodName: 'get_pending', args: {} });
  if (!list.length) console.log('Nothing is waiting for approval.');
  for (const p of list) {
    console.log(`\n#${p.id}  Send ${utils.format.formatNearAmount(p.amount)} NEAR to ${p.to}`);
    console.log(`     note: "${p.memo}"`);
    console.log(`     why it needs a human: ${p.reason}`);
    console.log(`     approvals so far: ${(p.approvals || []).length} of ${policy.required || 1} needed ${(p.approvals || []).length ? '(' + p.approvals.join(', ') + ')' : ''}`);
  }
}
