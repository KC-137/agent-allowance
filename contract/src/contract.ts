import { NearBindgen, near, call, view, initialize, assert, NearPromise } from 'near-sdk-js';

const DAY_NS = 86_400_000_000_000n;
const EXPIRY_NS = DAY_NS; // a held payment expires after 24 hours
const MAX_PENDING = 20; // at most 20 held payments at once

type Pending = { id: number; to: string; amount: string; memo: string; reason: string; t: string; approvals: string[] };

/**
 * Agent Allowance: the hard spending boundary for an AI agent.
 * Amounts are yoctoNEAR strings.
 * Roles: owner (human), agent (AI, can only call pay), guardian (AI monitor, can only freeze), approvers (humans).
 * The AI is advisory; this contract is the boundary.
 */
@NearBindgen({})
export class Allowance {
  owner = ''; agent = ''; guardian = '';
  per_tx = '0'; daily = '0'; approval_threshold = '0';
  spent = '0'; day = 0; paused = false;
  payees: string[] = [];
  payee_caps: Record<string, string> = {};
  pending: Pending[] = [];
  next_id = 1;
  approvers: string[] = [];
  required = 1;
  log: string[] = [];

  @initialize({})
  init({ owner, agent, guardian, per_tx, daily, approval_threshold }: { owner: string; agent: string; guardian: string; per_tx: string; daily: string; approval_threshold: string }) {
    this.owner = owner; this.agent = agent; this.guardian = guardian;
    this.per_tx = per_tx; this.daily = daily; this.approval_threshold = approval_threshold;
  }

  /** Fills fields missing from state saved by an older version, so redeploys never crash. */
  private fix() {
    if (!this.payees) this.payees = [];
    if (!this.payee_caps) this.payee_caps = {};
    if (!this.pending) this.pending = [];
    if (!this.next_id) this.next_id = 1;
    if (!this.log) this.log = [];
    if (!this.approval_threshold) this.approval_threshold = '0';
    if (!this.approvers) this.approvers = [];
    if (!this.required) this.required = 1;
  }

  private isApprover(who: string) { return who === this.owner || this.approvers.includes(who); }
  private onlyOwner() { assert(near.predecessorAccountId() === this.owner, 'owner only'); }
  private record(s: string) { this.log.push(`${near.blockTimestamp()}|${s}`); if (this.log.length > 50) this.log.shift(); }
  private rollDay() {
    const d = Number(near.blockTimestamp() / DAY_NS);
    if (d !== this.day) { this.day = d; this.spent = '0'; }
  }
  /** Rule violations are logged (not reverted) so blocked attempts stay visible. */
  private block(to: string, amount: string, reason: string, memo: string) {
    this.record(`BLOCKED ${amount} -> ${to} (${reason}) memo="${memo}"`);
    return `BLOCKED: ${reason}`;
  }

  @call({})
  add_payee({ account, cap }: { account: string; cap?: string }) {
    this.fix(); this.onlyOwner();
    if (!this.payees.includes(account)) this.payees.push(account);
    if (cap) this.payee_caps[account] = cap;
  }

  @call({})
  remove_payee({ account }: { account: string }) {
    this.fix(); this.onlyOwner();
    this.payees = this.payees.filter((p) => p !== account);
    delete this.payee_caps[account];
  }

  @call({})
  set_limits({ per_tx, daily, approval_threshold }: { per_tx: string; daily: string; approval_threshold?: string }) {
    this.fix(); this.onlyOwner();
    this.per_tx = per_tx; this.daily = daily;
    if (approval_threshold) this.approval_threshold = approval_threshold;
  }

  @call({})
  freeze({ reason }: { reason: string }) {
    this.fix();
    const who = near.predecessorAccountId();
    assert(who === this.owner || who === this.guardian, 'owner or guardian only');
    this.paused = true;
    this.record(`FROZEN by ${who}: ${String(reason).slice(0, 120)}`);
  }

  @call({})
  unfreeze({}: {}) {
    this.fix(); this.onlyOwner();
    this.paused = false;
    this.record('UNFROZEN by owner');
  }

