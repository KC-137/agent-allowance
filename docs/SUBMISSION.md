# Submission payload (review before sending: one attempt, cannot be edited)

- **Project name:** AgentAllowance
- **Team lead name:** <YOUR NAME>
- **Contact email:** <YOUR EMAIL>
- **Team size:** 1
- **Tracks:** security, agents, business
- **NEAR mainnet account (payout):** <YOUR mainnet.near ADDRESS>  (testnet is NOT valid here)
- **Repository URL:** https://github.com/<USER>/agent-allowance
- **X demo post URL:** <URL after posting>
- **Consent:** tick the box

## Project description (~700 characters, limit 2000)
AgentAllowance is a spending boundary for AI agents on NEAR. Agents that hold money can be tricked by prompt injection into paying the wrong party, and an AI safety check alone can be fooled too. Our NEAR smart contract enforces hard rules on-chain: a payee allowlist, per-payment cap, daily limit and a freeze switch, with separate owner, agent and guardian roles. A free-tier Gemini guardian screens each instruction and freezes the contract on suspected injection, with a heuristic fallback. A live dashboard shows spend against limits and every PAID, BLOCKED and FROZEN event. Even a fully compromised agent cannot pay an unlisted account or exceed its caps. Runs on NEAR testnet at zero cost, with step-by-step verification in the README.

## X post (under 280 chars)
Built for NEAR HACKATHON: AgentAllowance 🛡️
AI agents can be tricked into sending money. Ours can't: a NEAR contract enforces allowlist, caps and a freeze switch, while an AI guardian flags prompt injection.
Demo below 👇
Code: github.com/<USER>/agent-allowance
#NEARHACKATHON

## Demo recording script (~60s)
1. (5s) Dashboard: Active, 0 of 5 NEAR spent.
2. (10s) Run `node demo.mjs`; step 1 shows PAID.
3. (15s) Step 2: injection text, AI says BLOCK, contract logs BLOCKED, guardian freezes.
4. (10s) Steps 3 and 4: frozen block, then over-cap block.
5. (15s) Refresh dashboard: Activity list matches, meter at 0.5 NEAR.
6. (5s) Close on README "Verify it" section.
Screenshots: dashboard after demo; terminal output of the four steps.
