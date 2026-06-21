/**
 * Phase 2 runnable — cross-tenant eligibility + disbursement. STAGED, METERED, guarded.
 *
 * The disbursement agent (tenant B) calls the verification agent (tenant A) across a real
 * tenant boundary via `executeBusinessContract`, then pays out via its own contract iff
 * approved. Every action is written to the hash-chained audit ledger.
 *
 *   AIDLINK_CONFIRM_METERED=1 yarn tsx src/phase2-cross-tenant.ts
 *
 * Prereqs (live): both tenants provisioned with the aidlink contract; A's eligibility map
 * seeded; B's secrets + egress allow-list set (see BUG-007/010); a beneficiary profile +
 * grant. None run here.
 */
import { bootstrapAgents, tenantHex } from "./lib/agents.js";
import { runRelief, type ReliefGateways } from "./lib/orchestration.js";
import { AuditLedger } from "./lib/audit.js";

const CONTRACT_TAIL = "aidlink";
const VERSION = process.env.AIDLINK_SCRIPT_VERSION ?? "0.1.0";
const BENEFICIARY = process.env.AIDLINK_BENEFICIARY ?? "ben_001";
const BENEFICIARY_DID = process.env.AIDLINK_BENEFICIARY_DID;

function guard() {
  if (process.env.AIDLINK_CONFIRM_METERED !== "1") {
    console.error("\n[phase2-x] REFUSING TO RUN: METERED. Re-run with AIDLINK_CONFIRM_METERED=1 once balance is real.\n");
    process.exit(3);
  }
}

async function main() {
  guard();
  const { verification, disbursement, sameDid } = await bootstrapAgents();
  console.log(`[phase2-x] verification(A)=${verification.did}`);
  console.log(`[phase2-x] disbursement(B)=${disbursement.did}  sameDid=${sameDid}`);

  const verifyScript = `z:${tenantHex(verification.did)}:${CONTRACT_TAIL}`;
  const ledger = new AuditLedger(process.env.AIDLINK_AUDIT_LOG ?? "audit-log.jsonl");

  // The cross-tenant gateway: B invokes A's check-eligibility. This is the real tenant
  // boundary — B has no access to A's eligibility map, only to A's published function.
  const gateways: ReliefGateways = {
    ledger,
    async checkEligibility(beneficiaryId) {
      return disbursement.tenant.executeBusinessContract(disbursement.client as any, {
        tenant: verification.did,
        contract: verifyScript,
        functionName: "check-eligibility",
        input: { beneficiary_id: beneficiaryId },
      });
    },
    async disburse(input) {
      const disburseScript = `z:${tenantHex(disbursement.did)}:${CONTRACT_TAIL}`;
      return disbursement.client.executeAndDecode({
        script_name: disburseScript,
        script_version: VERSION,
        function_name: "disburse-payout",
        input,
        ...(BENEFICIARY_DID ? { pii_did: BENEFICIARY_DID } : {}),
      });
    },
  };

  const decision = await runRelief(BENEFICIARY, "250.00", "USD", gateways);
  console.log("[phase2-x] decision:", JSON.stringify(decision, null, 2));
  console.log("\n[phase2-x] audit ledger:\n" + ledger.render());
}

main().catch((e) => {
  console.error("\n[phase2-x] FAILED.");
  console.error(e);
  process.exit(1);
});
