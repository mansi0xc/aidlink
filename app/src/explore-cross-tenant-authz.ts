/**
 * Exploration (priority 1, HIGHEST) — REAL cross-tenant authorization.
 *
 * A genuinely DIFFERENT DID (fresh key, no grant from us) calls executeBusinessContract
 * against AidLink's verification contract `check-eligibility`. We want to know precisely what
 * the platform does for an uninvited cross-tenant caller:
 *   - clean rejection (and the EXACT error), or
 *   - silent success (→ a security finding: any DID can read another tenant's contract), or
 *   - something else (e.g. blocked on the credit floor before authz is even evaluated).
 *
 *   AIDLINK_CONFIRM_METERED=1 yarn tsx src/explore-cross-tenant-authz.ts
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import {
  T3nClient,
  TenantClient,
  setEnvironment,
  getNodeUrl,
  loadWasmComponent,
  eth_get_address,
  metamask_sign,
  createEthAuthInput,
  formatTokens,
} from "@terminal3/t3n-sdk";

const VERIFY_DID = process.env.AIDLINK_VERIFY_DID ?? "did:t3n:5cc23ceebac85b5e55476a4b0d8a0b3a74c77f2d";
const CONTRACT_TAIL = "aidlink";
const CREDIT_FLOOR = 10_000_000_000; // 10k tokens (BUG-015)
// Caller B: the operator's separately-claimed FUNDED second DID (SECOND_KEY). If absent we fall
// back to a fresh 0-balance key — which only reproduces the credit-floor-masked case (BUG-018).
const SECOND_KEY = process.env.SECOND_KEY;

async function main() {
  if (process.env.AIDLINK_CONFIRM_METERED !== "1") {
    console.error("[xauthz] REFUSING TO RUN: METERED. Use AIDLINK_CONFIRM_METERED=1.");
    process.exit(3);
  }
  setEnvironment("testnet");
  const baseUrl = getNodeUrl();
  const wasm = await loadWasmComponent();

  // Caller B: the operator's funded second DID (SECOND_KEY), or a fresh 0-balance key.
  const key = SECOND_KEY ?? "0x" + randomBytes(32).toString("hex");
  const usingFunded = Boolean(SECOND_KEY);
  const address = eth_get_address(key);
  const client = new T3nClient({ baseUrl, wasmComponent: wasm, handlers: { EthSign: metamask_sign(address, undefined, key) } });
  await client.handshake();
  const callerDid = (await client.authenticate(createEthAuthInput(address))).value;
  console.log(`[xauthz] CALLER (B${usingFunded ? ", SECOND_KEY/funded" : ", fresh/0-balance"}, no grant): ${callerDid}`);
  console.log(`[xauthz] TARGET (A, verification):   ${VERIFY_DID}  contract=${CONTRACT_TAIL}::check-eligibility`);
  console.log(`[xauthz] (B and A are DIFFERENT DIDs: ${callerDid !== VERIFY_DID})`);
  if (callerDid === VERIFY_DID) {
    console.error("[xauthz] ✗ SECOND_KEY resolves to the SAME DID as A — not a cross-tenant test. Abort.");
    process.exit(2);
  }

  // PRE-CHECK: is B above the 10k-token credit floor? Only then is the authz result meaningful
  // (otherwise the call is masked by InsufficientCredit — the BUG-018 confound).
  const bal = (await client.getUsage()).balance.available;
  const aboveFloor = bal >= CREDIT_FLOOR;
  console.log(`[xauthz] B balance: ${bal} base units = ${formatTokens(bal)} tokens — ` +
    `${aboveFloor ? "✅ ABOVE the 10k floor (credit confound CLEARED)" : "⛔ BELOW the floor (result will be credit-masked, not an authz answer)"}\n`);

  const tenant = new TenantClient({ t3n: client, baseUrl, tenantDid: callerDid, environment: "testnet" });

  console.log("[xauthz] B → executeBusinessContract(A, aidlink, check-eligibility, {ben_001}) …");
  try {
    const res = await tenant.executeBusinessContract(client as any, {
      tenant: VERIFY_DID,
      contract: CONTRACT_TAIL,
      functionName: "check-eligibility",
      input: { beneficiary_id: "ben_001" },
    });
    console.log("[xauthz] ⚠️ CALL SUCCEEDED — result:", JSON.stringify(res));
    console.log("[xauthz] ⚠️ SECURITY FINDING: an uninvited foreign DID read another tenant's contract output.");
  } catch (e: any) {
    const detail = e?.detail ?? e?.message ?? String(e);
    console.log(`[xauthz] ✅ CALL REJECTED — exact error:\n   ${detail}`);
    const lc = String(detail).toLowerCase();
    const cls = lc.includes("insufficientcredit")
      ? "blocked on CREDIT FLOOR (authz not reached — inconclusive on the security question)"
      : /grant|forbidden|unauthor|not.?allow|denied|permission/.test(lc)
        ? "blocked on AUTHORIZATION (grant/permission) — the security-relevant rejection"
        : "rejected for another reason (see error)";
    console.log(`[xauthz] classification: ${cls}`);
  }
}

main().catch((e) => {
  console.error("[xauthz] FAILED:", e?.detail ?? e?.message ?? e);
  process.exit(1);
});
