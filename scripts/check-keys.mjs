// Checks that each secret key in .env really belongs to its account on testnet. Never prints secrets.
// Usage: node --env-file=../.env check-keys.mjs
import { connect, keyStores, KeyPair } from 'near-api-js';

const E = process.env;
const ROLES = [
  ['owner', 'OWNER_ID', 'OWNER_KEY'], ['contract', 'CONTRACT_ID', 'CONTRACT_KEY'],
  ['agent', 'AGENT_ID', 'AGENT_KEY'], ['guardian', 'GUARDIAN_ID', 'GUARDIAN_KEY'], ['approver2', 'APPROVER2_ID', 'APPROVER2_KEY'],
];
const near = await connect({ networkId: 'testnet', nodeUrl: E.NEAR_RPC || 'https://test.rpc.fastnear.com', keyStore: new keyStores.InMemoryKeyStore() });

const pubs = {};
for (const [name, , keyVar] of ROLES) {
  try { pubs[name] = KeyPair.fromString((E[keyVar] || '').trim()).getPublicKey().toString(); } catch { pubs[name] = null; }
}
for (const [name, idVar, keyVar] of ROLES) {
  const id = (E[idVar] || '').trim();
  if (!id || !E[keyVar]) { console.log(`${name}: skipped (${idVar} or ${keyVar} not set)`); continue; }
  if (!pubs[name]) { console.log(`${name}: PROBLEM - ${keyVar} is not a valid private key (it must start with ed25519: and be the PRIVATE key)`); continue; }
  try {
    const res = await (await near.account(id)).getAccessKeys();
    const keys = Array.isArray(res) ? res : res.keys;
    const hit = keys.find((k) => k.public_key === pubs[name]);
    if (hit) { console.log(`${name}: OK  (${id}, ${hit.access_key.permission === 'FullAccess' ? 'full access' : 'limited key'})`); continue; }
    const other = ROLES.map(([n]) => n).find((n) => n !== name && pubs[n] === pubs[name]);
    console.log(`${name}: MISMATCH - this key is not a key of ${id}.${other ? ` It is the same key as ${other.toUpperCase()}_KEY, so it was probably pasted into the wrong line.` : ' Re-export it with: near account export-account ' + id}`);
  } catch (e) { console.log(`${name}: could not check ${id} (${String(e.message).slice(0, 80)})`); }
}
