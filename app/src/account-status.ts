/**
 * Read-only account diagnostic (BUG-007 #1 + BUG-005 re-poll).
 *
 * Calls tenant.me() and client.kycStatus() — the same read-only class as the
 * already-confirmed-free getUsage(). Brackets them with getUsage() before/after so any
 * unexpected charge is caught (and logged). Performs NO metered mutation.
 *
 * Run: yarn tsx src/account-status.ts
 */
import { bootstrap } from "./lib/client.js";

function short(v: unknown, n = 1500): string {
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return s.length > n ? s.slice(0, n) + " …(truncated)" : s;
}

async function main() {
  const { client, tenant, tenantDid } = await bootstrap();
  console.log(`[status] DID ${tenantDid}\n`);

  const before = await client.getUsage();
  console.log(`[status] getUsage BEFORE: available=${before.balance.available} reserved=${before.balance.reserved} entries=${before.entries.length}`);

  console.log("\n[status] tenant.tenant.me() …");
  try {
    const me = await tenant.tenant.me();
    console.log("[status] me() OK:\n" + short(me));
  } catch (e: any) {
    console.log(`[status] me() threw: ${e?.code ?? ""} ${e?.message ?? e}`);
  }

  console.log("\n[status] client.kycStatus() …");
  try {
    const kyc = await client.kycStatus();
    console.log("[status] kycStatus() OK:\n" + short(kyc));
  } catch (e: any) {
    console.log(`[status] kycStatus() threw: ${e?.code ?? ""} ${e?.message ?? e}`);
  }

  const after = await client.getUsage();
  console.log(`\n[status] getUsage AFTER: available=${after.balance.available} reserved=${after.balance.reserved} entries=${after.entries.length}`);

  const delta = before.balance.available - after.balance.available;
  console.log(
    `[status] balance delta over me()+kycStatus(): ${delta} base units ` +
      `(${delta === 0 ? "FREE — no charge" : "CHARGED — these reads are metered!"})`,
  );
  if (after.entries.length) {
    console.log("[status] latest usage entries:\n" + short(after.entries.slice(0, 5)));
  }

  console.log("\n[status] BUG-005 re-poll: balance is " + after.balance.available + " base units (filed at 20000).");
}

main().catch((e) => {
  console.error("[status] FAILED:", e);
  process.exit(1);
});
