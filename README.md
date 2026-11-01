Agent Allowance

Built for NEAR HACKATHON. Primary track: security.

Problem

AI agents that hold money can be tricked (prompt injection, spoofed invoices) into paying the wrong party. An AI "safety check" alone is not a defence, because the checking model can be fooled too. People need to give an agent a budget without giving it the keys to everything.

What was built

A NEAR smart contract that acts as the agent's wallet rules, plus an AI guardian, a human approval tool and a live dashboard.

The contract (the part that cannot be talked around):

Trusted payees with an optional maximum per payment each.
Per-payment cap and daily limit for everything.
Auto-approve limit: a trusted payee above it, or any unknown payee, is queued for a human instead of paid.
Freeze switch the guardian or owner can pull. Only the owner can unfreeze.
Roles: owner (human, sets rules and approves), agent (can only call pay), guardian (can only freeze).
Queued requests expire after 24 hours. Every outcome (PAID, QUEUED, BLOCKED, APPROVED, REJECTED, FROZEN) is written to an on-chain log.

The AI guardian (advisory, can only make things stricter):

Free rules first: jailbreak phrases, requests to move everything, secrets, urgency pressure, hidden unicode, addresses that differ from the payee.
Then a chain of free-tier AI providers (Gemini, Groq, Cloudflare Workers AI, OpenRouter :free models) with automatic fallback, cooldowns, a 24h cache and a daily call budget.
The most cautious verdict wins. If either layer says block, the guardian freezes the contract. If every provider is down, the rules still run and the contract rules still apply.

Human approval: scripts/review.mjs lists waiting requests in plain English ("Send 1.2 NEAR to vendor for 'Invoice 1045'. Needs you because: amount is above the auto-approve limit") and approves or rejects them.

Dashboard: index.html shows spend against the limit, frozen state, trusted payees, requests waiting for approval and every logged event.

How NEAR is used

Separate named accounts for each role, a near-sdk-js contract that holds the treasury and sends payments through promises, near-api-js for the agent, guardian and owner, and public testnet RPC for the dashboard. Everything runs on testnet only.

Live deployment (testnet)
Contract: contract2-nelson.testnet
Dashboard (live, read-only): https://kc-137.github.io/agent-allowance/?c=contract2-nelson.testnet
Real transactions from the demo run:
Small invoice, trusted vendor: PAID
Injection to unknown address: QUEUED
Valid invoice while frozen: BLOCKED
Owner rejects the suspicious request
1.8 NEAR to vendor: BLOCKED (over vendor cap)
1.2 NEAR to vendor: QUEUED
Owner approves it: PAID
Verify it (do X → see Y)

Fastest, no setup: open the live dashboard. The Activity list shows the PAID / QUEUED / BLOCKED / APPROVED / REJECTED events above, matching the transaction links.

Run it yourself (testnet only):

1. Install Node 20.6+ and npm i -g near-cli-rs. Create six testnet accounts with near account create-account sponsor-by-faucet-service NAME.testnet autogenerate-new-keypair --signature-scheme ed25519 save-to-keychain network-config testnet create for: owner, contract, agent, guardian, vendor, attacker. Export keys for owner, contract, agent and guardian with near account export-account NAME.testnet.
2. Copy .env.example to .env and fill it in. A prebuilt contract/build/allowance.wasm is included (building needs Linux or WSL).
3. cd scripts && npm i && node --env-file=../.env setup.mjs deploys the contract and sets the rules (2 NEAR per payment, 5 NEAR per day, auto-approve up to 1 NEAR, vendor trusted up to 1.5 NEAR).
4. node --env-file=../.env demo.mjs runs five scenarios:
  1. Small invoice to the trusted vendor → PAID.
  2. Prompt injection to an unknown address → AI says BLOCK, contract logs QUEUED, guardian freezes.
  3. Valid invoice while frozen → BLOCKED (contract is frozen).
  4. Owner unfreezes and rejects the suspicious request, then 1.8 NEAR to the vendor → BLOCKED (over this payee's cap).
  5. 1.2 NEAR to the vendor → QUEUED; the owner approves → APPROVED, paid. One demo run spends 5. 1.7 NEAR of the 5 NEAR daily limit, so run it at most twice per day (the limit resets daily). 6. The demo needs a funded contract: setup.mjs tops it up if it is low.
node --env-file=../.env review.mjs lists anything waiting for the owner. Use review.mjs approve ID or review.mjs reject ID to decide.
node --env-file=../.env test-ai.mjs checks each AI provider on its own.
Free tools / APIs ($0)

NEAR testnet and faucet, FastNEAR public testnet RPC, near-sdk-js, near-api-js, near-cli-rs, Gemini / Groq / OpenRouter free models / Cloudflare Workers AI free tier (any subset; all optional), GitHub. No local AI models, no paid services.

Design note

The AI is advisory; the contract is the boundary. A fully compromised agent still cannot pay an unlisted account without a human, exceed the caps, or pay while frozen.

Honest scope
- Testnet prototype, NEAR only (no stablecoins or NEAR Intents yet).
- One agent per contract.
