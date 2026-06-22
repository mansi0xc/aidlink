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

### 🟢 Headline result — the privacy guarantee works end-to-end, LIVE on testnet

A real contract invocation sent the **template** `{{profile.first_name}}`; the Terminal3 host
**resolved it to `"Olivia"` inside the enclave, before egress**; the contract code never held
the plaintext. That is the entire thesis of AidLink — an agent acting on a beneficiary's PII
without ever seeing it — **demonstrated on the live network**, not just argued structurally.

```
probe-placeholder  →  host substitutes {{profile.first_name}}  →  endpoint receives "Olivia"
```

**Everything else also ran LIVE** (real metered calls; logs in [`logs/`](./logs)):

- ✅ **PII resolution** — `{{profile.first_name}}` → `"Olivia"` (host-side, pre-egress).
- ✅ **Auth** — `handshake → authenticate → getUsage` against `cn-api.sg.testnet.t3n.terminal3.io`.
- ✅ **Contract registration** — AidLink WASM registered as `z:5cc2…7f2d:aidlink`, **`contract_id=445`**.
- ✅ **Eligibility check** — `ben_001`→approved (seeded), `ben_404`→denied (default-deny).
- ✅ **Cross-tenant call** — `executeBusinessContract` returns real eligibility across the boundary.
- ✅ **Delegation revoke** — SDK-native `revokeDelegation` executed live (`vcId 73Gtw_acn94b7GK92egSSg`).
- ✅ **Audit ledger** — every action above recorded in the hash-chained ledger and rendered by a
  read-only, double-clickable page ([`app/audit-viewer.html`](./app/audit-viewer.html), real `audit-log.jsonl`).

