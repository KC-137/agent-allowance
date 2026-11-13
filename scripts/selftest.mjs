// selftest.mjs v2 - read-only PASS/FAIL checks of the live testnet deployment. No keys, no cost.
// Usage: node selftest.mjs   (optional env: CONTRACT_ID, AGENT_ID, GUARDIAN_ID, NEAR_RPC)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileRules, RULES_SOURCE } from './screen.mjs';
const E = process.env;
import dns from 'node:dns';
import net from 'node:net';
dns.setDefaultResultOrder('ipv4first'); // avoids IPv6 stalls that show up as "fetch failed" on some Windows networks
net.setDefaultAutoSelectFamilyAttemptTimeout?.(2000);
const RPCS = [...new Set([E.NEAR_RPC, 'https://test.rpc.fastnear.com', 'https://rpc.testnet.near.org'].filter(Boolean))];
const C = E.CONTRACT_ID || 'contract2-nelson.testnet';
const A = E.AGENT_ID || 'agent-nelson.testnet';
const G = E.GUARDIAN_ID || 'guardian-nelson.testnet';
async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of RPCS) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) });
        const j = await r.json();
        if (j.error) throw new Error(JSON.stringify(j.error.data || j.error));
        return j.result;
      } catch (e) {
        last = e;
        if (!/fetch failed|timeout|abort/i.test(e.name + ' ' + e.message)) throw e;
      }
    }
  }
  throw new Error(`network problem (${last?.cause?.code || last?.cause?.message || last?.message}); tried ${RPCS.join(', ')}`);
}
const view = async (m) => JSON.parse(Buffer.from((await rpc('query', { request_type: 'call_function', finality: 'final', account_id: C, method_name: m, args_base64: Buffer.from('{}').toString('base64') })).result).toString());
const keys = async (acc) => (await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: acc })).keys;
const onlyMethod = (ks, m) => ks.length > 0 && ks.every((k) => { const p = k.access_key.permission; return p !== 'FullAccess' && p.FunctionCall && p.FunctionCall.receiver_id === C && JSON.stringify(p.FunctionCall.method_names) === JSON.stringify([m]); });
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`); if (!ok) fails++; };
console.log(`Agent Allowance self-test on NEAR testnet, contract ${C}\n`);
// ---- rules.json (shared jailbreak rules): offline checks
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'rules.json'), 'utf8'));
  const rules = compileRules(cfg);
  const total = (cfg.phrases || []).length + (cfg.patterns || []).length;
  check('rules.json loads and every rule compiles', rules.length === total, `${rules.length} rules`);
  check('real screening reads rules.json', RULES_SOURCE === 'rules.json');
  const hit = (x) => rules.some(([re]) => re.test(x));
  const missed = (cfg.examples?.block || []).filter((x) => !hit(x));
  const falsePos = (cfg.examples?.allow || []).filter((x) => hit(x));
  check('every attack example is caught', missed.length === 0, missed.join(' | '));
  check('no normal invoice example is blocked', falsePos.length === 0, falsePos.join(' | '));
} catch (e) { check('rules.json readable', false, e.message); }

try {
  const p = await view('get_policy');
  check('contract answers get_policy', !!p.owner, p.owner);
  check('owner, agent and guardian are three different accounts', new Set([p.owner, p.agent, p.guardian]).size === 3);
  check('agent and guardian accounts match the expected ones', p.agent === A && p.guardian === G);
  const per = BigInt(p.per_tx), day = BigInt(p.daily), th = BigInt(p.approval_threshold);
  check('limits are ordered: auto-approve <= per-payment <= daily', th <= per && per <= day);
  check('every trusted vendor cap is within the per-payment cap', (p.payees || []).every((a) => !p.payee_caps?.[a] || BigInt(p.payee_caps[a]) <= per));
  check('spending today does not exceed the daily limit', BigInt(p.spent_today) <= day);
  check('treasury holds funds', BigInt(p.balance) > 0n);
  check('agent key can ONLY call "pay" on the contract', onlyMethod(await keys(A), 'pay'));
  check('guardian key can ONLY call "freeze" on the contract', onlyMethod(await keys(G), 'freeze'));
  const log = await view('get_log');
  check('event log is readable', Array.isArray(log), `${log.length} events`);
  check('log shows refused or held payments (BLOCKED, QUEUED or FROZEN)', log.some((l) => /BLOCKED|QUEUED|FROZEN/.test(l)));
} catch (e) { check('unexpected error', false, e.message); }
console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
