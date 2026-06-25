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
**Status:** **[OPEN — documentation gap]** Confirmed by reading shipped type definitions; the docs still describe delegation as dashboard-only / "coming soon."

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
**Status:** **[OPEN]** Confirmed — both documented spec URLs still 404.

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
**Status:** **[OPEN — documentation gap]** Confirmed; powerful exports remain undocumented in narrative form (the `executeBusinessContract` tail detail was later confirmed live — see inline).

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
  is undocumented in narrative form. **Live-confirmed 2026-06-22:** `contract` must be the
  target tenant's **local tail** (e.g. `"aidlink"`), NOT the full `z:<tid>:aidlink` script
  name — a full name is rejected with `contract must be a tenant-local contract tail`. With
  the tail it works: a live cross-tenant `check-eligibility` returned real KV data. None of
  this (the method, the arg shapes, the tail requirement) is in the narrative docs.
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
**Status:** **[RESOLVED — ours, via research]** pinned the exact import from the public reference contract `Terminal-3/z-tenant-flight`; the underlying documentation gap (the import is shown in no narrative doc) remains [OPEN].

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
**Status:** **[RESOLVED — Terminal3, platform-side fix after we reported it]** 2026-06-22.
**Discovered by us** via `getUsage()` on **2026-06-19/20** (balance came back `available: 20000`
= 0.02 tokens) and **diagnosed to the exact factor** — the welcome grant was minted in *base
units* instead of *tokens*, i.e. `1,000,000×` (= `BASE_UNITS_PER_TOKEN`) short of the claim
page's promised 20,000 tokens. **Reported to `devrel@terminal3.io` on 2026-06-20** with the DID
and exact `getUsage()` payload. **Resolved 2026-06-22 by Terminal3's own platform-side
correction** — a corrective mint (balance `×1e6` → 39,989 tokens, balance-row `version` 3→4);
**not a workaround on our end** (our client-side conversion was correct throughout). The root
cause (base-units-vs-tokens mint) is preserved below as the original bug.

### Resolution (2026-06-22)
A fresh `getUsage()` re-verification (run before drafting the devrel reply) found the balance
had been corrected since the prior poll:
```
before:  available = 39,989          base units  (version 3)  = 0.039989 tokens
after:   available = 39,989,000,000  base units  (version 4)  = 39,989    tokens
```
The number was multiplied by exactly `BASE_UNITS_PER_TOKEN` (1e6) and the balance-row
`version` incremented once (3 → 4), i.e. a single corrective mint/adjustment. We now hold
**39,989 tokens** — about **2× the promised 20,000**, and roughly **10,000 actions** at the
claim page's ~4-tokens/action ratio. The original bug (grant minted in base units, not tokens
— see below) was real and is preserved for the record; this entry is now closed by the
platform-side correction. **Metered execution is unblocked.** Our client-side conversion was
correct throughout — no error on our side (`BASE_UNITS_PER_TOKEN = 1000000`, `formatTokens`
both re-verified fresh from the installed package).

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

### ✅ Self-admit RUN LIVE 2026-06-22 — confirms it grants nothing; + the missing 10k-token floor
With a real balance and (now-confirmed) verified email, we actually ran the self-admit:
`submitUserInput({ profile, becomeDevTenant: true })` → `{ txHash: "tx:321:71424",
tenantAdmit: { status: "already-admitted" } }`, **`grantedCredits: null`**, and **`getUsage`
delta = +0**. So the separate `granted_credits` bucket this entry speculated about mints
**nothing** for an already-admitted DID — the BUG-005 speculation is closed: self-admit was
never a path to credit. (Reason-2 above — "gated behind a verified email we don't have" —
was also corrected: the claim flow *had* verified the email; `submitUserInput` works directly.)
Separately, BUG-015 found the **missing half of this bug's impact**: there is a hard
**10,000-token minimum-credit floor** (`InsufficientCredit (required=10000000000)`) for any
tenant op, so the original 0.04-token grant wasn't merely small — it was ~250,000× below the
floor, which is why *nothing* metered could run until the corrected ~40k-token grant cleared it.

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
**Status:** **[OPEN — confirmed platform/schema limitation]** DEFINITIVELY CONFIRMED LIVE 2026-06-22 — `{{profile.first_name}}` resolves; `{{profile.bank_account}}` does NOT (`placeholder-unknown`). Custom profile keys are not in the resolved schema (a standing platform limitation; resolved schema still undocumented); validates the org-data-ref fallback as the correct design.

> ### ✅ LIVE RESULT 2026-06-22 — confirmed end-to-end after egress was opened
> With egress finally authorized (BUG-010 workaround, `tx:321:71227`), we ran the real calls:
> - **`{{profile.first_name}}` RESOLVES.** The probe sent the literal template
>   `{{profile.first_name}}`; the host substituted it **inside the enclave before egress** and
>   the echo endpoint received `probe_value: "Olivia"`. The contract never held the plaintext —
>   the privacy mechanism works end-to-end, live.
> - **`{{profile.bank_account}}` does NOT resolve.** The cross-tenant payout cleared egress and
>   reached placeholder resolution, then failed cleanly with
>   `payout call: beneficiary profile missing field: bank_account` (our mapping of the typed
>   `placeholder-unknown`). The delegation **act** and **post-revoke act** both did the same —
>   past egress, stopped at the identical `bank_account` field.
>
> **What this proves:** the resolved profile schema is a **fixed, host-defined set** —
> known fields (`first_name`, `last_name`, …) resolve; an arbitrary custom key written into the
> profile (`bank_account`) is **not** resolvable, returning `placeholder-unknown`. So raw bank
> details cannot live in a `{{profile.*}}` placeholder. This **validates the org-data-ref
> fallback** (keep the account in tenant-private KV/org-data behind a non-PII reference) as the
> *correct* design — not a guess, but the only design the platform actually supports. The
> resolved schema and this rule remain undocumented (the original gap below stands).

