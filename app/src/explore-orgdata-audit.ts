/**
 * Exploration (priority 4) — OrgDataClient grants lifecycle + audit-events reads, live.
 *
 *  - getAuditEvents() — read our own audit trail (all actors).
 *  - setGrants → grantsGet → deleteGrants → grantsGet — full org-contract grant lifecycle.
 *  - getAuditEvents({ pii_did: <other DID> }) — delegated read; expected to be refused/empty
 *    without a live agent-auth grant from that user.
 *
 *   AIDLINK_CONFIRM_METERED=1 yarn tsx src/explore-orgdata-audit.ts
 */
import { createOrgDataClientFromSession, getNodeUrl } from "@terminal3/t3n-sdk";
import { bootstrap } from "./lib/client.js";

const CONTRACT_ID = process.env.AIDLINK_CONTRACT_ID_NUM ?? "445";
const OTHER_DID = "did:t3n:6dde070ecd770129114a0877f35bde4fe40c3959"; // the fresh DID from priority 2

async function step<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const r = await fn();
    console.log(`[orgdata] ✅ ${label}: ${JSON.stringify(r)}`);
    return r;
  } catch (e: any) {
    console.log(`[orgdata] ⛔ ${label}: ${e?.detail ?? e?.message ?? e}`);
    return undefined;
  }
}

async function main() {
  if (process.env.AIDLINK_CONFIRM_METERED !== "1") {
    console.error("[orgdata] REFUSING TO RUN: METERED. Use AIDLINK_CONFIRM_METERED=1.");
    process.exit(3);
  }
  const { client, tenantDid } = await bootstrap();
  console.log(`[orgdata] DID ${tenantDid}  contractId=${CONTRACT_ID}\n`);

  console.log("== AUDIT EVENTS (self) ==");
  await step("getAuditEvents() self", async () => {
    const p = await client.getAuditEvents({ limit: 5 });
    return { batches: p.batches?.length ?? 0, next_cursor: p.next_cursor ?? null, sample: JSON.stringify(p.batches?.[0] ?? null).slice(0, 200) };
  });

  console.log("\n== ORG-DATA GRANTS LIFECYCLE ==");
  const org = createOrgDataClientFromSession(client, getNodeUrl());
  await step("createPolicy (initialise org policy, admin=self)", () =>
    org.createPolicy({ orgDid: tenantDid, initialAdminDid: tenantDid }),
  );
  await step("policyGet (confirm initialised)", () => org.policyGet({ orgDid: tenantDid }));
  const grant = {
    user_did: tenantDid,
    functions: ["check-eligibility"],
    scopes: [] as string[],
    constraints: {} as Record<string, string>,
    expires_at_secs: null as number | null,
  };
  await step("setGrants (grant self check-eligibility)", () =>
    org.setGrants({ orgDid: tenantDid, contractId: CONTRACT_ID, grants: [grant] }),
  );
  await step("grantsGet (read back)", () => org.grantsGet({ orgDid: tenantDid, contractId: CONTRACT_ID }));
  await step("deleteGrants", () => org.deleteGrants({ orgDid: tenantDid, contractId: CONTRACT_ID }));
  await step("grantsGet (after delete)", () => org.grantsGet({ orgDid: tenantDid, contractId: CONTRACT_ID }));

  console.log("\n== DELEGATED AUDIT READ (no grant — expect refusal/empty) ==");
  await step(`getAuditEvents({ pii_did: ${OTHER_DID.slice(0, 20)}… })`, () =>
    client.getAuditEvents({ pii_did: OTHER_DID, limit: 5 }),
  );
}

main().catch((e) => {
  console.error("[orgdata] FAILED:", e?.detail ?? e?.message ?? e);
  process.exit(1);
});
