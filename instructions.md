1) Goal (one-liner)

Build an Omnichain Incentives/Rewards App that lets an admin schedule payouts denominated in USD and delivers equivalent value in a token and chain chosen by the recipient — implemented on ZetaChain and demoed with at least one working cross-chain transaction (source + destination tx hashes in README).

2) MVP feature list (must-have)
- Admin can fund a reward pool (on ZetaChain testnet).
- Admin can create a payout instruction: {recipientAddr, destChainId, -destTokenAddr, amountUSD, deadline, idempotencyKey}.
- Contract converts amountUSD → token amount using an on-chain oracle (staleness + deviation checks).
- Contract performs cross-chain delivery using ZetaChain primitives.
- onCall, onRevert, onAbort handlers implemented (universal app behavior).
- Safe fallback/refund logic for failed transfers.
- At least one successful end-to-end cross-chain demo recorded with source and destination tx hashes.
- README with overview, contract addresses, build/run/test instructions, and the tx links.

3) Nice-to-have (bonus)

- Recipient chooses token from a whitelist (USDC/USDT/ETH equivalent).
- Batching payouts to save gas.
- Simple React demo UI with wallet connect + “claim payout” flow.
- Logging/analytics page showing payout status.
- CI that runs unit tests & solidity-lint on push.

4) Tech stack & tools (this is only the recommended stack; the agent can choose alternatives if justified)
- Hardhat (dev, compile, test, deploy)
- Solidity ^0.8.x
- Ethers.js (scripts & frontend)
- ZetaChain SDK / contracts (use official package from Zeta docs — do not invent package name; fetch exact package name before coding)
- On-chain price feed (Pyth or Chainlink on supported testnets) — verify available feeds for your chosen testnets before coding
- React + Next.js (optional frontend)
- Node.js, npm/yarn
- TypeScript (optional for scripts & frontend)
- Git for versioning, GitHub for repo & Actions
- Important: The agent must fetch and follow the official ZetaChain SDK / docs at the start of implementation. Do not assume function names beyond what is present in the official docs.

5) High-level architecture (short)

- ZetaChain Universal Smart Contract (core): scheduling, oracle check, -initiating cross-chain transfers; implements onCall, onRevert, onAbort.
- Admin scripts (Hardhat scripts): fund pool, schedule payout.
- Destination contract (simple receiver deployed to destination testnet) — logs events on receipt; used to prove transfer.
- Optional frontend: allow admin and recipient actions.
- Monitoring: CI/test scripts that check logs and capture tx hashes.

6) rules for the agent (to avoid hallucination, limits, bugs)
Before writing code:
- Fetch official docs: Query ZetaChain docs & SDK (copy links and the exact function signatures for onCall, onRevert, onAbort) and paste them in repo docs/ before generating contracts. Do not invent API names.
- Fetch oracle docs: confirm Pyth/Chainlink availability + contract addresses for chosen testnets. Put addresses into configs/testnet-config.json.
Coding rules:
- Write modular, well-commented code.
Put any unknown external names/addresses as clearly labeled placeholders in a single file CONFIG.md and DO NOT hardcode actual addresses until verified.
- All changes must be atomic, small commits (feat: / fix: / test:) and include short descriptions.
- Use linters (solhint) and prettier for formatting. Failing lint must block CI.
- Include explicit sanity checks in contracts: require(oracleIsFresh(), "stale-oracle"), require(amount > 0), validateAddress() helpers.
- Always add events for critical actions (PayoutScheduled, PayoutSent, PayoutReverted, RefundIssued). Events are the primary way to locate destination txs.
- Implement idempotency with an idempotencyKey set per payout to avoid duplicate processing.
- For any external HTTP or RPC calls (oracles, explorer APIs), implement retry with exponential backoff and respect rate-limit headers. Cache results for short TTL to avoid repeated queries.
- Do not generate or store private keys in repo — use .env and hardhat local network secrets. Provide .env.example.
- For interactions with ZetaChain SDK, wrap SDK calls and log both request & response (for debugging).
- All testnet deployments must be deterministic (tag addresses in results/deployments.json).
Testing & deployment:
- Run unit tests and local integration tests on Hardhat network with mocks before any testnet interaction.
- Perform integration tests with mocked ZetaChain endpoints first — only after passing, run on real testnet.
- For testnet/integration runs, throttle the number of outbound calls to 1 per 1–2 seconds to avoid provider limits.
- All PRs must pass CI and include steps to reproduce the demo locally.

7) Repository layout (recommended)

    /omnirewards
    /contracts
        OmniRewards.sol
        OmniReceiver.sol
        Mocks/
        MockOracle.sol
        MockZetaEndpoint.sol
    /scripts
        deploy.js
        fundPool.js
        schedulePayout.js
        watchDestination.js
    /test
        unit/
        integration/
    /frontend (optional)
        /src
        pages/index.tsx
    /configs
        testnet-config.json
    .env.example
    hardhat.config.js
    package.json
    README.md
    DEPLOYMENTS.md
    docs/ (official docs/summaries fetched by agent)

    
8) Step-by-step tasks (smallest actionable todos in ascending order):
Each numbered step is atomic. Complete step N before starting N+1.

Phase 0 — Setup & reconnaissance
    -Create repo & initial commit. Add .gitignore, .env.example.
    -(Fetch docs) Download & save official ZetaChain SDK docs and price-feed docs into docs/ folder. Record exact function signatures and any required imports into docs/README.md.
    -Initialize NPM, install Hardhat and dev dependencies: npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox ethers solhint prettier.
    -Create testnet-config.json with placeholders for: zetaEndpointAddress, chainIds, oracleAddresses, whitelisted tokens.

