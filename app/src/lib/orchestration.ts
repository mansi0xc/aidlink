/**
 * Phase 2 — cross-tenant relief orchestration (the disbursement agent's control flow).
 *
 * The disbursement agent (tenant B) does NOT hold eligibility data. It asks the
 * verification agent (tenant A) across a real tenant boundary, and only pays out if A
 * approves. This module is the pure control flow, expressed against injected gateways so
 * it is verifiable without the sandbox (tests/phase2-cross-tenant.mocked.test.ts) and
 * wired to the real SDK in phase2-cross-tenant.ts.
 *
 * The "mock the network layer only, not the logic" constraint is honored by mocking the
 * gateway boundary (one SDK call each) while THIS decision logic — ask A, refuse-or-pay,
 * audit both — runs for real in tests. (Network-level MockTransport can't be used end to
 * end because the WASM handshake rejects non-cryptographic fixtures; see the test file.)
 */
import type { AuditLedger, AuditEvent } from "./audit.js";

export interface EligibilityResult {
  beneficiary_id: string;
  approved: boolean;
  zone: string;
  reason: string;
}

export interface PayoutResult {
  payout_id: string;
  account_masked: string;
  status: string;
  beneficiary_id: string;
}

/** The two cross-boundary calls the orchestration depends on, plus an optional ledger. */
export interface ReliefGateways {
  /** Tenant A (verification), reached cross-tenant via executeBusinessContract. */
  checkEligibility(beneficiaryId: string): Promise<EligibilityResult>;
  /** Tenant B (disbursement), its own contract via executeAndDecode. */
  disburse(input: { beneficiary_id: string; amount: string; currency: string }): Promise<PayoutResult>;
  ledger?: AuditLedger;
}

export interface ReliefDecision {
  approved: boolean;
  eligibility: EligibilityResult;
  payout?: PayoutResult;
  refusedReason?: string;
}

/**
 * Run one relief disbursement: ask the verification agent, then pay out iff approved.
 * Records an audit row for the eligibility check and (if it happens) the payout. The
 * key invariant tests assert: **a denied eligibility never reaches `disburse`.**
 */
export async function runRelief(
  beneficiaryId: string,
  amount: string,
  currency: string,
  deps: ReliefGateways,
): Promise<ReliefDecision> {
  const eligibility = await deps.checkEligibility(beneficiaryId);
  record(deps.ledger, {
    kind: "eligibility-check",
    beneficiary_id: beneficiaryId,
    detail: { approved: eligibility.approved, zone: eligibility.zone },
  });

  if (!eligibility.approved) {
    return {
      approved: false,
      eligibility,
      refusedReason: eligibility.reason || "not eligible",
    };
  }

  const payout = await deps.disburse({ beneficiary_id: beneficiaryId, amount, currency });
  record(deps.ledger, {
    kind: "payout",
    beneficiary_id: beneficiaryId,
    detail: { payout_id: payout.payout_id, account_masked: payout.account_masked, status: payout.status },
  });

  return { approved: true, eligibility, payout };
}

function record(ledger: AuditLedger | undefined, e: Omit<AuditEvent, "ts">) {
  ledger?.append(e);
}