> ### ✅ SETTLED 2026-06-24 — the profile is a fixed write-time ALLOW-LIST; bank_account can never be stored
> A write test removed the last ambiguity (does a value make a field resolve, or is there a
> schema allow-list?). Writing FAKE values via `submitUserInput`:
> - **Custom key `bank_account="DUMMY-TEST-BANK-ACCT-0000"` → REJECTED at write:**
>   `Profile validation failed: ValidationResult { issues: [ValidationIssue { path: [],
>   error: UnrecognizedKeys { keys: ["bank_account"] } }] }`. The server enforces a **fixed
>   field allow-list at write time** — a custom key cannot be stored at all.
> - **Known field `country_of_residence="ZZ"` → written OK (`tx:321:74393`) → then RESOLVES
>   `"ZZ"`.** A previously-empty *known* field resolves once it has a value.
>
> **Conclusion:** `bank_account` is not "empty," it is **unstorable** — the profile schema
> rejects it. So raw bank details *cannot* go in the profile by any means, and the
> org-data-ref fallback is **mandatory, not merely preferred**. Bonus finding: the SDK type
> `UserInputProfile` declares `[key: string]: unknown` (implying arbitrary keys are accepted),
> but the server rejects unrecognized keys (`UnrecognizedKeys`) — a **type-vs-server-validation
> mismatch**. (The fake `country_of_residence="ZZ"` value persists on the test profile.)