Phase 1 — Local development scaffolding & tests
    -Write a MockZetaEndpoint.sol and MockOracle.sol that emulate ZetaChain messaging and oracle behavior. (Agent must create robust mocks with configurable responses & delays.)
    -Write unit tests for mocks to ensure they behave (e.g., oracle staleness simulation).
    -Create OmniRewards.sol contract skeleton with function signatures and events (no logic). Include functions: fundPool(), schedulePayout(...), onCall(...), onRevert(...), onAbort(...), refund(...). Add access control modifiers (onlyAdmin).
    -Add unit tests asserting the contract skeleton compiles and exposes functions.

Phase 2 — Core on-chain logic (local)

    -Implement USD→token conversion logic using the MockOracle (simple function getTokenAmountForUSD(token, amountUSD) that reads mock oracle price and decimals). Add staleness checks.
    -Implement payout scheduling: store payout structs and ensure idempotencyKey prevents duplicates. Write unit tests that schedule payouts and assert storage.
    -Implement onCall to simulate successful cross-chain delivery using MockZetaEndpoint. Emit PayoutSent event with payoutId. Unit test: call onCall and verify PayoutSent.
    -Implement onRevert to refund or mark as failed and emit PayoutReverted. Unit test: simulate revert and assert refund behavior.
    -Implement onAbort to mark aborted and allow admin retry. Unit test accordingly.
    -Add validateAddress & input sanitizers and negative tests (invalid token, past deadline).

Phase 3 — Integration & end-to-end local tests

    -Run full integration tests locally with the MockZetaEndpoint and MockReceiver: schedule payout → trigger onCall → receiver logs receipt event. Assert emitted events & state transitions.
    -Add tests that simulate oracle staleness & price swings to assert slippage checks.

Phase 4 — Prepare for testnet

    -Create deploy.js script that uses testnet-config.json placeholders and deploys contracts to a configured network. (Do not hardcode addresses.)
    -Add fundPool.js script: shows how admin funds the contract and logs tx hash.
    -Add watchDestination.js: script to watch for events on destination chain (so you can capture destination tx hash). Uses WebSocket provider and subscribes to the receiver event.

Phase 5 — Small-scale testnet run (iterative, cautious)

    -Verify addresses & SDK imports: re-open docs/ and confirm required imports and package names for ZetaChain SDK & oracle contract addresses for chosen testnet. Replace placeholders.
    -Acquire testnet tokens (ZETA and destination chain test tokens) via faucets. Record this process in README.md.
    -Deploy contracts to ZetaChain testnet + a destination chain receiver (e.g., Polygon Mumbai). Save deployment addresses in DEPLOYMENTS.md.
    -Run fundPool.js and capture tx hash (source). Add it to DEMO.md.
    -Run schedulePayout.js to schedule a real cross-chain payout. Wait and capture source tx hash. Use watchDestination.js to find the destination receipt event tx hash. Add both hashes to README.
    -If cross-chain fails, capture revert events and use onRevert to refund; log both txs.

Phase 6 — Frontend & demo (optional)

    - Build minimal React UI: Admin page to fund & schedule; Recipient page to view & claim. Use wallet connect (Wagmi/RainbowKit). Keep UI minimal.
    - Add a “demo mode” button that triggers the sample payout so the judge can reproduce the cross-chain demo.
    
    
Phase 7 — Polish & submission
    - Ensure README has: overview, contract addresses, build/run/test instructions, exact source & destination tx hashes, a 1–2 minute demo video/GIF or step list to reproduce.
    - Run solhint/Prettier & fix all linter errors.
    - Run npm test and confirm all tests PASS.
    - Create release tag v1.0-hackathon and push to GitHub. Submit repo link.

11) How to capture & show source + destination tx hashes (for README)

- Source tx: record the tx hash returned by the scheduling or fund call: const tx = await contract.schedulePayout(...); console.log(tx.hash);

- Destination tx: either:
   - If ZetaChain SDK/relayer returns the destination tx hash in a callback/event, read and include it; OR
   - Subscribe to the event emitted by your destination contract (e.g., PayoutReceived(payoutId, amount, sender)) and record the tx hash of the transaction that emitted that event. Use provider.once(eventFilter, (log) => { console.log(log.transactionHash) }).

- Put both tx URLs (e.g., Mumbai explorer link) in README under “Cross-chain demo”.

14) CI & release steps
- Add GitHub Actions pipeline:
    npm ci
    npm run lint
    npm run test
- On successful pipeline, create GitHub release with tag hackathon-v1 and link DEMO.md.

15) Final checklist to include in README (judging criteria ready)

- Short overview & value prop
- Architectural diagram (image or ascii)
- Contract addresses (testnet) and how to verify them
- Build & run commands (exact)
- How to reproduce the demo step-by-step (include commands/scripts)
- Source tx hash and destination tx hash (links) — required
- How the project uses ZetaChain primitives & onCall/onRevert/onAbort (explicitly reference the lines of your contract)
- Test coverage summary (unit & integration)
- Future improvements & security notes

18) Deliverable & acceptance criteria for the hackathon submission
- GitHub repo with working code + README.
- Contracts deployed on supported testnets (addresses in README).
- At least one working cross-chain transaction with source + destination tx hashes in README.
- Unit & integration tests that pass.
- onCall, onRevert, onAbort are implemented and documented.