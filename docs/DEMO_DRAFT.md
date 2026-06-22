# AidLink — Demo Narrative (DRAFT — not recorded yet)

> Working draft for the ~2-minute submission video + written walkthrough. Leads with the
> **local proof**, then shows the **live testnet wins** (registration, eligibility,
> cross-tenant call, delegation revoke), and frames the single remaining step
> (the `http-with-placeholders` payout) as **platform-blocked on egress authorization**, not
> a gap in the build. Update bracketed dates before recording.

**Timeline facts to cite:** the original token-grant bug (BUG-005, welcome grant minted
1,000,000× short) was reported to `devrel@terminal3.io` on **2026-06-20** and **corrected** —
we then ran the live phases below. A second, independent platform block — egress
authorization for custom contracts (BUG-010 + BUG-013) — remains and is reported. Submission
deadline **2026-06-22 23:59 GMT+8**.

---

## 0. One-liner (open on this)
> "AidLink lets a government verification agent and an NGO disbursement agent jointly
> approve and pay a disaster-relief beneficiary — **without either agent ever seeing the
> beneficiary's bank account number**, and with a revocable, time-boxed fallback for
> beneficiaries who have no phone. Built on Terminal 3's Agent Auth SDK and a Rust→WASM
> TEE contract."

Why this use case: it's a **fifth, undemoed vertical** (disaster relief) — deliberately
not one of T3's four reference agents (payroll, procurement, e-visa, travel).

---

## 1. LEAD: what's proven, right now, on this machine (≈45s)
Show the terminal. These all run today, zero sandbox dependency:

1. **The TEE contract compiles to a real WASM component.**
   `cargo build --target wasm32-wasip2 --release` → `aidlink.wasm` (173 KB).
   `wasm-tools component wit aidlink.wasm` shows it imports exactly the four host
   capabilities (`tenant-context`, `logging`, `kv-store`, `http-with-placeholders`) and
   exports `z:aidlink/contracts@0.1.0` with `check-eligibility`, `disburse-payout`,
   `probe-placeholder`. *This is the actual artifact the node would register.*

2. **11/11 tests pass, including the privacy guards.**
   `cargo test` → 11 passing. Call out three by name:
   - `placeholders_are_templates_not_real_values` — the contract can only ever emit
     `{{profile.bank_account}}`, never a literal account number.
   - `inline_bank_account_is_rejected` — the payout entrypoint refuses any request that
     tries to pass an account inline; PII must flow through the host placeholder path.
   - (integration) `payout returns a MASKED account ... no-PAN-leak` —
     `assert.doesNotMatch(response, /\d{6,}/)` so a leaked account number fails the build.

3. **The payout endpoint enforces the privacy boundary itself.**
   `yarn mock-payout`, then show live curls:
   - resolved account `GB29 NWBK … 6819` → returns `{"account_masked":"****6819","status":"paid"}`.
   - a body still containing `{{profile.bank_account}}` → **HTTP 422 `unresolved_placeholder`**.
   - bad bearer → **401**.
   The masking happens *outside* the contract; the contract never holds the full number.

4. **Phase 2 is proven locally too — with the real SDK crypto, offline.**
   `yarn tsx --test tests/phase2-*.ts tests/audit.local.test.ts` → 12 passing:
   - **Delegation (real `@terminal3/t3n-sdk` primitives, no mock):** `buildDelegationCredential`
     produces a credential that is **time-boxed** (`not_after = not_before + window`,
     expires outside it), **function-scoped** (sorted/deduped/lowercased), and the
     beneficiary's `signCredential` signature **recovers to the beneficiary's own address**
     via `ethRecoverEip191`. `validateCredentialBody` accepts the good one and rejects an
     empty function set — the same invariants the Rust side enforces.
   - **Cross-tenant control flow (SDK-client boundary mocked):** the disbursement agent
     calls the verification agent with the exact `executeBusinessContract({ tenant, contract,
     functionName: "check-eligibility", input })` shape, and **a denied eligibility never
     reaches `disburse`** — the core safety invariant.
   - **Audit ledger:** hash-chained; tampering with any row breaks `verify()`; accounts only
     ever rendered masked.

5. **The developer log is itself a deliverable.** Open `BUGS.md`: **14** grounded entries
   (token-grant unit bug, undocumented SDK delegation surface, missing OpenAPI, the
   resolved-profile schema gap, the test-user onboarding gap, three doc/SDK error-handling
   and egress contradictions found in a dedicated pass, the reference-repo README that
   contradicts its own code, the delegation `ContractTooLong` z-tenant gap …), each with
   exact errors, doc citations, and suggested fixes.

> Takeaway line: "Everything that defines the privacy and delegation guarantees — the
> contract, both phases' tests, the endpoint behavior — is built and verified. What's left
> is a metered button-press."

---

## 2. The architecture (≈35s, diagram over voiceover)
- **Verification agent (tenant A, gov side):** holds eligibility data in a private
  `z:<tid>:eligibility` KV map; exposes `check-eligibility`. No PII in or out.
- **Disbursement agent (tenant B, NGO side):** calls A cross-tenant via
  `executeBusinessContract`, then `disburse-payout`.
