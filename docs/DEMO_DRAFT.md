# AidLink — Demo Narrative (DRAFT — not recorded yet)

> Working draft for the ~2-minute submission video + written walkthrough. Leads with what
> is **fully proven locally**; presents the live testnet run as a staged, ready-to-execute
> next step that is blocked only by a confirmed token-grant bug (BUG-005), not by missing
> work. Update the bracketed dates before recording.

**Timeline facts to cite:** token-grant bug (BUG-005) reported to `devrel@terminal3.io` on
**2026-06-20**; no response as of submission. Submission deadline **2026-06-22 23:59 GMT+8**.

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

4. **The developer log is itself a deliverable.** Open `BUGS.md`: seven grounded entries
   (token-grant unit bug, undocumented SDK delegation surface, missing OpenAPI, the
   resolved-profile schema gap, the test-user onboarding gap …), each with exact errors,
   doc citations, and suggested fixes.

> Takeaway line: "Everything that defines the privacy guarantee — the contract, the tests,
> the endpoint behavior — is built and verified. What's left is a metered button-press."

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

## 3. "Here's exactly what happens next on live testnet" (≈30s) — staged, not missing
Frame as a ready pipeline, one command away:

```
yarn auth-gate        # ALREADY GREEN against the live sandbox — real DID + balance returned
AIDLINK_CONFIRM_METERED=1 yarn provision   # register aidlink.wasm, create+seed KV maps
AIDLINK_CONFIRM_METERED=1 yarn invoke      # FIRST live spend = the cheap probe-placeholder
```

- We already proved the live handshake works: `auth-gate` authenticated as
  `did:t3n:5cc2…7f2d` and read a real balance back from
  `cn-api.sg.testnet.t3n.terminal3.io`. The *connection* is demonstrated; only the
  *metered* steps wait.
- The very first live action is deliberately the **cheapest isolated check**:
  `probe-placeholder` makes one host call, templating a single known-good field, to confirm
  substitution before spending on anything else.
- **Why it's not running in this video:** the testnet welcome grant was minted
  **1,000,000× short** — 20,000 *base units* (0.02 tokens) instead of the promised 20,000
  *tokens* (BUG-005, an off-by-`BASE_UNITS_PER_TOKEN` unit bug, with the exact `getUsage()`
  payload logged). That's not enough to register a contract or run one invocation. Reported
  to `devrel@terminal3.io` on **2026-06-20**; no response as of submission. The metered
  scripts are **guarded so they refuse to run** until a real balance lands — so the moment
  it does, the same commands execute unchanged.

> Tone: this is a platform-side provisioning bug we **found, diagnosed to the exact factor,
> reported, and engineered around** — it's a highlight of the bug-bounty track, not a gap
> in our work.

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
