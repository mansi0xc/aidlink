/**
 * Phase 2 cross-tenant orchestration — MOCKED test (SDK-client boundary mocked).
 *
 * Why mocked here and not network-level: the SDK's encrypted WASM handshake rejects
 * non-cryptographic fixtures, so MockTransport cannot drive an authenticated client end to
 * end (verified experimentally). We therefore mock the one SDK call at each gateway
 * boundary and let the REAL orchestration logic (ask A → refuse-or-pay → audit) run. The
 * test asserts both the cross-tenant CALL SHAPE and the control-flow invariant.
 *
 * Run:  yarn tsx --test tests/phase2-cross-tenant.mocked.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runRelief, type ReliefGateways, type EligibilityResult, type PayoutResult } from "../src/lib/orchestration.js";
import { AuditLedger } from "../src/lib/audit.js";

/** A stand-in for TenantClient.executeBusinessContract that records the options it's given. */
function recordingDisbursementClient(eligibility: EligibilityResult) {
  const calls: any[] = [];
  const client = {
    async executeBusinessContract(_session: unknown, options: any) {
      calls.push(options);
      return eligibility; // canned A-side result
    },
  };
  return { client, calls };
}

const VERIFY_DID = "did:t3n:aaaa000000000000000000000000000000000000";
const VERIFY_SCRIPT = "z:aaaa000000000000000000000000000000000000:aidlink";

function gatewaysFor(eligibility: EligibilityResult, payout: PayoutResult, ledger?: AuditLedger) {
  const { client, calls } = recordingDisbursementClient(eligibility);
  const disburseCalls: any[] = [];
  const gateways: ReliefGateways = {
    ledger,
    async checkEligibility(beneficiaryId) {
      // EXACT cross-tenant call shape under test:
      return client.executeBusinessContract(/* session */ {}, {
        tenant: VERIFY_DID,
        contract: VERIFY_SCRIPT,
        functionName: "check-eligibility",
        input: { beneficiary_id: beneficiaryId },
      });
    },
    async disburse(input) {
      disburseCalls.push(input);
      return payout;
    },
  };
  return { gateways, crossTenantCalls: calls, disburseCalls };
}

const APPROVED: EligibilityResult = { beneficiary_id: "ben_001", approved: true, zone: "Z3", reason: "eligible" };
const DENIED: EligibilityResult = { beneficiary_id: "ben_404", approved: false, zone: "", reason: "no record" };
const PAYOUT: PayoutResult = { payout_id: "po_x", account_masked: "****6819", status: "paid", beneficiary_id: "ben_001" };

test("cross-tenant eligibility call uses executeBusinessContract with the correct tenant/contract/function/input", async () => {
  const { gateways, crossTenantCalls } = gatewaysFor(APPROVED, PAYOUT);
  await runRelief("ben_001", "250.00", "USD", gateways);

  assert.equal(crossTenantCalls.length, 1, "exactly one cross-tenant call");
  assert.deepEqual(crossTenantCalls[0], {
    tenant: VERIFY_DID,
    contract: VERIFY_SCRIPT,
    functionName: "check-eligibility",
    input: { beneficiary_id: "ben_001" },
  });
});

test("approved → pays out exactly once with the right amount/currency", async () => {
  const { gateways, disburseCalls } = gatewaysFor(APPROVED, PAYOUT);
  const decision = await runRelief("ben_001", "250.00", "USD", gateways);
  assert.equal(decision.approved, true);
  assert.equal(decision.payout?.account_masked, "****6819");
  assert.deepEqual(disburseCalls, [{ beneficiary_id: "ben_001", amount: "250.00", currency: "USD" }]);
});

test("DENIED eligibility NEVER reaches disburse (the core control-flow invariant)", async () => {
  const { gateways, disburseCalls } = gatewaysFor(DENIED, PAYOUT);
  const decision = await runRelief("ben_404", "250.00", "USD", gateways);
  assert.equal(decision.approved, false);
  assert.equal(decision.payout, undefined);
  assert.equal(decision.refusedReason, "no record");
  assert.equal(disburseCalls.length, 0, "payout must NOT be attempted when ineligible");
});

test("both actions land in the hash-chained audit ledger and the chain verifies", async () => {
  const ledger = new AuditLedger();
  const { gateways } = gatewaysFor(APPROVED, PAYOUT, ledger);
  await runRelief("ben_001", "250.00", "USD", gateways);
  const rows = ledger.all();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.kind), ["eligibility-check", "payout"]);
  assert.equal(ledger.verify().ok, true);
  // Account number appears only masked. Check the detail payloads (timestamps legitimately
  // have long digit runs; an account number would surface in `detail`).
  const details = JSON.stringify(rows.map((r) => r.detail));
  assert.match(details, /\*{4}6819/);
  assert.doesNotMatch(details, /\d{7,}/, "no long PAN-like digit run in the ledger detail");
});