- **The PII-safe payout:** the Rust contract templates `{{profile.first_name}}` /
  `{{profile.bank_account}}` into the request body; the T3N host substitutes them from the
  beneficiary's profile **inside the enclave, after the contract serializes the body and
  before egress**. A compromised contract reading the bytes back sees only the template.
  (Cite the host WIT doc-comment verbatim — it's the platform's own guarantee.)
- **Human-helper fallback (Phase 2):** beneficiary signs a `buildDelegationCredential`
  that is **time-boxed** (`not_before_secs`/`not_after_secs`) and **function-scoped**; the
  volunteer acts once while it's live; the beneficiary calls `revokeDelegation`; the next
  attempt is denied (`NotCredentialHolder`). All SDK-native — no raw ID/bank details ever
  handed to the volunteer.
- **Audit ledger:** every action (eligibility check, payout, grant, revoke) is a signed,
  queryable row; account numbers appear only masked.

---

## 3. LIVE on testnet — what actually ran (≈40s) — screen-capture the logs/
These are real metered calls against `cn-api.sg.testnet.t3n.terminal3.io` (logs in `logs/`):

```
yarn auth-gate                                     # real DID + balance
AIDLINK_CONFIRM_METERED=1 yarn provision           # ✅ registered: contract_id=445; maps created + seeded
AIDLINK_CONFIRM_METERED=1 yarn tsx src/invoke-eligibility.ts   # ✅ ben_001→approved, ben_404→denied (real KV)
AIDLINK_CONFIRM_METERED=1 yarn tsx src/phase2-cross-tenant.ts  # ✅ cross-tenant executeBusinessContract → real data
AIDLINK_CONFIRM_METERED=1 yarn tsx src/phase2-delegation.ts    # ✅ revokeDelegation live: vcId 73Gtw_acn94b7GK92egSSg
```

Live wins to show on screen:
- **Registration** — `contract_id=445`, `z:5cc2…7f2d:aidlink` accepted by the node.
- **Eligibility** — real decision data from the private KV map (approved + default-deny).
- **Cross-tenant** — the disbursement side calls the verification side via
  `executeBusinessContract` and gets real eligibility back across the boundary.
- **Delegation revoke** — the SDK-native `revokeDelegation` succeeds live; the audit ledger
  shows grant → revoke → denied with an intact hash chain.

**The one step that's platform-blocked (not us):** the `http-with-placeholders` **payout /
live PII resolution**. Every outbound call returns `egress_denied`, and there is **no way to
authorize a host for a custom contract** — no SDK method exists, and the dashboard
"Authorized contract" dropdown **does not list our registered `contract_id=445`** at all
(confirmed live, BUG-010 + BUG-013). So we show the privacy guarantee via the **structural
local proof** (the contract only ever emits `{{profile.*}}` templates; the mock endpoint
rejects any unresolved marker and masks the resolved account). `yarn invoke` runs the
resolved probe + payout unchanged the moment egress can be authorized.

> Tone: two independent platform issues — a token-grant unit bug (**corrected** after we
> reported it) and an egress-authorization gap for custom contracts — both **found,
> diagnosed, isolated, and reported**. Headlines of the bug-bounty track, not gaps in our work.

---

## 4. Judging-criteria map (show on screen / in README)
**Integration depth — each feature → the SDK capability it exercises:**

| AidLink feature | SDK / host capability |
|---|---|
| Auth handshake → DID (proven live) | `handshake` / `authenticate(createEthAuthInput)` / `getUsage` |
| Eligibility store | `tenant.maps.create` (private `z:<tid>:` map, explicit readers) |
| Endpoint secret seeding | `executeControl("map-entry-set", …)` into `z:<tid>:secrets` |
| Contract lifecycle | `tenant.contracts.register({ tail, version, wasm })` |
| Invocation | `executeAndDecode({ script_name, script_version, function_name, input, pii_did })` |
| Cross-tenant call (Phase 2) | `executeBusinessContract({ tenant, contract, functionName, input })` |
| PII-safe payout | host `http-with-placeholders@2.1.0` + `{{profile.*}}` markers |
| Human-helper delegation (Phase 2) | `buildDelegationCredential` / `signCredential` / `revokeDelegation` |
| Audit trail | signed action rows (history/audit) |

**Bug-bounty track:** `BUGS.md`, 7 entries, each reproducible with exact output and a fix.

---

## 5. Close (≈10s)
> "AidLink is a complete, tested, privacy-preserving relief-disbursement agent — its
> guarantees proven locally today, its live run staged behind a single platform-side
> top-up we've already reported. The contract never sees the account number; the volunteer
> never sees the ID; every action is signed and revocable."

---

### Recording checklist (do before capture)
- [ ] Confirm/replace dates: BUG-005 reported 2026-06-20; "no response as of <record date>".
- [ ] If balance lands first: run `probe-placeholder` live and re-cut §1/§3 to show the
      real resolved→masked round-trip (keep the local-proof lead regardless).
- [ ] Screen-capture order: `cargo test` → `wasm-tools component wit` → `yarn mock-payout`
      curls → `yarn auth-gate` (live) → `BUGS.md` scroll.
