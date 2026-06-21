# AidLink — privacy-preserving disaster-relief disbursement on Terminal 3

**Submission for the Terminal 3 Agent Dev Kit Bounty.**

After a disaster, a **government verification agent** and an **NGO disbursement agent**
jointly confirm a beneficiary's eligibility and pay them out — **without either agent (or
its operator) ever seeing the beneficiary's raw bank account number**, and without sharing
raw data across the tenant boundary. If a beneficiary has no phone, a local volunteer gets
a **single-use, time-boxed, auto-revocable** delegation instead of being handed the
beneficiary's ID or bank details. Every action lands in a tamper-evident audit ledger.

Built on the Terminal 3 **Agent Auth SDK** (`@terminal3/t3n-sdk@3.9.0`) + a Rust→WASM TEE
contract. We deliberately target a **fifth, undemoed vertical** (disaster relief) — not one
of T3's four reference agents (payroll, procurement, e-visa, travel).

---

## Status (2026-06-22)

- ✅ **Everything that defines the privacy + delegation guarantees is built and verified
  locally** — the Rust→WASM contract, both phases' test suites, and the payout endpoint
  behavior (see [What's proven locally](#whats-proven-locally)).
- ✅ **The live sandbox connection is proven** — `yarn auth-gate` completes a real
  `handshake → authenticate → getUsage` against `cn-api.sg.testnet.t3n.terminal3.io` and
  returns our DID + balance.
- ⛔ **The metered live run is blocked by a platform-side token-grant bug, not by missing
  work.** The testnet welcome grant was minted **1,000,000× short** — `0.04` tokens
  (39,989 base units) instead of the promised ~20,000 tokens — so there isn't enough
  balance to register a contract or run one invocation. Diagnosed to the exact factor,
  reported to `devrel@terminal3.io` on **2026-06-20** (see
  [`BUGS.md` BUG-005](./BUGS.md)); no resolution as of submission. Every metered script is
  **guarded** and runs unchanged the moment a real balance lands.

> This is a bug we **found, diagnosed, reported, and engineered around** — it's a headline
> of our developer-log track ([`BUGS.md`](./BUGS.md), 12 entries), not a gap in the build.

---

## What's proven locally

All zero-sandbox, runnable today:

```bash
# 1) The TEE contract compiles to a real WASM component and links the right host caps
cd contract && cargo test                                   # 11/11 native unit tests + doctest
cargo build --target wasm32-wasip2 --release                # -> aidlink.wasm (173 KB)
wasm-tools component wit target/wasm32-wasip2/release/aidlink.wasm
#   imports: tenant-context, logging, kv-store, http-with-placeholders
#   exports: z:aidlink/contracts@0.1.0 {check-eligibility, disburse-payout, probe-placeholder}

# 2) The payout endpoint enforces the privacy boundary itself
cd ../app && yarn mock-payout      # then POST a resolved acct -> {"account_masked":"****6819","status":"paid"}
#   a body still containing {{profile.bank_account}} -> HTTP 422 unresolved_placeholder

# 3) Phase 2 — real SDK delegation crypto + cross-tenant control flow, offline
yarn tsx --test tests/phase2-delegation.local.test.ts \
                tests/phase2-cross-tenant.mocked.test.ts \
                tests/audit.local.test.ts                   # 12/12 pass
```

**Privacy guarantee is structural, not asserted:**
- The contract can only ever emit `{{profile.bank_account}}` — a unit test
  (`placeholders_are_templates_not_real_values`) fails if a literal account number appears.
- `disburse-payout` **rejects** any request that tries to pass an account inline
  (`inline_bank_account_is_rejected`).
- The payout endpoint **rejects** any body still containing `{{profile.*}}` markers — so if
  host substitution ever fails, the integration test breaks loudly instead of paying a
  template.

**Phase 2 delegation is proven with the real SDK primitives (no mocks):** a credential that
is time-boxed (`not_after = not_before + window`), function-scoped (sorted/deduped), and
whose beneficiary signature recovers to the beneficiary's own address via `ethRecoverEip191`.

---

## Feature → SDK capability map (integration depth)

Each AidLink feature and the exact Terminal 3 SDK / host capability it exercises:

| AidLink feature | SDK / host capability | Where |
|---|---|---|
| Auth handshake → DID (**proven live**) | `T3nClient` · `handshake()` · `authenticate(createEthAuthInput)` · `getUsage()` | `src/auth-gate.ts`, `src/lib/client.ts` |
| Two-agent tenant split | `TenantClient` per DID (verification A / disbursement B) | `src/lib/agents.ts` |
| Eligibility store (private, default-deny) | `tenant.maps.create({ visibility, writers, readers })` → `z:<tid>:eligibility` | `src/provision.ts` |
| Endpoint secret seeding | `tenant.executeControl("map-entry-set", …)` → `z:<tid>:secrets` | `src/provision.ts` |
| Contract lifecycle | `tenant.contracts.register({ tail, version, wasm })` | `src/provision.ts` |
| Contract invocation | `client.executeAndDecode({ script_name, script_version, function_name, input, pii_did })` | `src/invoke.ts` |
| **Cross-tenant** eligibility check | `tenant.executeBusinessContract({ tenant, contract, functionName, input })` | `src/phase2-cross-tenant.ts`, `src/lib/orchestration.ts` |
| **PII-safe payout** (account never in WASM) | host `http-with-placeholders@2.1.0` + `{{profile.*}}` markers | `contract/src/payout.rs` |
| Cheapest first live check | one isolated `http-with-placeholders` call, one templated field | `contract/src/probe.rs`, `src/invoke.ts` |
| KV eligibility lookup | host `kv-store@2.1.0` · `tenant-context::tenant-did()` | `contract/src/eligibility.rs` |
| **Human-helper delegation** (time-boxed, scoped) | `buildDelegationCredential` · `signCredential` · `validateCredentialBody` | `src/lib/delegation.ts` |
| Delegation **revoke** (user-only) | `revokeDelegation` (wraps `tee:delegation/contracts::revoke`) | `src/lib/delegation.ts` |
| Tamper-evident audit ledger | SHA-256 hash chain over every action | `src/lib/audit.ts` |

---

## The two phases

### Phase 1 — minimum complete (single contract)
One Rust→WASM contract: KV eligibility lookup + a `http-with-placeholders` payout whose
payee/account fields are `{{profile.*}}` markers resolved host-side. Built, unit-tested,
WASM-linked; provisioning + invocation staged behind the metered guard.

### Phase 2 — the differentiator (two tenants + delegation)
- **Tenant split + cross-tenant call:** the disbursement agent (B) reaches the verification
  agent (A) *only* via `executeBusinessContract` — a real boundary, not two functions in one
  contract. Control flow proven: **a denied eligibility never reaches payout.**
- **Human-helper delegation:** beneficiary builds + signs a time-boxed, function-scoped
  credential; the helper acts once while live; the beneficiary `revokeDelegation`s; the next
  attempt is denied (`NotCredentialHolder`). All SDK-native (corrected from an initial
  "dashboard-only" reading — see [`BUGS.md` BUG-001](./BUGS.md)).

**Definition of done (success case via SDK, failure case proven via SDK):** the eligibility
check crosses a tenant boundary, and a helper completes one action within its grant window
and is denied after revocation. The credential build/sign/scope/time-box and the
cross-tenant call shape + refuse-or-pay control flow are verified offline today; the live
success→revoke→denial arc runs via `src/phase2-delegation.ts` once a balance lands.

---

## Repo layout

```
contract/                 Rust → WASM TEE contract (wasm32-wasip2)
  wit/world.wit           z:aidlink world: check-eligibility, disburse-payout, probe-placeholder
  wit/deps/               real host-interfaces@2.1.0 + host:tenant@1.0.0 (from Terminal-3/z-tenant-flight)
  src/{eligibility,payout,probe}.rs
app/
  src/lib/{client,agents,delegation,orchestration,audit}.ts
  src/{auth-gate,check-balance,account-status,provision,invoke}.ts
  src/{phase2-cross-tenant,phase2-delegation}.ts
  mock-payout/server.ts   PII-boundary-enforcing payout + /echo probe endpoint
  tests/                  *.local (offline) · *.mocked (SDK boundary) · *.integration (live)
BUGS.md                   developer log — 12 bug/doc-gap findings (bug-bounty track)
docs/DEMO_DRAFT.md        ~2-min demo narrative (draft)
```

Test naming makes the boundary explicit: **`*.local.test.ts`** = no sandbox / nothing
mocked (real SDK crypto offline); **`*.mocked.test.ts`** = SDK-client boundary mocked
(network-level mocking is impossible end-to-end because the WASM handshake rejects
non-cryptographic fixtures); **`*.integration.test.ts`** = hits the live testnet (metered,
guarded).

---

## Running it

```bash
# Prereqs: Node ≥18, Rust + `rustup target add wasm32-wasip2`, `cargo install wasm-tools`, yarn
cd app && yarn install
cp .env.example .env       # set T3N_API_KEY (+ T3N_API_KEY_A/_B, T3N_HELPER_KEY for Phase 2)

# Local (no tokens):
cd ../contract && cargo test && cargo build --target wasm32-wasip2 --release
cd ../app && yarn typecheck
yarn tsx --test tests/phase2-delegation.local.test.ts tests/phase2-cross-tenant.mocked.test.ts tests/audit.local.test.ts
yarn mock-payout           # in another shell

# Live sandbox (proven): real DID + balance
yarn auth-gate

# Live metered (blocked on BUG-005 — guarded; runs unchanged when a balance lands):
AIDLINK_CONFIRM_METERED=1 yarn provision
AIDLINK_CONFIRM_METERED=1 yarn invoke          # first spend = cheap probe-placeholder
AIDLINK_CONFIRM_METERED=1 yarn tsx src/phase2-cross-tenant.ts
AIDLINK_CONFIRM_METERED=1 yarn tsx src/phase2-delegation.ts
```

---

## Developer log (bug-bounty track) — [`BUGS.md`](./BUGS.md)

12 grounded findings, each with what we tried, the exact doc citation / error output, why
it matters, and a suggested fix. Highlights:

- **BUG-001** — the SDK ships a full programmatic delegation/grant/revoke API
  (`buildDelegationCredential`/`signCredential`/`revokeDelegation`) that the docs describe as
  dashboard-only / "coming soon."
- **BUG-005** — testnet welcome grant minted 1,000,000× short (base units vs tokens); exact
  `getUsage()` payload + the persistence of the bug through a top-up.
- **BUG-010** — the egress allow-list is described three contradictory ways (per-user
  `agent_auth` grant vs per-contract `http_allow_list` vs `authorised_hosts`).
- **BUG-011** — the official `z-tenant-flight` reference repo's README contradicts its own
  code on the privacy model, the capability manifest, and the version.
- **BUG-012** — delegation credential `contract` field rejects z-tenant script names
  (`ContractTooLong`); only short system-contract ids fit.

(Also: missing OpenAPI spec, undocumented resolved-profile schema, no documented test-user
onboarding path, untyped-vs-typed error docs, snake_case vs PascalCase error codes,
metered-vs-free read opacity.)

---

## Live-run prerequisites (when the balance lands)

Tracked in `BUGS.md`; none blocks the local proof:
1. A real token balance (BUG-005).
2. The payout endpoint exposed publicly (tunnel) + its host on the egress allow-list — whose
   mechanism is itself under-documented (BUG-010).
3. A beneficiary with a populated profile + grant; for Phase 1 we use the self-call shortcut
   (`pii_did` = our own DID) to avoid a cross-user grant (BUG-007). The DID's profile is
   already partially populated (`first_name`/`last_name` confirmed via the dashboard), so the
   first live check — `probe-placeholder` on `{{profile.first_name}}` — should resolve
   without any profile write. The raw bank-account field still needs the BUG-006 fallback.

The first live action is deliberately the cheapest isolated check (`probe-placeholder`,
one host call) to confirm placeholder resolution before spending further.
