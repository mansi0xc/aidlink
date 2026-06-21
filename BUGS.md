# AidLink — Developer Log: Bugs & Documentation Gaps

A running log of every wall hit while building AidLink against the Terminal 3 ADK
(client SDK `@terminal3/t3n-sdk@3.9.0`, testnet). Each entry records: what we were
trying to do, what the docs said (or didn't), what actually happened, and the exact
output. Kept live from Phase 0 onward, not retroactively.

Environment for all entries unless noted:
- `@terminal3/t3n-sdk@3.9.0` (npm `latest` at time of writing), installed via yarn
- Node v24.13.0, macOS (darwin 25.5.0)
- Network: `docs.terminal3.io` reachable, `api.terminal3.io` → 200, npm registry → 200

---

## BUG-001 — Programmatic delegation/grant/revoke is fully implemented in the SDK but documented as dashboard-only (and "coming soon")

**Severity:** High (documentation gap — sends builders down a wrong/blocked path for a core capability)
**Area:** Delegation / access grants
**Status:** Confirmed by reading shipped type definitions

### What we were trying to do
Design AidLink's human-helper fallback: grant a volunteer **single-use, time-boxed**
authority to act for an offline beneficiary, have the volunteer complete one action
while the grant is live, then **revoke** and prove the next action is denied — all
driven **programmatically from the SDK** (the whole product is an agent-to-agent flow;
a human clicking a dashboard isn't viable for a field volunteer).

### What the docs said (or implied)
The two narrative pages dedicated to this are explicit that delegation is a
**dashboard action**, with no SDK surface, and that the human/third-party variants are
**not yet available**:

- `https://docs.terminal3.io/t3n/use-cases/delegate-access-to-agent.md`
  Documents delegation **only** as a T3N Dashboard UI flow:
  > "Log in to the T3N Dashboard … Click on the `AI Agents` tab … Click on `New agent`
  > … Enter the `Agent DID` … Select `Authorized TEE contract`."
  Revocation is likewise documented only as a UI click ("Click on `Remove`"). No SDK
  method names, parameters, code, or time-box/single-use rules are given.

- `https://docs.terminal3.io/t3n/use-cases/delegate-access-to-human.md`
  Conceptual six-step flow only. States access can use "configurable rules (e.g.,
  single or multiple uses, expiration dates)" and that "T3N automatically revokes
  access based on the authorization rules" — but gives **no** SDK signatures, code, or
  revoke mechanism. Sections on human users / third-party services are marked
  **"Coming soon."**

- `https://docs.terminal3.io/t3n/data-owner-guide/delegate-access.md`
  Same — dashboard instructions only; human/third-party "Coming soon."

- `https://docs.terminal3.io/developers/adk/tips/outbound-http-auth-by-user.md`
  Says egress is governed by per-user "allowed-hosts" grants and "Set the grant before
  you invoke," but for the *how* defers to the two pages above — i.e. the UI flow.

Reading only the narrative docs, a developer reasonably concludes: **delegation is
dashboard-only, and the human-helper case isn't shippable yet.** That's what we
initially reported as a Phase-2 blocker.

### What actually happens / what we found
The shipped SDK type definitions
(`node_modules/@terminal3/t3n-sdk/dist/index.d.ts`, v3.9.0) expose a **complete,
programmatic** delegation + grant API. None of these symbols appear in the narrative
docs; they are only discoverable by reading the `.d.ts`. Two independent mechanisms:

**(A) User→agent delegation credentials** (signed capability tokens):
```ts
// Exported from "@terminal3/t3n-sdk"
buildDelegationCredential(opts: BuildDelegationCredentialOpts): DelegationCredential
// opts: { user_did, agent_pubkey: Uint8Array, org_did, contract,
//         functions: string[],            // function-scoped (sorted, deduped, non-empty)
//         scopes?: string[], metadata?: Record<string,string>,
//         not_before_secs, not_after_secs, // <-- TIME-BOXED validity window
//         vc_id: Uint8Array }

signCredential(jcs, secret): { sig, addr }   // ETH-EOA users sign locally, no network
class DelegationCustodialClient { signCustodial(body) }  // OIDC/custodial users (TEE signs)

revokeDelegation(opts: RevokeDelegationOpts): Promise<RevokeDelegationResult>
// opts: { credentialJcsB64u, revokedFunctions?, client, scriptVersion?, baseUrl? }
// Whole-credential revoke (omit revokedFunctions) OR per-function narrowing.
// Wraps `tee:delegation/contracts::revoke`; ONLY the credential's user_did may revoke
// — any other caller is rejected with `NotCredentialHolder`.
```
So **time-boxed** (`not_before_secs`/`not_after_secs`), **scoped** (`functions[]`), and
**revocable** delegation are all first-class SDK features. Replay protection (the basis
for "single-use") is via the invocation envelope's `request_hash` + `nonce`
(`DELEGATION_INVOCATION_DOMAIN = "ot3.invocation/1"`), per the `ethRecoverEip191` /
`signAgentInvocation` doc comments.

**(B) Org contract grants** (org-side allow-list of who may call what):
```ts
class OrgDataClient / SessionOrgDataClient {
  setGrants(input: SetGrantsInput): Promise<MutationResponse>     // full replace
  deleteGrants(input: DeleteGrantsInput): Promise<MutationResponse>
  // getGrants via GrantsGetInput
}
interface UserGrant {
  user_did: string;
  functions: string[];                  // WIT functions the user may invoke
  scopes: string[];                     // data scope paths
  constraints: Record<string,string>;   // request-metadata equality constraints
  expires_at_secs: number | null;       // <-- TIME-BOXED; null = never
}
```

### Why this matters to a developer
- The single most differentiated capability of this platform (privacy-preserving,
  revocable delegation) is **invisible** to anyone who reads the docs as written. You'd
  conclude the human-helper flow is "coming soon" and either cut the feature or build a
  brittle dashboard-scraping workaround — when a clean, signed, revocable, time-boxed
  primitive ships in the box.
- The exact pieces a real integration needs — the time-box fields, the
  function-scoping invariants (sorted/deduped/non-empty), who is allowed to revoke
  (`NotCredentialHolder`), EOA-signs-locally vs custodial-signs-in-TEE — exist only as
  `.d.ts` doc-comments. There is no narrative page tying them into an end-to-end flow.
- The two distinct authz layers (delegation credentials **vs** org `UserGrant`s) are
  easy to conflate; the docs describe neither, so it's unclear which gates PII
  placeholder resolution vs cross-tenant invocation vs egress.

### Suggested fix
Publish an ADK tips page: "Delegate access programmatically" with the
`buildDelegationCredential` → `signCredential`/`signCustodial` → invoke →
`revokeDelegation` lifecycle, the time-box/scoping rules, and a clear statement of how
delegation credentials relate to `OrgDataClient` grants and to PII placeholder
resolution. Remove or qualify the "Coming soon" labels, since the SDK already ships it.

### Impact on AidLink's plan
**Correction to our Phase 0 assessment:** we will NOT need the dashboard-driven hybrid
flow we proposed. Phase 2's human-helper delegation is implemented **end-to-end via the
SDK**: build + sign a time-boxed credential for the helper, invoke while live, then
`revokeDelegation`, then show the SDK call failing post-revoke.

---

## BUG-002 — Documented OpenAPI specification URLs both return 404

**Severity:** Medium (the full REST surface is unavailable as documented)
**Area:** API reference
**Status:** Confirmed

### What we were trying to do
Consult the full API surface (per the project brief and the docs' own pointers) to
confirm grant/delegation/egress endpoints when the narrative docs didn't cover them.

### What the docs said
The brief and docs reference two spec locations:
- `https://docs.terminal3.io/terminal-3-openapi.yml`
- `https://docs.terminal3.io/api-reference/openapi.json`

### What actually happened
Both 404. Probed several plausible variants:
```
https://docs.terminal3.io/terminal-3-openapi.yml      -> 404
https://docs.terminal3.io/api-reference/openapi.json  -> 404
https://docs.terminal3.io/openapi.json                -> 404
https://docs.terminal3.io/api-reference/openapi.yml   -> 404
https://api.terminal3.io/                             -> 200   (host is up)
```
The docs index (`https://docs.terminal3.io/llms.txt`) lists no `api-reference` section
at all — only the ADK and t3n use-case pages.

### Why this matters
When the narrative docs fall short (as in BUG-001), there's no machine-readable spec to
fall back to. We reconstructed the surface by reading the SDK's `.d.ts` instead.

### Suggested fix
Restore the OpenAPI document at a linked, stable URL, and reference it from `llms.txt`.

---

## BUG-003 — Powerful SDK exports (cross-tenant calls, delegation, org grants, contract logs) are entirely absent from the narrative walkthrough

**Severity:** Medium (discoverability)
**Area:** ADK walkthrough / SDK reference
**Status:** Confirmed

### What we were trying to do
Map the project brief's intended calls to real SDK methods before coding.

### What the docs said vs. what ships
The walkthrough documents a partial, sometimes differently-named surface:
- Invocation is shown as `agentClient.executeAndDecode({ script_name, script_version,
  function_name, input })` (`.../walkthrough/invoke-contract.md`). That method **does**
  exist (`T3nClient.executeAndDecode`, `TenantClient.executeAndDecode`), good.
- Registration is shown as `tenant.contracts.register({ tail, version, wasm })`
  (`.../walkthrough/register-contract.md`). Confirmed; note `TenantContractsNamespace`
  also ships `publish/enable/disable/unregister/logs/execute`, none of which the
  walkthrough mentions.

But several capabilities **central to an agent-to-agent product** appear **nowhere** in
the narrative docs and were found only in `index.d.ts`:
- `TenantClient.executeBusinessContract(session, { tenant, contract, functionName,
  input })` — the **cross-tenant** call. This is how two agents talk to each other; it
  is undocumented in narrative form.
- `buildDelegationCredential`, `signCredential`, `revokeDelegation`,
  `DelegationCustodialClient` — see BUG-001.
- `OrgDataClient.setGrants/deleteGrants`, `UserGrant`, `OrgContractGrants` — see
  BUG-001.
- `TenantContractsNamespace.logs(tail, …)` — reads back a contract's own
  `logging::info/debug/error` output (useful for proving the PII-placeholder code path
  never holds plaintext). Off by default (`log_max_entries` quota must be non-zero) —
  itself undocumented in the narrative pages.

### Why this matters
The brief's intended method names (`executeBusinessContract`, `client.maps`,
`client.contracts.publish`, `client.tenant.claim()/.me()`) turned out to be broadly
**accurate** — but a builder can only confirm that by reading the type defs, because the
narrative docs neither list these methods nor cross-link to a generated SDK reference.

### Suggested fix
Generate and publish an SDK API reference from the TypeScript types, and add a
cross-tenant-invocation page to the walkthrough.

---

## BUG-004 — `http-with-placeholders` WIT import path is asserted by docs but not shown in any example `world.wit`

**Severity:** Low/Medium (blocks first build of the PII path until the real `wit/deps` are inspected)
**Area:** TEE contract / WIT bindings
**Status:** RESOLVED — pinned from the public reference contract `Terminal-3/z-tenant-flight`

### What we were trying to do
Pin the exact WIT import for the placeholder-substituted outbound HTTP call (the core
of AidLink's "contract never sees the bank account number" guarantee).

### What the docs said
- `.../walkthrough/write-contract.md` shows a `world.wit` importing
  `host:interfaces/http@2.1.0` (plain HTTP) and lists `logging`, `kv-store`,
  `tenant-context` — but **not** any placeholders interface.
- `.../tips/placeholders-outbound-calls.md` refers to the import as
  `t3n::host::http_with_placeholders` (Rust path style, abbreviated `hwp`) with an
  `hwp::Request { method, url, headers, body }` struct and `{{profile.<field>}}`
  markers — but shows **no** `world.wit` import line and **no** version, so the canonical
  WIT package/interface name (`host:interfaces/http-with-placeholders@x.y.z`?) is
  ambiguous.

### Why this matters
WIT imports *are* the capability set (per `.../tips/capabilities-from-wit-import.md`),
so the exact import string is load-bearing — a wrong name means the contract either
won't link or silently lacks the capability. We can't author the world without the real
`wit/deps/` tree (`host-interfaces-2.1.0/`, `host-tenant-1.0.0/` per the walkthrough's
directory listing).

### Resolution
The SDK npm package ships **no** contract-side WIT (`find . -iname '*.wit'` in
`@terminal3/t3n-sdk` is empty — it only carries client *session* WIT under
`dist/wasm/generated/`). The repo named in the SDK `package.json`
(`github.com/Terminal-3/trinity`) is **private (404)**. The working reference is a
**different, public** repo we found by listing the org's repos:
`https://github.com/Terminal-3/z-tenant-flight` (the Duffel travel showcase that the
`invoke-contract.md` walkthrough is built on). It ships the real `wit/deps` tree.

**Exact, canonical import line (this is the answer to the gap):**
```wit
import host:interfaces/http-with-placeholders@2.1.0;
```
It lives in the WIT package `host:interfaces@2.1.0` (file
`wit/deps/host-interfaces-2.1.0/package.wit`), alongside `http`, `kv-store`, `logging`,
`tenant-context` (the last in `host:tenant@1.0.0`). The interface:
```wit
interface http-with-placeholders {
  enum verb { get, post, put, patch, delete }
  record request  { method: verb, url: string,
                    headers: option<list<tuple<string,string>>>, payload: option<list<u8>> }
  record response { code: u16, payload: list<u8> }
  variant http-error {
    egress-denied(string),          // host not on the contract http_allow_list
    placeholder-denied(string),     // non-`profile` namespace or malformed marker
    placeholder-unknown(string),    // {{profile.<field>}} resolved to nothing
    placeholder-no-user-context,    // no pii_did bound (admin/unauth path)
    upstream-error(string),         // transport/TLS/parse — never contains PII
  }
  call: func(request: request) -> result<response, http-error>;
}
```
Doc-comment in that file confirms the privacy model precisely: substitution happens
"on the host stack between manifest validation and the outbound reqwest call, so a
compromised contract that tries to read the substituted bytes back finds only the
unresolved template"; only the `profile` namespace is allowed (`{{secrets.<x>}}` →
`placeholder-denied`); egress shares the plain-`http` `http_allow_list`.

In Rust the generated binding is `crate::host::interfaces::http_with_placeholders`
(aliased `hwp`), called as `hwp::call(&hwp::Request { method: hwp::Verb::Post, url,
headers, payload })`. Host capabilities to declare in the manifest:
`["kv_store","logging","tenant_context","http_with_placeholders"]`.

**Doc-gap angle:** none of this (the exact import string, the version, the typed
`http-error`, the manifest capability names, or even the existence of the public
`z-tenant-flight` reference) is reachable from the narrative docs — the
`placeholders-outbound-calls.md` tip gives only the Rust-path name `hwp` with no
`world.wit` line or version. A builder cannot author the world without finding this repo
by hand. Suggest the placeholders tip link directly to `z-tenant-flight` and show the
import line + version.

---

## BUG-005 — Welcome test-token grant is 1,000,000× short: balance is 20,000 *base units* (0.02 tokens), not the 20,000 *tokens* the claim page promises

**Severity:** High (blocks Phase 1 — cannot register/execute a metered contract with 0.02 tokens)
**Area:** Token grant / metering / claim page
**Status:** Confirmed on testnet; **work paused before any metered operation** pending a top-up

### What we were trying to do
Confirm we have enough testnet token budget before the first metered operation
(contract registration + execution + storage), as those draw down the balance.

### What the docs / claim page said
- The token-claim page promises **20,000 T3N tokens** per claim, annotated as
  **"~5,000 protected actions, 25 agents."**
- `https://docs.terminal3.io/.../prerequisites/request-test-tokens.md` says only that
  "test tokens are generated and linked to this key automatically" on claim — no unit,
  amount, or per-action cost is documented anywhere (`why-adk.md` and the token-related
  pages give no figures either).

### What actually happened — exact output
`getUsage()` for our DID on `https://cn-api.sg.testnet.t3n.terminal3.io`:

```
DID : did:t3n:5cc23ceebac85b5e55476a4b0d8a0b3a74c77f2d
wallet (eth, derived): 0x497e05056d5e27f85221b97322aa481bed50f189
raw usage.balance = {"available":20000,"reserved":0,"last_settled_seq_no":0,
                     "version":1,"credit_exhausted":false,"storage_deposit":0}
raw usage.entries = []          # no ledger entries — single fresh grant, no activity
```

### The conversion (ruled out a display/decimals bug)
The SDK is internally consistent and our read of it is correct:
```
TOKEN_DECIMALS       = 6            # from index.d.ts
BASE_UNITS_PER_TOKEN = 1_000_000    # = 10 ** TOKEN_DECIMALS
formatTokens(20000)  = "0.02"       # 20,000 base units ÷ 1e6 = 0.02 tokens
```
So **0.02 tokens is the correct token-denominated value of 20,000 base units** —
`formatTokens` / `BASE_UNITS_PER_TOKEN` are not buggy. The shortfall is in the grant
itself, not the display.

### The smoking gun
- Promised grant: 20,000 **tokens** = `20,000 × 1,000,000` = **20,000,000,000 base units**.
- Actual balance: **20,000 base units**.
- Ratio: **exactly 1,000,000× short** — i.e. exactly `BASE_UNITS_PER_TOKEN`.

The grant credited the number **20,000 in base units** where it should have credited
20,000 **tokens** (`20,000 × BASE_UNITS_PER_TOKEN` base units). This is a classic
unit/decimals error in the welcome-grant mint (or in what the claim page advertises).
`entries: []` and `last_settled_seq_no: 0` confirm this is the initial grant with no
spend yet — nothing on our side consumed the difference.

### Why this matters to a developer
At the claim page's own ratio (20,000 tokens ≈ 5,000 protected actions), one protected
action costs ≈ 4 tokens = 4,000,000 base units. We hold 20,000 base units — **less than
1/200th of a single action**, and not enough to register and execute one contract. A
builder following the quickstart would hit `credit_exhausted` almost immediately with no
indication why, since no doc states the per-action cost or the real unit of the grant.

### Action taken
Per project policy, **Phase 1 is paused before registering or executing anything
metered.** Requesting a top-up from `devrel@terminal3.io`, citing:
- DID: `did:t3n:5cc23ceebac85b5e55476a4b0d8a0b3a74c77f2d`
- Observed balance: `available: 20000` base units (0.02 tokens); expected ~20,000 tokens
- Hypothesis: welcome grant minted in base units instead of tokens (1e6× short)

### Suggested fix
Mint the welcome grant as `claimedTokens × BASE_UNITS_PER_TOKEN` base units, and document
the unit (base units vs tokens) and a ballpark per-action cost on the claim page and in
`request-test-tokens.md`.

> Note (self-admit path, ruled out as the cause): testnet welcome credits can also be
> minted via `user-upsert { becomeDevTenant: true }` into a separate `grantedCredits`
> bucket (`TenantAdmitProjection`). But the claim docs say tokens are linked
> "automatically" on claim, our `getUsage()` already returns a populated balance (not a
> "tenant not found" error), and the amount present is exactly the promised figure in the
> wrong unit — so this is a unit bug in the grant, not a missing-admit issue. Will mention
> the `grantedCredits` mechanism to devrel as a possible mint path to re-check.

### Update — self-admit stopgap investigated and NOT run (3 blocking reasons)
We evaluated whether `T3nClient.submitUserInput({ profile, becomeDevTenant: true })`
(the `tee:user/contracts::user-upsert` self-admit) could mint usable credits into the
separate `granted_credits` bucket (`TenantSelfAdmitResult { status, tenant,
granted_credits }`). Per the policy "confirm the call isn't metered before running it,"
we did NOT run it, because:

1. **It is a metered invocation.** The charge model (`ChargeReason`, from `index.d.ts`)
   has exactly these kinds: `contract_register`, `invocation`, `kv_bytes`, `cas_bytes`,
   `outbox_egress`. `user-upsert` is an export invocation on `tee:user/contracts`, i.e.
   the `invocation` kind (`fuel_consumed`, `fuel_tokens`, `host_call_tokens`). No
   exemption for `user-upsert` exists anywhere in the type defs. So it would draw on the
   same balance we're trying to fix — we cannot confirm it is free, and the evidence says
   it is metered.
2. **It is gated behind a verified email we don't have.** `submitUserInput` rejects a DID
   with no verified email / proving authenticator with `UserUpsertError(kind:
   "EmailNotVerified")` and requires an `otpRequest` + `otpVerify` email roundtrip first.
   Our DID is API-key/ETH-derived with no verified email, so the call can't even be
   reached without standing up an email-OTP flow.
3. **The tenant already exists, so it would mint nothing.** `getUsage()` returns a
   populated balance row with `version: 1` — the tenant/account row is already present.
   Self-admit on an existing tenant returns `status: "already-admitted"` with
   `granted_credits: null` (idempotent no-op). So even if (1) and (2) were free/satisfied,
   the expected outcome grants zero new credits.

**Conclusion:** self-admit is not a viable stopgap here. Still holding for the devrel
top-up. (Worth asking devrel to confirm whether the original grant should have run
through the `granted_credits` mint at `20000 × BASE_UNITS_PER_TOKEN`.)

### Re-poll 2026-06-21 — balance changed, STILL in base units (bug persists)
A re-poll of `getUsage()` shows the balance moved **20,000 → 40,000 base units** since this
entry was filed on 2026-06-20 — i.e. a **+20,000 base-unit mint occurred** (a top-up of
some kind landed). But it is **still denominated in base units**: 40,000 base units =
**0.04 tokens**, still ~**500,000× short** of the promised 20,000 tokens
(20,000,000,000 base units). Whatever minted the additional credit applied it in base
units again — the unit bug persists through the top-up. `tenant.tenant.me()` confirms the
tenant is `status: "active"` with quotas `max_contracts: 10, max_wasm_bytes: 1048576`
(our 173 KB artifact fits), `fuel_per_call_max: 50,000,000` — so the account is fully
provisioned *except* for spendable balance. The `getUsage().entries` feed stayed **empty**
across both the 20k→40k change and the small charge below, so mints (and at least some
charges) do **not** surface in the caller's usage feed — `balance.available` is the only
reliable signal. Still far short of the ~4 tokens/action the claim page implies; holding.

### Re-poll 2026-06-22 — a SECOND API key claimed for the same DID adds NO credit
A new API key was claimed for the **same** DID (`did:t3n:5cc2…7f2d`) and `getUsage()`
re-polled: balance **unchanged at 39,989 base units**, balance-row **`version` still 3** (a
fresh mint would increment it), `entries` still empty. So **re-claiming a key for an
existing DID is not a workaround for BUG-005** — the welcome grant is once-per-DID and this
DID is already `status: "active"`/admitted, so no additional credit is minted. Expected
behaviour, recorded because the question came up explicitly: the path to a real balance is a
corrected mint on this DID (or a brand-new DID), not another claim against the same one.
**Closed 2026-06-22:** ran `auth-gate` with the full new key. It derives a **different**
wallet address (`0x54df…649e`) than the original key (`0x497e…f189`) but **authenticates to
the same DID** (`did:t3n:5cc2…7f2d`), with **no `eth_auth_map_conflict`** and the **balance
unchanged at 39,989** base units. So a second claim for an existing DID **links an additional
ETH authenticator wallet** to that DID — it neither spawns a new DID nor mints new credit.
(Two wallets → one DID, consistent with the multi-authenticator model behind
`eth_authenticator_limit` in BUG-009.)

### Metering correction — `tenant.tenant.me()` IS metered (~11 base units); `getUsage()` is not
While running the read-only diagnostic, `getUsage()` bracketing showed `tenant.tenant.me()`
cost **~11 base units** (a successful control-plane read), whereas `getUsage()` itself is
free (0 delta, no entry). So "read-only" is **not** a reliable proxy for "free" on this
platform — some control reads are charged and some are not, and the charge does not appear
in `entries`. Undocumented: there is no per-call cost table, so a developer cannot predict
which reads draw down balance. (Logged here rather than as a separate entry since it is a
direct corollary of BUG-005's metering opacity.)

---

## BUG-006 — No documented "resolved profile" schema for `{{profile.<field>}}`; unclear whether custom keys (e.g. `bank_account`) resolve, and no profile field is intended for raw bank details

**Severity:** Medium/High (determines whether the headline privacy feature can carry a bank account at all)
**Area:** Placeholders / user-profile schema
**Status:** Open — design adapted defensively; to confirm with the cheapest possible live probe (see Phase-1 plan) once balance lands

### What we were trying to do
Send the beneficiary's bank account number through the PII-safe path as
`{{profile.bank_account}}`, resolved host-side so the contract never holds it. We needed
to know the **canonical resolved-profile schema** the host substitutes from — i.e. which
`{{profile.<field>}}` paths actually resolve.

### What the docs / SDK say (the gap)
- `placeholders-outbound-calls.md` lists example markers (`{{profile.first_name}}`,
  `{{profile.date_of_birth}}`, `{{profile.verified_contacts.email.value}}`) but never
  enumerates the **full** resolvable schema, nor states whether arbitrary/custom keys
  resolve.
- The SDK type defs expose only `UserInputProfile` — the **input** schema for
  `submitUserInput` (`first_name`, `last_name`, `country_of_residence`,
  `document_issuance_country`, `ssn`, `address`, `email_address`, `phone_number`,
  `campaign_code`, `role`, plus an open `[key: string]: unknown`). This is NOT the same
  as the **resolved** schema used at substitution: the reference contract resolves
  `{{profile.verified_contacts.email.value}}` (a nested, host-side shape) which does
  **not** appear in `UserInputProfile` at all. So the input schema and the resolved
  schema demonstrably differ, and neither doc nor `.d.ts` publishes the resolved one.
- The open `[key: string]: unknown` on `UserInputProfile` means custom keys are
  *accepted on input*, but there is **no evidence** they are *resolvable as placeholders*
  — the host may substitute only a fixed, internal schema.

### The strongest signal — and it points away from a profile bank field
The only bank-related field anywhere in the SDK is on the **payroll org-data** record,
not the profile:
```ts
interface EmployeeRecord {
  // ...
  /** Opaque reference used by the service layer for disbursement. */
  bank_account_ref: string;
  bank_account_changed_recently: boolean;
}
```
So even Terminal3's own payroll example does **not** put a raw account number in the user
profile. It stores an **opaque ref** in private org-data and lets the service layer
resolve the actual account at disbursement. This strongly implies there is no
`{{profile.bank_account}}` field in the resolved schema, and that raw bank details are
intended to live in tenant-private storage (org-data / KV), not the profile placeholder
namespace. The flight demo corroborates: it hardcoded passport/phone Duffel-sandbox
values precisely because "the user-profile schema carries no passport / nationality /
title fields."

### Why this matters to a developer
The single most marketable use of `http-with-placeholders` — forwarding a bank account
without the agent seeing it — has **no documented field to carry the account**, and the
one cue in the codebase says accounts belong in org-data behind an opaque ref. A builder
will either guess a custom key (likely `placeholder-unknown` at runtime) or burn time
reverse-engineering the resolved schema. There is no published list of resolvable
`{{profile.*}}` paths.

### Impact on AidLink's design (defensive adaptation)
- **First live probe is isolated and cheap** (see Phase-1 plan): a minimal call that
  templates exactly one **known-good** field (`{{profile.first_name}}`) to confirm the
  resolution mechanism + our grant wiring work at all — *before* spending anything on the
  account-field question.
- **Then** probe `{{profile.bank_account}}` (custom key) in isolation. Two outcomes:
  - If it resolves → great, keep the design as-is and note the correction here.
  - If it returns `placeholder-unknown` → fall back to the **payroll-style** pattern: keep
    the raw account in tenant-private KV/org-data keyed by `beneficiary_id`, template a
    non-PII reference in the outbound body, and have the payout endpoint resolve the
    ref → account on its side. The contract still never holds the plaintext; the privacy
    boundary just moves from "host placeholder substitution" to "tenant-private ref the
    agent operator can't read raw." Documented so we can switch without rework.

### Suggested fix
Publish the canonical resolved-profile schema (every resolvable `{{profile.*}}` path),
state explicitly whether custom keys resolve, and document the intended home for raw
financial details (org-data ref vs profile).

---

## BUG-007 — No documented path to "a profile-bearing user + grant" for placeholder testing; the whole chain is undocumented and gated behind a metered, email-verified flow

**Severity:** Medium/High (you cannot exercise the headline `{{profile.*}}` feature at all until this chain is solved, and none of it is written down)
**Area:** User onboarding / profile / agent-auth grant / placeholder prerequisites
**Status:** Mapped from `index.d.ts`; the parts that need a verified email / live sandbox are called out explicitly below

### What we were trying to do (zero-token)
Determine the **minimal** path to the precondition every `{{profile.<field>}}` resolution
needs: a user DID that (a) has a populated profile and (b) has granted our contract the
right to act on that profile. We need this before the first live `probe-placeholder` call.

### What the docs say
Effectively nothing end-to-end. The placeholder tip assumes a profile already exists and a
grant is already in place. `delegate-access-to-agent.md` describes the grant only as a
dashboard click. There is **no** narrative page that walks: create user → verify email →
upsert profile → grant contract → invoke with `pii_did`. We reconstructed it from the SDK
type defs.

### The chain we reconstructed (all from `@terminal3/t3n-sdk@3.9.0` `index.d.ts`)
1. **Bind a verified email (required before any profile write).** `submitUserInput` rejects
   a DID with no verified email (`UserUpsertError(kind:"EmailNotVerified")`). To clear it:
   - `client.otpRequest({ ...email contact })` → node emails a one-time code
     (`OtpRequestResult { contact, channel, expiresAtSec, isNewProfile }`).
   - read the code **from the actual mailbox**, then
     `client.otpVerify({ otpCode, request })` → binds the contact
     (`OtpVerifyResult { did, email, status, isNewProfile }`).
   - convenience: `client.runOtpThenUserInput({ channel, emailAddress, getOtpCode, profile })`
     does request → (callback supplies the code) → upsert in one call.
2. **Write the profile.** `client.submitUserInput({ profile: UserInputProfile, becomeDevTenant? })`
   where `UserInputProfile` = `{ first_name, last_name, address, ssn, … , [custom]: unknown }`.
3. **Grant the contract access to that profile.** The `http-with-placeholders` WIT
   doc-comment states resolution is gated by "the agent delegation grant
   (`agent-auth-update`, scoped per-agent/per-contract/per-function)", and the same grant's
   `allowedHosts` is what satisfies the egress allow-list (so **BUG-? egress + this profile
   grant are the SAME authorization** — `scripts: [{ scriptName, functions, allowedHosts }]`).
   Two ways this surfaces in the SDK:
   - **Dashboard** ("Authorized TEE contract") per `delegate-access-to-agent.md`, or
   - **Programmatic delegation credential** — `buildDelegationCredential` + `signCredential`
     (see BUG-001), carried in the invocation envelope.

### The key simplification we found — the self-call path (cheapest Phase 1)
`GetAuditEventsOptions` doc-comment (the same agent-auth model) says: *"Omit `pii_did` to
read your own trail (all actors); set it to another user's DID to read, as a delegated
agent, … admitted only while that user's agent-auth grant to you is live."* That is the
general rule: **acting on your OWN DID needs no cross-user delegation grant; acting on
ANOTHER user's DID does.** So the minimal Phase 1 demo makes the **beneficiary = our own
tenant DID** (`pii_did` = our own DID). That removes step 3's cross-user delegation
entirely and reduces the prerequisite to: *our own DID must have a profile with the fields
we template.* (Phase 2's human-helper flow is exactly the other branch — a real cross-user
grant via `buildDelegationCredential` — so this also cleanly separates the two phases.)

**Minimal Phase 1 path (self-beneficiary):**
- (a) ensure our DID has a profile: if the claim already verified our work email, just
  `submitUserInput({ profile: { first_name: "…", … } })`; else `otpRequest` →
  (read code from our claim mailbox) → `otpVerify` → `submitUserInput`. **[metered]**
- (b) ensure the payout host is on the contract's allow-list + (if required even for self)
  the contract is an authorized script for our DID — **dashboard "Authorized TEE contract"**.
- (c) `executeAndDecode({ …, function_name: "probe-placeholder", pii_did: <our DID> })`. **[metered]**

### What we CANNOT determine zero-token (needs a verified email / live sandbox)
1. **Whether our claimed DID already has a verified email + profile.** The claim used a work
   email; if it's already bound, step (a) is a one-line `submitUserInput`.
   **Investigated 2026-06-21 (read-only):** `tenant.tenant.me()` returns tenant-scoped data
   only — `{ tenant, label: "testnet-dev", status: "active", quotas, created_at }` — and
   exposes **no** user email-verification or profile fields. `client.kycStatus()` is no help
   either: it fails `precondition_failed: kyc-status called before create-kyc-provider-session`
   (KYC needs a provider session first; it's not an email-verification probe). So **these
   reads cannot answer the email/profile question** — the SDK offers no client-side "get my
   profile / is my email verified" read. Determining it needs either a metered
   `submitUserInput` (which would surface `EmailNotVerified` if unverified — diagnostic but
   costs tokens, blocked on BUG-005) or the dashboard. Deferred to the dashboard check.
   (Net new gap: no free read exposes a DID's own profile/verification state.)
   **RESOLVED 2026-06-22 via the dashboard** (`testnet.network.terminal3.io` → Profile tab):
   the DID **already has a partial profile** — legal name `first="Olivia"`, `last="Gungin"`
   (middle empty), and an email **on file**, `olivygungin@gmail.com`. Location
   (country/province/city), gender, marital status and education are all empty. **Impact:**
   `{{profile.first_name}}` / `{{profile.last_name}}` should resolve **without** any
   `submitUserInput` step — so the cheap first live check (`probe-placeholder`, default field
   `first_name`) is viable as-is, and Phase 1's self-call path no longer needs a profile
   write for those fields. **Caveat (note the distinction):** the dashboard shows an email is
   *present*, not that it is *verified*. The `EmailNotVerified` gate on `submitUserInput` keys
   off verification, not mere presence — so if we later need to WRITE additional profile
   fields (e.g. the bank-account fallback in BUG-006), whether an OTP roundtrip is still
   required remains unconfirmed. For just *reading* `{{profile.first_name/last_name}}`, the
   profile is already sufficient.
   **Related dashboard note (agent-auth / question #4 + BUG-010):** the **AI Agents** tab
   exists with a "New agent" button and an Agent-DID / Authorized-contract table, currently
   **empty**. This is the dashboard surface for the agent-auth grant (authorized scripts +
   allowed hosts). It likely can't be populated until a contract is registered — i.e. still
   downstream of BUG-005. The actual form fields (and whether they set the egress allow-list
   per BUG-010) are pending a look once registration is possible.
2. **Whether a self-call (`pii_did` = own DID) resolves `{{profile.*}}` with no explicit
   agent-auth grant**, or whether even self-calls require the contract to be listed as an
   authorized script. The WIT comment ties resolution to the agent-auth grant unconditionally;
   only a live call settles whether "self" is auto-authorized.
3. **Whether custom profile keys (`bank_account`) resolve** — see BUG-006; live-only.
4. **Whether any SDK call (vs. dashboard) sets agent-auth `authorized scripts` / `allowedHosts`.**
   No `updateAuthorisations`-style method is exported; `buildDelegationCredential` exists but
   its mapping to the dashboard "Authorized TEE contract" list is undocumented. Likely
   dashboard-only for v3.9.0; unconfirmable without the sandbox.
5. **All of the above are downstream of BUG-005** — `submitUserInput`, `otpVerify`, and the
   invocation are metered, so none can be exercised until the token balance is topped up.

### Why this matters to a developer
The platform's flagship guarantee (an agent paying out without seeing PII) cannot be
demonstrated until a user has a profile AND a grant — and **neither the user-creation chain
nor the grant step is documented end-to-end**. A builder must reverse-engineer email-OTP →
upsert → agent-auth from the type defs, discover the self-call shortcut from an unrelated
audit-API doc-comment, and still hit the dashboard for the grant. A single "set up a test
user and authorize your contract" walkthrough would remove a multi-hour wall.

### Suggested fix
Add an end-to-end "prepare a test user and authorize a contract" guide
(otpRequest/otpVerify/submitUserInput → grant), document the self vs cross-user
authorization rule explicitly (not buried in the audit-events option doc), and state which
grant steps have an SDK method vs. are dashboard-only.

---

> The entries below (BUG-008 … BUG-011) were found in a dedicated doc/SDK-consistency pass
> over `common-errors.md` and the public `Terminal-3/z-tenant-flight` reference repo,
> **independent of AidLink's own build** — i.e. walls any developer following the official
> docs + reference contract would hit, regardless of what they're building.

## BUG-008 — `common-errors.md` says the SDK throws untyped strings; v3.9.0 actually ships a full typed error hierarchy

**Severity:** Medium (steers developers to brittle substring matching when typed branching exists)
**Area:** Error handling / docs
**Status:** Confirmed (`index.d.ts` + a live error observed)

### What the docs say
`common-errors.md` (verbatim):
> "The SDK throws with `detail` — a human-readable message string, **not** a typed error
> object. Match on the substring shown below."

### What the SDK actually ships
`index.d.ts` exposes a typed error hierarchy, all extending `T3nError`:
`T3nError { readonly code? }`, `RpcError { readonly detail? }`, `AuthenticationError`,
`SessionStateError`, `SessionExpiredError`, `HandshakeError`, `OtpRateLimitedError`,
`WasmError`, `ContractResponseError`, `KycStatusTimeoutError`, and notably
`UserUpsertError { readonly kind: UserUpsertErrorKind | "Unknown"; readonly detail }`.
So a caller **can** branch on `instanceof RpcError` / `err.code` / `err.kind` rather than
substring-matching `detail`. A live example from our read-only diagnostic — `kycStatus()`
rejected with a structured body, not a bare string:
`HTTP 400: Invalid params ({"code":"bad_request","detail":"precondition_failed: kyc-status called before create-kyc-provider-session","request_id":"…"})`.

### Why it matters / fix
Substring matching on human-readable `detail` is fragile (messages get reworded). The docs
should show the typed-error path (`instanceof` + `.code`/`.kind`) that the SDK already
provides, and reserve substring matching for the few contract-authored messages.

## BUG-009 — Auth/upsert error codes are documented in snake_case but surfaced by the SDK in PascalCase (`kind`)

**Severity:** Medium (a copy-pasted branch silently never matches)
**Area:** Error handling / docs
**Status:** Confirmed

### The mismatch
`common-errors.md` documents the user/session error codes as snake_case `detail` prefixes:
`eth_authenticator_limit`, `eth_auth_map_conflict`, `email_not_verified`, `user_not_found`,
`legacy_field`. But the SDK's typed discriminator is **PascalCase**:
```ts
type UserUpsertErrorKind = "EmailNotVerified" | "LegacyField" | "UserNotFound";
class UserUpsertError { readonly kind: UserUpsertErrorKind | "Unknown"; }
```
So `email_not_verified` (docs, wire `detail`) ≠ `EmailNotVerified` (SDK `err.kind`). A
developer who reads the docs and writes `if (err.kind === "email_not_verified")` gets a
branch that never fires; the working form is `err.kind === "EmailNotVerified"`. The two
representations (wire snake_case `detail` prefix vs. SDK PascalCase `kind`) are never shown
side by side.

### Fix
Document both: the wire `detail` prefix AND the SDK `kind` value, and note the SDK derives
one from the other.

## BUG-010 — Three different names/locations for the outbound-egress allow-list across docs + WIT; they disagree on whether it is per-user or per-contract

**Severity:** High (directly blocks getting a working contract to reach its API — and it's exactly the wall we hit provisioning AidLink, see BUG-007)
**Area:** Egress authorization / docs vs. host WIT
**Status:** Confirmed

### The contradiction
The same allow-list is described three ways:
1. `common-errors.md`: egress is denied because "the contract called a host **the caller's
   `agent_auth` grant** doesn't authorize" → fix: "Add the host to **the user's grant**."
   → **per-USER** grant.
2. `outbound-http-auth-by-user.md`: outbound HTTP is governed by **per-user** "allowed-hosts"
   grants. → **per-USER**.
3. The host-interfaces WIT doc-comment for `http-with-placeholders` (the source of truth
   the contract links against): "Egress is gated by the existing **per-contract
   `http_allow_list`** (same allowlist plain `http` uses)." → **per-CONTRACT**.
4. And the error string itself uses a **third** name: `host '<host>' is not in the
   **authorised_hosts** allowlist`.

So a developer is told the egress list lives on the *user's `agent_auth` grant* (docs) and
simultaneously on the *contract's `http_allow_list`* (WIT), under three different names
(`agent_auth` grant / `http_allow_list` / `authorised_hosts`). There is no single
authoritative statement of where to set it or with which SDK call.

### Impact
This is precisely why AidLink's `provision.ts` cannot set the egress allow-list with
confidence (BUG-007 prereq #1): the docs imply a per-user grant step, the WIT implies a
per-contract list, and neither names a concrete SDK method.

### Fix
Pick one model, name it once, and document the exact SDK/dashboard step to populate it.
Reconcile `http_allow_list` vs `authorised_hosts` vs `agent_auth` grant terminology.

## BUG-011 — The official `z-tenant-flight` reference repo's README contradicts its own current code on the privacy model, the capability manifest, and the version

**Severity:** High (the canonical example actively mis-teaches the platform's headline privacy feature)
**Area:** Reference repo / docs
**Status:** Confirmed (README vs. `world.wit` / `Cargo.toml` / `booking.rs` in the same repo, `main`)

### The mismatches (all within one repo, on `main`)
1. **Privacy model — directly inverted.** The README states:
   > "passenger PII … **is passed in by the agent** and used inside the enclave to call
   > Duffel."
   But the current code does the opposite — `booking.rs`:
   > "Passenger PII (name, DOB, passport, contact) is **NEVER passed in as a contract
   > argument**. The contract templates `{{profile.<field>}}` markers … resolved … host-side."
   and `world.wit` imports `http-with-placeholders` precisely so PII is *not* passed in. The
   README describes the **old (v0.3.0) model**; the code is the new placeholder model. A
   reader learning the platform's flagship guarantee from the README learns the wrong one.
2. **Capability manifest is missing `http_with_placeholders`.** README says:
   `{ "host_capabilities": ["kv_store", "logging", "tenant_context", "http"] }`
   — but `book-offer` calls `http-with-placeholders`, and `world.wit` imports it. Copying
   the README manifest yields a contract that can't make the booking call.
3. **Version drift.** README header says **v0.3.0** and a `z_tenant_flight.wasm` artifact;
   `Cargo.toml` is **0.4.1**, `world.wit` declares `z:tenant-flight@0.4.0`, and
   `lib.rs CONTRACT_VERSION = "0.4.1"`. The README wasn't updated alongside the 0.3→0.4
   placeholder rework.

### Why it matters / fix
This is the repo the `invoke-contract.md` walkthrough is built on and the only public
reference for `http-with-placeholders`. Its README teaching the pre-placeholder privacy
model (and an incomplete manifest) will actively misdirect anyone implementing the
PII-safe path. Regenerate the README from the 0.4.x source: correct the privacy
description, add `http_with_placeholders` to the manifest, and bump the version.

---

## BUG-012 — Delegation credential `contract` field rejects z-tenant script names (`ContractTooLong`); the field only fits short system-contract ids

**Severity:** Medium (blocks the obvious wiring of delegation to a z-tenant contract; undocumented length cap + undocumented "what value goes here")
**Area:** Delegation / `buildDelegationCredential`
**Status:** Confirmed empirically (Phase 2 build)

### What we were trying to do
Build a human-helper delegation credential authorizing the helper to call AidLink's
`disburse-payout` on our z-tenant contract. The natural value for the credential's
`contract` field is the contract's canonical script name, `z:<tid>:aidlink`.

### What happens
`buildDelegationCredential({ … contract: "z:<40-hex>:aidlink" … })` throws
**`ContractTooLong`** (raised by `validateCredentialBody`). Probing the boundary:
```
len 40  → OK
len 48  → ContractTooLong
z:<40-hex>:aidlink  (len 50) → ContractTooLong
"tee:aidlink" / "z:aidlink"  → OK
```
So the field caps somewhere in (40, 48], and a full z-tenant script name (`z:` + 40-hex
tid + `:` + tail = 50+ chars) **never fits**.

### What the docs say
Nothing. `DelegationCredential.contract` is documented only as *"Contract id, e.g.
`tee:payroll`"* — a short **system**-contract id. There is no stated max length, and no
guidance on what a **z-tenant** integrator should put here, nor how that value is matched
against the actual invoked script `z:<tid>:<tail>` during host-side authorization.

### Why it matters
The credential is clearly modeled around the built-in system contracts (`tee:payroll`,
`tee:user`, …), whose ids are short. A third-party z-tenant — the entire point of the ADK
— cannot put its real contract identity in the field. You're forced to invent a short
logical id (we use `z:aidlink`) and *hope* the host's grant-matching maps it to the real
`z:<tid>:aidlink` script — but the mapping rule is undocumented and untestable without the
sandbox. This is a structural gap between the delegation design and the z-tenant model.

### Workaround in AidLink
Use a short logical id (`z:aidlink`, overridable via `AIDLINK_CONTRACT_ID`) in the
credential, documented at both call sites. Whether the host accepts this for a z-tenant
contract is an open live question (added to the Phase 2 live-run checklist).

### Suggested fix
Document the `contract` max length, state explicitly what z-tenant integrators put there,
and document how the credential `contract` is matched to a `z:<tid>:<tail>` script during
authorization — or widen the field to admit full z-tenant script names.

---

## BUG-013 — Dashboard "Authorized contract" dropdown is a static catalog of generic example intents, unrelated to the caller's real tenant state

**Severity:** Medium/High (casts doubt on whether the documented "authorize your TEE contract via the dashboard" flow actually works for custom developer contracts — the only documented way to grant agent access / egress, per BUG-001/BUG-010)
**Area:** Dashboard / agent-auth grant flow
**Status:** Observed on `testnet.network.terminal3.io` → AI Agents → "Create a new AI Agent"

### What we were trying to do
Complete the agent-auth grant the docs point to (`delegate-access-to-agent.md`: "Select
`Authorized TEE contract`") — the dashboard step that is supposed to authorize our
registered AidLink contract (and, per BUG-010, set its egress allow-list).

### What we found
The **Authorized contract** dropdown is populated with a long, generic catalog of unrelated
example intents spanning many business verticals — **30+ distinct options** observed while
scrolling, none of which reference AidLink or any contract on this account:
- Account/auth: Verify identity, Create account, Reset password, Change password, Enable
  two-factor, Update profile, Update contact info
- Banking: Apply for a personal loan, Check account balance, Transfer funds, Open savings
  account, Request loan extension, Claim insurance, Report fraud
- E-commerce: Order a product, Track order, Return item, Request refund, Process payment
- Travel: Book flight, Reserve hotel, Purchase ticket
- Subscriptions: Cancel subscription, Renew service, Upgrade plan, Downgrade plan
- Support/scheduling: Submit application, Schedule meeting, Request information, File
  complaint, Submit feedback, Book an appointment, Register event, Download statement

### Why this looks like static seed content, not a live list
This account has **zero registered contracts** (registration is blocked on BUG-005's empty
balance) yet the dropdown is full of options — and none of them correspond to anything this
tenant owns. A live, tenant-aware control would be empty (or show only this tenant's
contracts). So the dropdown appears to be **static placeholder/seed data unrelated to the
caller's real tenant state**.

### Why it matters
This is the *only* documented mechanism to authorize a custom TEE contract for agent access
and to set its egress allow-list (BUG-001 showed the docs frame delegation as dashboard-only;
BUG-010 showed egress is described as a per-user dashboard grant). If that dropdown isn't
wired to real developer contracts, then the documented end-to-end "authorize your contract"
path may not actually be functional for third-party z-tenant contracts at all — leaving the
SDK-native delegation primitives (BUG-001) as the only working route. We cannot fully confirm
this until a contract is registered (post-BUG-005), but the evidence is strong.

### Impact on AidLink — not blocking
Phase 2's human-helper authorization already uses the **SDK-native** delegation path
(`buildDelegationCredential` / `signCredential` / `revokeDelegation`, BUG-001), not this
dashboard flow, so AidLink does not depend on it. The open risk it leaves is the **egress
allow-list** (BUG-010): if the dashboard can't authorize our contract's outbound host and no
SDK method does either, the live payout call could be stuck at `egress_denied`. Tracked on the
Phase 1 live-run checklist.

### Suggested fix
Make the "Authorized contract" control reflect the authenticated tenant's actually-registered
contracts (or clearly label the catalog as examples), and document the SDK equivalent for
setting a contract's egress allow-list so the flow doesn't depend solely on the dashboard.