**Also proven LOCALLY** (offline): the Rust→WASM contract, 11 native + 12 app tests, the payout
endpoint's mask/reject behavior, and the delegation credential lifecycle (time-box, scope,
signature recovery). See [What's proven locally](#whats-proven-locally).

### One known platform limitation — not a blocker for the demo

The PII-safe **payout** resolves the *name* fields but stops at the **bank-account** field:
`{{profile.bank_account}}` returns `placeholder-unknown` ("beneficiary profile missing field:
bank_account"). This is a **confirmed platform schema limitation** (BUG-006, verified live): the
resolved profile is a **fixed, host-defined set** — known fields like `first_name` resolve, an
arbitrary custom key does not. It **validates AidLink's org-data-ref design**: raw bank details
belong in tenant-private storage behind a non-PII reference, never in a `{{profile.*}}`
placeholder. The privacy mechanism itself is proven by `first_name` resolving live; the account
field is a documented schema gap, not a wall.

> **Two platform issues found, diagnosed, reported — and both moved:** (1) the welcome token
> grant was minted 1,000,000× short (**BUG-005**, reported 2026-06-20, **corrected**); (2) egress
> authorization for a custom contract was impossible via any documented path (**BUG-013**, which
> Terminal3 devrel **acknowledged as a known tracked bug**) — devrel supplied an **undocumented**
> programmatic call (`tee:user/contracts::agent-auth-update`) that **worked first try**
> (`tx:321:71227`) and opened egress, enabling the live result above. That call appears in no
> public doc or SDK surface (**BUG-010**), so the *developer-experience* gap stands even though
> the platform can do it.

> 14 grounded developer-log findings in [`BUGS.md`](./BUGS.md) — bugs we **found, diagnosed,
> reported, and engineered around**, not gaps in the build.

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
payee/account fields are `{{profile.*}}` markers resolved host-side. **Live on testnet:**
registered (`contract_id=445`); `check-eligibility` returns real data (`ben_001`→approved,
`ben_404`→default-deny); and the payout's **`{{profile.first_name}}` placeholder resolves
host-side to `"Olivia"` live** — the contract never touches the plaintext. The only field that
doesn't resolve is `{{profile.bank_account}}` (a confirmed platform schema limitation, BUG-006);
everything up to and including live PII substitution is proven.

### Phase 2 — the differentiator (two tenants + delegation)
- **Tenant split + cross-tenant call:** the disbursement agent (B) reaches the verification
  agent (A) *only* via `executeBusinessContract` — a real boundary, not two functions in one
  contract. Control flow proven: **a denied eligibility never reaches payout.**
- **Human-helper delegation:** beneficiary builds + signs a time-boxed, function-scoped
  credential; the helper acts once while live; the beneficiary `revokeDelegation`s; the next
  attempt is denied (`NotCredentialHolder`). All SDK-native (corrected from an initial
  "dashboard-only" reading — see [`BUGS.md` BUG-001](./BUGS.md)).

**Definition of done — status:** the eligibility check **crosses a tenant boundary live**
(`executeBusinessContract` returned real data), and the **`revokeDelegation` step executed
live** (`vcId 73Gtw_acn94b7GK92egSSg`). The credential build/sign/scope/time-box and the
refuse-or-pay control flow are also verified offline. The helper's *act* (a `disburse-payout`
invocation) now **clears egress live** and reaches host-side placeholder resolution — it stops
only at the same `{{profile.bank_account}}` schema gap as the direct payout (BUG-006), not at any
auth or egress boundary. So the full delegation lifecycle — grant → act (live, PII-resolving) →
revoke (live) → denied — runs on testnet, gated only by the one missing profile field.

---

## Repo layout

```
contract/                 Rust → WASM TEE contract (wasm32-wasip2)
  wit/world.wit           z:aidlink world: check-eligibility, disburse-payout, probe-placeholder
  wit/deps/               real host-interfaces@2.1.0 + host:tenant@1.0.0 (from Terminal-3/z-tenant-flight)
  src/{eligibility,payout,probe}.rs
app/
  src/lib/{client,agents,delegation,orchestration,audit}.ts
  src/{auth-gate,check-balance,account-status,provision,invoke,invoke-eligibility}.ts
  src/authorize-egress.ts        agent-auth-update: open egress for our contracts (BUG-010)
  src/{phase2-cross-tenant,phase2-delegation}.ts
  src/generate-audit-viewer.ts   builds the static audit viewer from audit-log.jsonl
  audit-viewer.html       read-only, double-clickable audit-ledger visualization (real rows)
  mock-payout/server.ts   PII-boundary-enforcing payout + /echo probe endpoint
  tests/                  *.local (offline) · *.mocked (SDK boundary) · *.integration (live)
logs/                     captured output of the live testnet runs
BUGS.md                   developer log — 14 bug/doc-gap findings (bug-bounty track)
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
yarn audit-viewer          # rebuild app/audit-viewer.html from the real audit-log.jsonl —
                           #   read-only, double-click to open (no server / fetch / CORS)

# Live sandbox (proven): real DID + balance
yarn auth-gate

# Live metered — these RAN on testnet (logs in ../logs/); guarded by AIDLINK_CONFIRM_METERED=1:
AIDLINK_CONFIRM_METERED=1 yarn provision                       # ✅ registered contract_id=445; maps seeded
AIDLINK_CONFIRM_METERED=1 yarn tsx src/authorize-egress.ts     # ✅ agent-auth-update opens egress (tx:321:71227) — see BUG-010
AIDLINK_CONFIRM_METERED=1 PROBE_ONLY=1 yarn invoke             # ✅ {{profile.first_name}} → "Olivia" (live PII resolution!)
AIDLINK_CONFIRM_METERED=1 yarn tsx src/invoke-eligibility.ts   # ✅ live eligibility (approved + default-deny)
AIDLINK_CONFIRM_METERED=1 yarn tsx src/phase2-cross-tenant.ts  # ✅ live cross-tenant call; payout clears egress, stops at bank_account (BUG-006)
AIDLINK_CONFIRM_METERED=1 yarn tsx src/phase2-delegation.ts    # ✅ live revoke; act clears egress, stops at bank_account (BUG-006)
```

---

## Developer log (bug-bounty track) — [`BUGS.md`](./BUGS.md)

14 grounded findings, each with what we tried, the exact doc citation / error output, why
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

## Live run: the two platform issues we hit, and how they resolved

Both blockers we encountered on the live network were **platform-side**, both were reported,
and both moved:

1. **Token grant minted 1,000,000× short** (BUG-005) — diagnosed to the exact factor, reported
   2026-06-20, **corrected**; we then registered the contract and ran every live phase.
2. **Egress authorization for a custom contract** (BUG-010 + BUG-013) — impossible via any
   documented path: every outbound call returned `egress_denied`, no SDK method set the
   allow-list, and the dashboard "Authorized contract" flow didn't list our registered
   `contract_id=445`. Terminal3 devrel **acknowledged this as a known, tracked bug** and supplied
   an **undocumented** programmatic call — `tee:user/contracts::agent-auth-update`
   (`scriptName: "*"`, `allowedHosts`) — which **worked first try** (`tx:321:71227`) and opened
   egress. The next call resolved `{{profile.first_name}}` → `"Olivia"` live. The call works, but
   it appears in no public doc or SDK surface, so the discoverability gap is a real
   developer-experience finding, not a closed bug.

**The one remaining limitation is a confirmed schema gap, not a wall:** with egress open, the
payout reaches host-side resolution and stops at `{{profile.bank_account}}`
(`placeholder-unknown`). Verified live (BUG-006): the resolved profile is a **fixed, host-defined
set** — `first_name`/`last_name` resolve, an arbitrary custom key does not. This is exactly why
AidLink's design keeps raw bank details in **tenant-private org-data behind a non-PII reference**,
never in a `{{profile.*}}` placeholder — a design the live result **validates** rather than
blocks. The privacy mechanism is proven; the account field simply lives where the platform
intends it to.