  /**
   * Agent calls this. Order of checks: frozen, per-payment cap, vendor cap (all BLOCKED),
   * then unknown payee or above the auto-approve limit (QUEUED for a human), then daily limit (BLOCKED), else PAID.
   */
  @call({})
  pay({ to, amount, memo }: { to: string; amount: string; memo: string }) {
    this.fix();
    assert(near.predecessorAccountId() === this.agent, 'agent only');
    const amt = BigInt(amount);
    assert(amt > 0n, 'amount must be positive');
    const m = String(memo || '').replace(/[|"]/g, "'").slice(0, 120);
    const now = near.blockTimestamp();
    this.pending = this.pending.filter((p) => now - BigInt(p.t) <= EXPIRY_NS);
    this.rollDay();
    const trusted = this.payees.includes(to);
    const cap = this.payee_caps[to];
    if (this.paused) return this.block(to, amount, 'contract is frozen', m);
    if (amt > BigInt(this.per_tx)) return this.block(to, amount, 'over per-payment cap', m);
    if (trusted && cap && amt > BigInt(cap)) return this.block(to, amount, "over this payee's cap", m);
    const reason = !trusted ? 'payee is not on the trusted list' : amt > BigInt(this.approval_threshold) ? 'amount is above the auto-approve limit' : '';
    if (reason) {
      if (this.pending.length >= MAX_PENDING) return this.block(to, amount, 'approval queue is full', m);
      const id = this.next_id++;
      this.pending.push({ id, to, amount, memo: m, reason, t: now.toString(), approvals: [] });
      this.record(`QUEUED #${id} ${amount} -> ${to} (${reason}) memo="${m}"`);
      return `PENDING:${id}`;
    }
    if (BigInt(this.spent) + amt > BigInt(this.daily)) return this.block(to, amount, 'over daily limit', m);
    this.spent = (BigInt(this.spent) + amt).toString();
    this.record(`PAID ${amount} -> ${to} memo="${m}"`);
    return NearPromise.new(to).transfer(amt);
  }

  @call({})
  set_approvers({ accounts, required }: { accounts: string[]; required: number }) {
    this.fix(); this.onlyOwner();
    const all = new Set([this.owner, ...accounts]);
    assert(required >= 1 && required <= all.size, 'required must be between 1 and the number of approvers');
    this.approvers = accounts.filter((a) => a !== this.owner);
    this.required = required;
    this.record(`APPROVERS set: ${all.size} people, ${required} approval(s) needed`);
  }

  /** Owner or an approver. Each approver counts once. The money moves when enough approvals are in. */
  @call({})
  approve({ id }: { id: number }) {
    this.fix();
    const who = near.predecessorAccountId();
    assert(this.isApprover(who), 'approvers only');
    const i = this.pending.findIndex((p) => p.id === id);
    assert(i >= 0, 'no such pending request (it may have expired)');
    const p = this.pending[i];
    assert(near.blockTimestamp() - BigInt(p.t) <= EXPIRY_NS, 'request expired');
    assert(!this.paused, 'contract is frozen');
    if (!p.approvals) p.approvals = [];
    assert(!p.approvals.includes(who), 'you already approved this request');
    p.approvals.push(who);
    const need = Math.max(1, this.required);
    if (p.approvals.length < need) {
      this.record(`APPROVAL #${id} by ${who} (${p.approvals.length} of ${need}) still waiting for more`);
      return `WAITING: ${p.approvals.length} of ${need} approvals`;
    }
    this.rollDay();
    const amt = BigInt(p.amount);
    assert(BigInt(this.spent) + amt <= BigInt(this.daily), 'would exceed the daily limit');
    this.pending.splice(i, 1);
    this.spent = (BigInt(this.spent) + amt).toString();
    this.record(`APPROVED #${id} ${p.amount} -> ${p.to} (${p.approvals.length} approvals) memo="${p.memo}"`);
    return NearPromise.new(p.to).transfer(amt);
  }

  /** Any approver can veto a held payment. */
  @call({})
  reject({ id }: { id: number }) {
    this.fix();
    const who = near.predecessorAccountId();
    assert(this.isApprover(who), 'approvers only');
    const i = this.pending.findIndex((p) => p.id === id);
    assert(i >= 0, 'no such pending request');
    const p = this.pending.splice(i, 1)[0];
    this.record(`REJECTED #${id} by ${who} ${p.amount} -> ${p.to}`);
  }

  @view({})
  get_policy() {
    this.fix();
    return {
      owner: this.owner, agent: this.agent, guardian: this.guardian,
      per_tx: this.per_tx, daily: this.daily, approval_threshold: this.approval_threshold,
      approvers: this.approvers, required: this.required,
      spent_today: this.spent, paused: this.paused,
      payees: this.payees, payee_caps: this.payee_caps,
      balance: near.accountBalance().toString(),
    };
  }

  @view({})
  get_pending() { this.fix(); return this.pending; }

  @view({})
  get_log() { this.fix(); return this.log; }
}