### Live finding 2026-06-22 (egress wall, now superseded by the result above) — egress is checked BEFORE placeholder resolution
With a real balance, we registered the contract (`contract_id=445`) and ran the cheapest
probe live (self-call, `pii_did` = our own DID, one templated field). The call reached the
contract's `http-with-placeholders` path and returned:
```
bad_request: probe call: egress denied for host postman-echo.com   (host/http.egress_denied)
```
i.e. the typed `EgressDenied` variant — **not** `placeholder-unknown` / `placeholder-denied`.
So the host enforces the **egress allow-list before it resolves `{{profile.*}}` markers**. We
therefore *still* cannot observe whether `{{profile.bank_account}}` (or even
`{{profile.first_name}}`) resolves — the call never gets that far. The blocker moved from
"no tokens" to "no egress grant, and no programmatic way to set it" (BUG-010 / BUG-013).
(At the time of this note bank-account resolution was still untested; it was later resolved
once egress opened — see the LIVE RESULT block at the top of this entry: `first_name` resolves,
`bank_account` returns `placeholder-unknown`. The defensive org-data-ref fallback stands.)

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
**Status:** **[RESOLVED — ours, via live investigation]** the mapped chain is confirmed live (email was already verified by the claim flow; `submitUserInput` writes the profile directly; the self-call resolves `{{profile.first_name}}` → "Olivia"). The OTP roundtrip was also tested to closure and found **non-exercisable on this testnet cluster** (see below — `otpRequest` mints no OTP state/email; `otpVerify` returns "no OTP state found"), which is moot here since `submitUserInput` works without it. The underlying **documentation gap remains [OPEN]** — there is still no published end-to-end "prepare a test user + authorize a contract" guide.

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
   off verification, not mere presence — so whether writing additional profile fields needs an
   OTP roundtrip was an open question at the time. **It was resolved live (see the next
   block): the email IS verified, so `submitUserInput` writes fields directly, no OTP needed.**
   For just *reading* `{{profile.first_name/last_name}}`, the profile is already sufficient.
   **CONFIRMED LIVE 2026-06-22 — email IS verified; no OTP roundtrip needed for this DID.**
   `client.submitUserInput({ profile:{ first_name, last_name }, becomeDevTenant:true })`
   **succeeded** (`{ txHash: "tx:321:71424", userFound: true }`) — it did NOT hit the
   `EmailNotVerified` gate, so the claim flow both bound *and verified* the email. So the
   BUG-007 chain (`otpRequest → otpVerify → submitUserInput`) is real but **the OTP legs are
   unnecessary here**: `submitUserInput` writes the profile directly. **The OTP roundtrip is
   also non-exercisable on this cluster (skip-OTP test mode):** `otpRequest` returns
   "success" — `{ contact: "olivygungin@gmail.com", channel: "email", txHash: "tx:321:71429",
   isNewProfile: false }` — but with **no `expiresAtSec` and no `status`**, which the SDK doc
   says marks a `skip_otp` test environment. Consistent with that, **no code email is ever
   delivered** (the inbox holds only the "Welcome to Agent Developer Kit" mail), and
   `otpVerify` with any code (`000000`/`123456`/`111111`) fails not with "wrong code" but with
   **`host/otp.verify: OTP code provided but no OTP state found`** — i.e. `otpRequest` minted no
   pending OTP state at all. So the documented `otpRequest → otpVerify` roundtrip **cannot be
   completed here**; a developer relying on it to onboard a user would be stuck (the call looks
   successful but is inert). Net correction to the mapped chain: for a claim-verified DID,
   `submitUserInput` stands alone; the OTP roundtrip is both unnecessary *and* inert on testnet.
   **Related dashboard note (agent-auth / question #4 + BUG-010):** the **AI Agents** tab
   exists with a "New agent" button and an Agent-DID / Authorized-contract table, currently
   **empty**. This is the dashboard surface for the agent-auth grant (authorized scripts +
   allowed hosts). **Followed up after registration:** with the contract registered
   (`contract_id=445`) the dropdown **still does not list it** (confirmed live, BUG-013, which
   Terminal3 devrel acknowledged as a tracked bug); egress was ultimately opened via the
   *undocumented* `tee:user/contracts::agent-auth-update` call instead (BUG-010).
2. **Whether a self-call (`pii_did` = own DID) resolves `{{profile.*}}` with no explicit
   agent-auth grant**, or whether even self-calls require the contract to be listed as an
   authorized script. The WIT comment ties resolution to the agent-auth grant unconditionally;
   only a live call settles whether "self" is auto-authorized.
3. **Whether custom profile keys (`bank_account`) resolve** — see BUG-006; live-only.
   **Live attempt 2026-06-22:** contract now registered (`contract_id=445`); the probe
   self-call (`pii_did` = our own DID, `{{profile.first_name}}`) returned **`egress denied`**,
   not a placeholder error — so the host checks egress *before* resolving markers and the
   resolution question (for `first_name` and `bank_account` alike) is **still unanswered**,
   now gated on the egress allow-list (BUG-010) rather than on a profile/grant. To settle it
   we need the egress host authorized first; resolution of `{{profile.*}}` is downstream of that.
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
**Status:** **[OPEN — documentation gap]** Confirmed (`index.d.ts` + a live error observed)

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
**Status:** **[OPEN — documentation gap]** Confirmed

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
**Status:** **[Workaround supplied by Terminal3 devrel — underlying discoverability/doc gap OPEN]**
a programmatic setter exists and works
(`tee:user/contracts::agent-auth-update`, verified live `tx:321:71227`), but it is
**undiscoverable from any public doc or SDK surface**;
we only obtained it via direct devrel support after raising BUG-013. The contradiction (three
names) and the discoverability gap remain real developer-experience defects.

> ### ✅ RESOLUTION + LIVE RESULT 2026-06-22 — there IS a programmatic path (undocumented)
> After we raised BUG-013, Terminal3 devrel supplied the working call. Egress for a custom
> contract is set by invoking the **user contract** (not a tenant/contract API):
> ```ts
> const version = await getScriptVersion(baseUrl, "tee:user/contracts");   // → "2.14.0"
> await client.executeAndDecode({
>   script_name: "tee:user/contracts",
>   script_version: version,
>   function_name: "agent-auth-update",
>   input: { agents: [{ agentDid: "<our DID>",
>                       scripts: [{ scriptName: "*", allowedHosts: ["postman-echo.com"] }] }] },
> });
> ```
> `scriptName: "*"` wildcards all our contracts (also sidesteps BUG-003's tail-vs-full-name
> trap). **It worked first try** — `{ tx_hash: "tx:321:71227" }` — and egress immediately
> opened: the very next `http-with-placeholders` call **resolved `{{profile.first_name}}` to
> "Olivia" live** (host substitution end-to-end; see BUG-006), and the cross-tenant payout +
> the delegation act both **cleared egress** (they now fail only on the missing `bank_account`
> field, not on egress).
>
> **Why this stays an open DX gap, not a closed bug:** none of this — that egress is governed
> by `tee:user/contracts::agent-auth-update`, that `allowedHosts` lives there, that `scriptName`
> accepts `"*"` — appears in **any** public doc, the SDK type-level surface, or the dashboard.
> It is reachable only by knowing the exact `function_name` and payload shape, which we got
> from a human at devrel. A developer following the published docs **cannot** find it; the
> dashboard path that the docs point to is itself broken (BUG-013, devrel-acknowledged). So
> the platform *can* do this — but the documented/discoverable surface still can't.

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
**Status:** **[OPEN]** Confirmed (README vs. `world.wit` / `Cargo.toml` / `booking.rs` in the same repo, `main`) — the reference repo is still internally inconsistent.

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
**Status:** **[OPEN — limitation + undocumented]** Confirmed empirically (Phase 2 build); worked around with a short logical contract id.

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
`z:<tid>:aidlink` script — but the mapping rule is undocumented and remains unverified in
practice (we built/signed/revoked credentials live with the short id, but a credential-bound
invocation that would exercise the id→script mapping wasn't completed — it was blocked
downstream on egress/`bank_account`). This is a structural gap between the delegation design
and the z-tenant model.

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
**Status:** **[CONFIRMED by Terminal3 — externally validated, not yet fixed]** confirmed live 2026-06-22 (with a contract genuinely registered the dropdown still doesn't list it), and **Terminal3's own devrel team acknowledged this as a known, tracked platform bug**.

> ### ✅ External validation 2026-06-22 — Terminal3 devrel confirmed this is a tracked bug
> After we raised the dashboard finding, Terminal3 devrel (Ian) confirmed it directly,
> describing it as a **"known limitation … tracking that as a separate bug,"** and supplied the
> programmatic workaround (the `tee:user/contracts::agent-auth-update` call — see BUG-010).
> This is independent, first-party confirmation of the finding: the "Authorized contract"
> dashboard flow does **not** surface custom registered contracts, so the documented
> authorize-your-contract path is non-functional for developers and is being tracked
> platform-side. The supplied SDK workaround then **worked live** (`tx:321:71227`) and opened
> egress — but that path is undocumented (BUG-010), so without devrel contact a developer
> would remain blocked here.

### Confirmation 2026-06-22 — registered contract still does NOT appear in the dropdown
After registering AidLink live (`contract_id=445`, minutes earlier), we opened the AI Agents
→ "Create a new AI Agent" → **Authorized contract** dropdown **for the real Agent DID**
(`did:t3n:5cc23ceebac85b5e…`). The dropdown **still shows only the generic placeholder
catalog** (Verify identity, Apply for a personal loan, Book flight, …) — **no AidLink /
`z:5cc2…:aidlink` / contract-445 entry**. So the control is definitively **not wired to the
tenant's actually-registered contracts**, even when one exists. **Consequence:** there is
currently **no way — dashboard or SDK — to authorize a custom registered contract**, and
therefore no way to add its outbound host to the egress allow-list. This is the concrete,
live-confirmed reason the egress wall (BUG-010) **cannot be self-served**. The two findings
are the same blocker seen from two ends: BUG-010 = "egress denied, no setter found";
BUG-013 = "the only documented setter (the dashboard authorize-contract flow) doesn't
recognize the contract." Together they mean the live `http-with-placeholders` payout /
placeholder-resolution path is **platform-blocked**, not blocked by our implementation.

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
SDK-native delegation primitives (BUG-001) as the only working route. We **did** register a
contract (`contract_id=445`) and confirmed this directly — the dropdown still did not list it,
and Terminal3 devrel acknowledged the bug (see Status).

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

---

## BUG-014 — `revokeDelegation` throws `ERR_INVALID_URL` under Node unless `baseUrl` is passed; the option is documented as optional but is effectively required off-browser

**Severity:** Medium (the documented revoke path crashes in the exact Node/server context the SDK targets, with a cryptic URL error)
**Area:** Delegation / `revokeDelegation`
**Status:** **[RESOLVED — ours, workaround]** confirmed live, then worked around by passing `baseUrl` explicitly (revoke then succeeded live); the underlying SDK defect remains [OPEN] for anyone not passing it.

### What we were trying to do
Run the human-helper revocation live: `revokeDelegation({ credentialJcsB64u, client })`.

### What happens
With only the documented-minimal opts, the call throws:
```
TypeError: Failed to parse URL from /api/contracts/current?name=tee%3Adelegation%2Fcontracts
  at fetchCurrentScriptVersion (.../t3n-sdk/dist/index.esm.js …)
  at getScriptVersion (…)
  at revokeDelegation (…)
  cause: { code: 'ERR_INVALID_URL', input: '/api/contracts/current?name=tee%3Adelegation%2Fcontracts' }
```
Root cause: when `scriptVersion` is omitted, `revokeDelegation` resolves `"latest"` by
`fetch()`-ing the **relative** path `/api/contracts/current?...`. Node's `fetch` (undici)
requires an **absolute** URL — only a browser would resolve the relative path against an
origin. So the default path crashes in exactly the Node/server runtime the SDK is meant for.

### What the docs / types say
`RevokeDelegationOpts.baseUrl` is documented as *"Override the node base URL used for
`latest` resolution"* — i.e. **optional, an override**. In a Node process it is **required**;
without it the resolution fetch has no base and throws. Nothing flags this.

### Fix / workaround
Pass `baseUrl` explicitly (or a concrete `scriptVersion`):
```ts
await revokeDelegation({ credentialJcsB64u, client, baseUrl: getNodeUrl() });
```
With `baseUrl: getNodeUrl()` the revoke **succeeded live** —
`{ vcId: "73Gtw_acn94b7GK92egSSg", revokedFunctions: null }`.

### Suggested fix
Default `baseUrl` from the authenticated `client`'s resolved node URL (the client already
knows it), or make the relative-URL resolution absolute; failing that, document `baseUrl`
as required in non-browser environments. The same `getScriptVersion` path likely affects
`DelegationCustodialClient` and any other `"latest"` resolver.

---

> Entries below (BUG-015 … BUG-017) come from a no-deadline **live exploration pass** —
> exercising surfaces previously only mapped from the `.d.ts`, against the real testnet.

## BUG-015 — A 10,000-token minimum-credit floor gates ALL tenant ops; a fresh DID gets 0 welcome grant; no SDK path to fund a second tenant

**Severity:** Medium/High (a genuine second tenant can't be self-provisioned; also the missing piece that explains BUG-005)
**Area:** Tokens / metering / tenant onboarding
**Status:** **[OPEN]** Confirmed live — platform limitation (10k-token floor; fresh DID gets 0; no funding path), all undocumented.

### What we were trying to do
Provision a genuine SECOND tenant/DID (verification vs disbursement as two distinct, real
identities) so Phase 2's cross-tenant call runs across a true boundary, not the single-DID
fallback.

### What actually happens
A fresh ETH key authenticates fine to a new DID (`did:t3n:6dde…3959`), but:
```
getUsage → available: 0 base units            # a fresh DID gets NO welcome grant on auth
tenant.me() → 403 forbidden:
  InsufficientCredit (account=6dde…, required=10000000000, available=0)
contracts.register → same 403 InsufficientCredit (required=10000000000)
```
So there is a hard **minimum-credit floor of 10,000,000,000 base units = 10,000 tokens** to
perform *any* tenant operation — including the read-only `me()` and contract registration.
A brand-new DID has 0 balance (the welcome grant comes from the **dashboard claim flow**, not
from authenticating), and the SDK exposes **no token-transfer method** (`transfer` exists only
as a `TokenTxKind` in the ledger, not as a client call), so there is no way to fund the new DID
from our funded one.

### Two consequences
1. **A real A≠B two-tenant setup is not self-serviceable.** It requires a *second account
   claimed via the dashboard* (to trigger a welcome grant ≥ the floor). With one funded DID, the
   documented single-DID fallback (A=B, loud warning) is the only option — which is what
   AidLink's `agents.ts` already does. The cross-tenant **call shape/path** is exercised live;
   a true distinct-identity boundary needs a second claimed tenant.
2. **This is the missing half of BUG-005.** The original buggy grant was 0.04 tokens — not just
   "small," but *three orders of magnitude below the 10,000-token floor*, so literally nothing
   metered could run. The corrected ~40,000-token grant clears the floor, which is exactly when
   our live phases started working.

### What the docs say
Nothing — the 10,000-token floor, the "fresh DID gets 0" behavior, and the absence of a funding
path are all undocumented. `InsufficientCredit` with a fixed `required=10000000000` is the only
signal, and only at call time.

### Suggested fix
Document the minimum-credit floor and the per-op credit model; provide a testnet faucet or an
SDK transfer so developers can stand up multiple tenants for legitimate multi-agent testing.

## BUG-016 — Advertised multi-protocol agent identity (A2A card / ERC-8004 / Entra / MCP / Web Bot Auth) is not present in the SDK, not resolvable, and not documented

**Severity:** Medium (a headline "multi-protocol" capability has no discoverable surface)
**Area:** Agent identity / interop
**Status:** **[OPEN]** Confirmed (SDK + live endpoints + docs all checked) — the advertised multi-protocol surface is absent/undocumented.

### What we were trying to do
Resolve our registered agent/contract to an **A2A agent card** (and check ERC-8004 / Entra
Agent ID / MCP / Web Bot Auth), per the stated multi-protocol identity feature.

### What we found — three independent dead ends
1. **SDK:** `@terminal3/t3n-sdk@3.9.0` exports **no** A2A / agent-card / ERC-8004 / Entra / MCP
   methods or types (`grep` over `index.d.ts` finds none). The only agent-identity primitive is
   the host-side WIT `agent-registry::register-agent(agent-uri, owner-eth-address)` — write-only
   on-chain registration, with no client-side resolver.
2. **Live endpoints:** every plausible resolver 404s —
   `{node}/.well-known/agent.json`, `/.well-known/agent-card.json`, `/api/agents/<did>`,
   `/agents/<did>`, and the same under `api.terminal3.io`. No agent card resolves for our DID or
   `contract_id=445`.
3. **Docs:** `llms.txt` lists **no** page mentioning A2A, ERC-8004, Entra, MCP, Web Bot Auth, or
   agent cards; the DID pages (`how-t3n-works/did.md`) describe DIDs only and explicitly contain
   none of these.

### Why it matters
"Resolve a `did:t3n` to an A2A card / ERC-8004 / Entra Agent ID" is promoted as a platform
capability, but a developer cannot find or call it anywhere — not in the SDK, not over HTTP, not
in the docs. Either it isn't shipped in this SDK version/cluster, or it's entirely undocumented.

### Suggested fix
If the multi-protocol resolution exists, publish the resolver endpoint(s) and an SDK method +
example; if it's roadmap, mark it as such rather than as a current feature.

## BUG-017 — `OrgDataClient` grants (setGrants/grantsGet/deleteGrants) are gated behind an undocumented "organisation" entity + policy init, distinct from a tenant/user DID

**Severity:** Medium (a whole authz layer — the org-contract `UserGrant` model from BUG-001 — is unreachable without undocumented org onboarding)
**Area:** Org-data grants / policy
**Status:** **[OPEN]** Confirmed live — undocumented organisation + policy onboarding prerequisite gates the whole grants API.

### What we were trying to do
Exercise the org-contract grant lifecycle mapped from the type defs in BUG-001:
`createOrgDataClientFromSession` → `setGrants`/`grantsGet`/`deleteGrants` for our contract.

### What actually happens (in order)
```
setGrants  → OrgPolicyNotInitialised: org policy is not initialised for this organisation
createPolicy({ orgDid: <our DID>, initialAdminDid: <our DID> })
           → OrganisationNotFound: organisation does not exist
policyGet  → OrgPolicyNotInitialised
```
So the chain is: an **organisation** must exist first → then `createPolicy` initialises its
policy → only then do `setGrants`/`grantsGet`/`deleteGrants` work. Our **user/tenant DID is not
an organisation** (`OrganisationNotFound`), and nothing in the SDK surface creates one
(`SubmitUserInputArgs` has an `organisationDid` field, hinting orgs are a separate entity, but no
"create organisation" call is exposed/documented). The org-data grant tier is therefore a
**separate, undocumented onboarding path** from the tenant/contract flow we used for everything
else.

### Bonus (audit-events, same run)
- `getAuditEvents()` (self) **works** but returns `batches: 0` — the host `audit.get-mine` feed
  is empty for us; host-level audit events require explicit contract emission (distinct from
  AidLink's own app-side hash-chained ledger, which captured every action).
- `getAuditEvents({ pii_did: <other DID> })` (delegated read) is **correctly refused** live:
  `403 audit.get-mine: <our DID> holds no live agent-auth grant from <other DID>`. This is a
  clean **live confirmation** of the agent-auth delegated-read model (BUG-001) — you can read
  another user's trail only while their grant to you is live.

### Suggested fix
Document organisation creation as a prerequisite for the org-data/grants API (and expose/point
to the call that creates one), or clarify that `OrgDataClient` targets enterprise orgs, not
individual tenant DIDs.

---

> Entries below (BUG-018 …) are from a second no-deadline **live bug-hunting round**.

## BUG-018 — Cross-tenant authorization is untestable with a throwaway identity: the credit floor rejects the call before any grant/authz check runs

**Severity:** Medium (security-review obstacle; the actual cross-tenant authz behavior is undetermined — see open question)
**Area:** Cross-tenant invocation / authorization / metering order
**Status:** **[OPEN — security question undetermined]** confirmed live that credit is checked before authz; the authz outcome itself could not be observed.

### What we were trying to do
Answer the highest-value open security question: when a **genuinely different DID** (not the
single-DID fallback) calls `executeBusinessContract` against AidLink's verification contract
`check-eligibility` **with no grant in place**, does the platform (a) cleanly reject, (b)
silently succeed (a serious finding — any DID could read another tenant's contract output), or
(c) something else?

### What actually happens
A fresh key → new DID `did:t3n:b6cc…b91e` (confirmed `≠` our verification DID), then:
```
B → executeBusinessContract({ tenant: A, contract: "aidlink",
                              functionName: "check-eligibility", input: { beneficiary_id } })
→ 403 forbidden: InsufficientCredit (account=b6cc…, required=10000000000, available=0)
```
The call is rejected on the **10,000-token credit floor (BUG-015) before any cross-tenant
grant/authorization is evaluated** — so the security-relevant question (clean authz rejection
vs. silent cross-tenant read) is **masked** and remains **undetermined**.

### Why this matters
1. **Ordering finding:** credit is enforced ahead of cross-tenant authz. A caller with no
   credit never reaches the authz layer.
2. **Security-review obstacle:** because a fresh DID gets 0 welcome grant and there is **no SDK
   funding/transfer path** (BUG-015), a researcher *cannot* probe the cross-tenant
   authorization boundary with a disposable identity — testing it costs a second, separately
   funded, claimed account (≥10,000 tokens). That raises the bar for legitimate security
   testing of exactly the boundary that matters most for a multi-tenant agent platform.

### Open question / how to close it
Needs a **second, separately-claimed, funded DID** (different email → its own welcome grant
clearing the floor). With that, repeat the call and record whether the uninvited cross-tenant
`check-eligibility` is rejected (and the exact error) or silently returns the decision.

### A funded second DID is NOT self-serviceable (2026-06-24 — circular block confirmed)
We attempted to self-provision a funded second identity programmatically. It is **impossible**
on this testnet via any SDK path — a hard circular dependency:
- A fresh key authenticates to a new DID with **0 balance** (no welcome grant on auth — the
  grant only comes from the dashboard claim flow). → blocked on the 10k-token floor (BUG-015).
- The only programmatic mint is testnet self-admit, `submitUserInput({ becomeDevTenant: true })`,
  but on a fresh DID it fails: **`email_not_verified: caller has no verified email … Run
  otp-request + otp-verify first`**.
- Binding/verifying an email requires the OTP roundtrip — which is **inert on this cluster**
  (BUG-007: `otpRequest` mints no state, `otpVerify` → "no OTP state found"). So the email can
  never be verified, so self-admit can never run, so the DID can never be funded.

**Net:** `fresh DID (0 balance) → needs funding → needs self-admit → needs verified email →
needs OTP → OTP inert → back to start.` A funded second identity can only be created by the
**dashboard claim flow** (a real email + web form), which an autonomous agent cannot perform.
So the cross-tenant authz security test **requires the operator to claim a second account on a
different email and hand over the key** — flagged to the maintainer. Worth noting as its own
DX/security-testing gap: a researcher cannot stand up a second identity to probe the
multi-tenant boundary without operator intervention.

### Suggested fix (platform)
Evaluate cross-tenant authorization *before* (or alongside) the credit check, so an
unauthorized caller gets a deterministic authz rejection rather than a credit error — and
provide a testnet faucet / SDK transfer so the boundary is testable with throwaway identities.

---

## BUG-019 — The resolved `{{profile.*}}` schema, mapped (the doc Terminal3 hasn't published) — input field names ≠ resolved paths, and there is no field-name allow-list

**Severity:** Medium/High (you cannot reliably author `{{profile.*}}` markers without this map; the platform publishes none of it)
**Area:** Placeholders / resolved-profile schema
**Status:** **[OPEN — documented here in lieu of platform docs]** mapped live 2026-06-23 by probing every field through `http-with-placeholders`.

### Method
For each candidate field, `probe-placeholder` templates `{{profile.<field>}}`, the host resolves
it (or not) on the outbound stack, and the echo endpoint reports the substituted value. Outcome
classes: **RESOLVED** (value substituted), **EMPTY/ABSENT** (`placeholder-unknown`), **DENIED**
(`placeholder-denied`). PII masked to first char + length.

### The map (claim-created profile: name + email + role populated)
| `{{profile.<field>}}` | outcome | note |
|---|---|---|
| `first_name` | **RESOLVED** | `O…`, 6 chars ("Olivia") |
| `last_name` | **RESOLVED** | `G…`, 6 chars ("Gungin") |
| `role` | **RESOLVED** | 13 chars — populated by the claim flow (not shown in the dashboard Profile tab) |
| `verified_contacts.email.value` | **RESOLVED** | 21 chars (the on-file email) |
| `email_address` | EMPTY/ABSENT | **flat input name does NOT resolve** — the email lives at `verified_contacts.email.value` |
| `phone_number` | EMPTY/ABSENT | (the resolved path would be `verified_contacts.phone.value`, also empty here) |
| `verified_contacts.phone.value` | EMPTY/ABSENT | phone not verified on this profile |
| `country_of_residence` | EMPTY/ABSENT | empty on this profile |
| `document_issuance_country` | EMPTY/ABSENT | empty |
| `ssn` | EMPTY/ABSENT | empty |
| `address` | EMPTY/ABSENT | empty |
| `campaign_code` | EMPTY/ABSENT | empty |
| `date_of_birth` | EMPTY/ABSENT | empty |
| `gender` | EMPTY/ABSENT | empty |
| `bank_account` | EMPTY/ABSENT | custom key — no value (see BUG-006) |
| `iban` | EMPTY/ABSENT | custom key — no value |
| `nonexistent_field_xyz` | EMPTY/ABSENT | arbitrary name → **`placeholder-unknown`, NOT `placeholder-denied`** |

### Findings
1. **Resolved schema ≠ SDK input schema.** `email_address` (a real `UserInputProfile` *input*
   field) does **not** resolve; the resolvable path is the nested `verified_contacts.email.value`.
   So markers must target the **host-side resolved profile**, whose shape differs from the SDK's
   `UserInputProfile` field names — concrete proof of the divergence flagged in BUG-006.
2. **No field-name allow-list.** `nonexistent_field_xyz`, `bank_account`, `iban` all return
   `placeholder-unknown` (EMPTY/ABSENT) — **never** `placeholder-denied`. So the host accepts
   *any* `{{profile.<name>}}` path and resolves it if a value exists; it does not reject unknown
   names. (`placeholder-denied` is reserved for non-`profile` namespaces / malformed markers.)
3. **EMPTY/ABSENT conflates "field empty" with "no resolved mapping" — now disambiguated by a
   write test (2026-06-24, see BUG-006 "SETTLED"):** writing a value into the empty *known*
   field `country_of_residence="ZZ"` makes it **RESOLVE** (`"ZZ"`); writing the *custom* key
   `bank_account` is **REJECTED at write** (`UnrecognizedKeys`). So the schema is a **fixed
   allow-list enforced at WRITE time**, not at resolution time: a known field resolves once it
   has a value; an unrecognized key can never be stored (and so never resolves). This refines
   finding #2 — resolution is lenient (any `profile.<name>` → `placeholder-unknown` if absent),
   but *writes* are strict (unknown keys → `UnrecognizedKeys`). The SDK's `UserInputProfile`
   `[key: string]: unknown` is misleading: the server does not accept arbitrary keys.

### Side-finding — undocumented egress rate limit
The first pass hit **`HTTP 500 too_many_requests: quota exceeded`** on the 11th probe within a
minute. This is the tenant quota **`outbox_calls_per_minute_max: 10`** (visible in
`tenant.me().quotas`) enforced on `http`/`http-with-placeholders` egress. Undocumented in the
narrative docs; a contract doing >10 outbound calls/min will be throttled with a 500.

### Suggested fix
Publish the canonical resolved-profile schema (every resolvable path, e.g.
`verified_contacts.{email,phone}.value`, and how it maps from the `UserInputProfile` input
names), state that unknown `profile.*` names resolve to `placeholder-unknown` rather than being
rejected, and document the per-minute outbox egress cap.

---

## BUG-020 — A contract version bump assigns a NEW `contract_id`, which silently loses access to existing KV maps (ACLs reference the old id) — an undocumented upgrade footgun

**Severity:** High (a routine version upgrade silently breaks a working contract's data access)
**Area:** Contract lifecycle / KV ACLs
**Status:** **[OPEN]** confirmed live 2026-06-23.

### What we found (contract lifecycle, end-to-end live)
| Action | Result |
|---|---|
| `register aidlink @0.1.1` (higher version) | ✅ OK — **new `contract_id=447`** (the 0.1.0 contract was `445`) |
| `register aidlink @0.1.0` (non-increasing) | ⛔ `contract version invalid: version 0.1.0 is not higher than current version 0.1.1` |
| `invoke aidlink @0.1.1` (the new version) | ⛔ **`kv read: kv_store.get on 'z:<tid>:eligibility' read denied: access denied`** |
| `register aidlink-lifecycle @0.1.0` (throwaway) | ✅ OK — `contract_id=448` |
| `disable(aidlink-lifecycle)` | ✅ `{}` |
| `invoke` after disable | ⛔ `403 forbidden: contract z:<tid>:aidlink-lifecycle is Disabled` |
| `enable(aidlink-lifecycle)` | ✅ `{}` (the "Disabled" error clears) |
| `unregister` while enabled | ⛔ `contract must be disabled before it can be unregistered` |
| `disable` → `unregister` | ✅ `{}` then `{}` (unregister works once disabled) |

### The footgun (headline)
Registering a **new version** of a contract mints a **new `contract_id`** (445 → 447). But KV
map ACLs are keyed by `contract_id` — our `eligibility` map was created with
`readers/writers: { only: [445] }`. So the freshly-registered **0.1.1 (id 447) is denied read
access** to the very map the 0.1.0 (id 445) contract created and uses: `read denied: access
denied`. The same happened to the throwaway (id 448). **A version upgrade therefore silently
breaks a contract's own data access** unless you also `tenant.maps.update` every map to add the
new `contract_id` to its reader/writer sets. Nothing documents this; the upgrade looks
successful and only fails at runtime on the first KV read.

### Lifecycle method behavior (all confirmed, as documented + a few undocumented details)
- **Version monotonicity** is enforced with the exact error above (matches `common-errors.md`).
- **`disable`** works; a disabled contract returns `403 ... is Disabled` on invoke.
- **`enable`** works (clears the Disabled state).
- **`unregister`** has an undocumented precondition: the contract **must be disabled first**
  (`contract must be disabled before it can be unregistered`); after `disable` it succeeds.

### Side note (positive security signal)
This run also demonstrates **per-`contract_id` KV ACL enforcement**: contracts 447 and 448 —
same tenant, same WASM, different `contract_id` — were **denied** reading the map owned by 445.
The ACL is enforced per contract id, not per tenant (relevant to BUG-021 / cross-tenant KV).

### Suggested fix
Either keep `contract_id` stable across version bumps, or have `maps.create`/`register`
support ACLs keyed by contract *name* (tail) rather than the numeric id, and document that a
version bump requires re-granting map ACLs. Document the `disable`-before-`unregister` rule.

---

## BUG-021 — Private KV is properly protected, but the documented public-KV exposure mechanism is broken (two ways)

**Severity:** Medium (the security posture is GOOD; the bug is that the *public* path is misdocumented/non-functional)
**Area:** KV maps / public exposure / cross-tenant access
**Status:** **[OPEN]** confirmed live 2026-06-23.

### What we were trying to do
Confirm AidLink's private `eligibility` / `secrets` maps cannot be read across the tenant
boundary, and characterise the public-KV read path for contrast.

### Security result — private maps are NOT leaked (good)
The unauthenticated public-KV endpoint returns **404** for every private map + key:
```
GET {node}/api/dev/public-kv/<tid>/eligibility        → HTTP 404
GET {node}/api/dev/public-kv/<tid>/secrets            → HTTP 404
GET {node}/api/dev/public-kv/<tid>/eligibility/ben_001→ HTTP 404
```
Combined with the **per-`contract_id` ACL enforcement** demonstrated in BUG-020 (contracts
447/448 — same tenant, different id — were denied reading 445's map), private KV is properly
access-controlled: no public-endpoint leak, and even same-tenant contracts with the wrong id
are denied. A foreign DID has no contract under our `tid` and cannot register one (it would hit
the credit floor, BUG-018/BUG-015), so it has no in-TEE path to the map either.

### The bug — the documented *public* read path doesn't work (two independent breakages)
`create-kv-maps.md` says a public map is "World-readable via `/api/dev/public-kv/<tid>/<tail>`"
and that the "tail must prefix with `public:`". Neither holds:
1. **You cannot create a `public:`-prefixed tail.** `maps.create({ tail: "public:probe", … })`
   is rejected: `Tenant name tail must match /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,127}$/` — the regex
   **forbids the colon**, so the documented `public:` prefix is impossible to create.
2. **A `visibility:"public"` map is not served at the documented endpoint.** Creating
   `maps.create({ tail: "probe", visibility: "public", readers: "all" })` succeeds and seeding a
   value succeeds, but `GET /api/dev/public-kv/<tid>/probe` (and `/probe/hello`) both return
   **404**. So the public-read endpoint does not serve a `visibility:"public"` map by tail.

So the public-KV feature, as documented, is non-functional on this cluster: the `public:` tail
is uncreatable, and a public-visibility map isn't reachable at the documented URL. (Throwaway
`probe` map deleted after the test.)

### Why it matters
A developer following `create-kv-maps.md` to publish world-readable data cannot do it by the
documented method — both the tail convention and the endpoint contradict reality. (The flip
side — that this means private data is never accidentally exposed — is reassuring, but the
documented public path should either work or be corrected.)

### Open sub-item
A direct cross-tenant *read attempt from a funded foreign DID* (vs. the public endpoint) shares
BUG-018's blocker: a fresh DID hits the credit floor before any KV/authz check, and there is no
SDK funding path. Needs a second funded DID to complete (flagged to maintainer).

### Suggested fix
Either make `visibility:"public"` maps served at `/api/dev/public-kv/<tid>/<tail>`, or correct
`create-kv-maps.md` to the actual mechanism; and reconcile the "`public:` tail prefix"
instruction with the tail-validation regex that forbids colons.
