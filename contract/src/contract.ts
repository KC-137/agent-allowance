import { NearBindgen, near, call, view, initialize, assert, NearPromise } from 'near-sdk-js';

const DAY_NS = 86_400_000_000_000n;

/**
 * Agent Allowance: the hard spending boundary for an AI agent.
 * Amounts are yoctoNEAR strings. Roles: owner (human), agent (AI), guardian (AI monitor, can only freeze).
 */
@NearBindgen({})
export class Allowance {
  owner = ''; agent = ''; guardian = '';
  per_tx = '0'; daily = '0';
  spent = '0'; day = 0; paused = false;
  payees: string[] = [];
  log: string[] = [];

  @initialize({})
  init({ owner, agent, guardian, per_tx, daily }: { owner: string; agent: string; guardian: string; per_tx: string; daily: string }) {
    this.owner = owner; this.agent = agent; this.guardian = guardian;
    this.per_tx = per_tx; this.daily = daily;
  }

  private onlyOwner() { assert(near.predecessorAccountId() === this.owner, 'owner only'); }
  private record(s: string) { this.log.push(`${near.blockTimestamp()}|${s}`); if (this.log.length > 50) this.log.shift(); }

  @call({})
  add_payee({ account }: { account: string }) { this.onlyOwner(); if (!this.payees.includes(account)) this.payees.push(account); }

  @call({})
  remove_payee({ account }: { account: string }) { this.onlyOwner(); this.payees = this.payees.filter((p) => p !== account); }

  @call({})
  set_limits({ per_tx, daily }: { per_tx: string; daily: string }) { this.onlyOwner(); this.per_tx = per_tx; this.daily = daily; }

  @call({})
  freeze({ reason }: { reason: string }) {
    const who = near.predecessorAccountId();
    assert(who === this.owner || who === this.guardian, 'owner or guardian only');
    this.paused = true; this.record(`FROZEN by ${who}: ${reason}`);
  }

  @call({})
  unfreeze({}: {}) { this.onlyOwner(); this.paused = false; this.record('UNFROZEN by owner'); }

  /** Agent calls this. Rule violations are logged (not reverted) so blocked attempts stay visible. */
  @call({})
  pay({ to, amount, memo }: { to: string; amount: string; memo: string }) {
    assert(near.predecessorAccountId() === this.agent, 'agent only');
    const today = Number(near.blockTimestamp() / DAY_NS);
    if (today !== this.day) { this.day = today; this.spent = '0'; }
    const amt = BigInt(amount);
    let reason = '';
    if (this.paused) reason = 'contract is frozen';
    else if (!this.payees.includes(to)) reason = 'payee not on allowlist';
    else if (amt > BigInt(this.per_tx)) reason = 'over per-payment cap';
    else if (BigInt(this.spent) + amt > BigInt(this.daily)) reason = 'over daily limit';
    if (reason) { this.record(`BLOCKED ${amount} -> ${to} (${reason}) memo="${memo}"`); return `BLOCKED: ${reason}`; }
    this.spent = (BigInt(this.spent) + amt).toString();
    this.record(`PAID ${amount} -> ${to} memo="${memo}"`);
    return NearPromise.new(to).transfer(amt);
  }

  @view({})
  get_policy() {
    return { owner: this.owner, agent: this.agent, guardian: this.guardian, per_tx: this.per_tx, daily: this.daily,
      spent_today: this.spent, paused: this.paused, payees: this.payees, balance: near.accountBalance().toString() };
  }

  @view({})
  get_log() { return this.log; }
}
