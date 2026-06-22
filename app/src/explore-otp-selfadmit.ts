/**
 * Exploration (priority 1) — submitUserInput + self-admit (becomeDevTenant).
 *
 * Tests in one shot:
 *  (a) is the DID's email already verified? (success vs UserUpsertError "EmailNotVerified")
 *  (b) what does testnet self-admit grant on an already-active tenant? (tenantAdmit projection)
 *  (c) does self-admit mint anything into the separate bucket BUG-005 speculated about?
 *     (getUsage before/after)
 *
 * Re-sends the EXISTING profile values (merge upsert, no-op) so nothing is overwritten.
 *
 *   AIDLINK_CONFIRM_METERED=1 yarn tsx src/explore-otp-selfadmit.ts
 */
import { bootstrap } from "./lib/client.js";

function guard() {
  if (process.env.AIDLINK_CONFIRM_METERED !== "1") {
    console.error("\n[otp] REFUSING TO RUN: METERED. Re-run with AIDLINK_CONFIRM_METERED=1.\n");
    process.exit(3);
  }
}

async function main() {
  guard();
  const { client, tenantDid } = await bootstrap();
  console.log(`[otp] DID ${tenantDid}`);

  const before = await client.getUsage();
  console.log(`[otp] balance BEFORE: ${before.balance.available} base units`);

  console.log("\n[otp] submitUserInput({ profile:{first_name,last_name}, becomeDevTenant:true }) …");
  try {
    const res = await client.submitUserInput({
      profile: { first_name: "Olivia", last_name: "Gungin" },
      becomeDevTenant: true,
    });
    console.log("[otp] ✅ submitUserInput OK:");
    console.log(JSON.stringify(res, null, 2));
    if (res.tenantAdmit) {
      console.log(`[otp] tenantAdmit.status=${res.tenantAdmit.status} grantedCredits=${res.tenantAdmit.grantedCredits ?? "null"}`);
    }
    console.log("[otp] → email is ALREADY VERIFIED (no EmailNotVerified gate hit).");
  } catch (e: any) {
    const kind = e?.kind ?? "(no kind)";
    const code = e?.code ?? "";
    console.log(`[otp] ⚠️ submitUserInput threw: kind=${kind} code=${code} detail=${String(e?.detail ?? e?.message ?? e).slice(0, 200)}`);
    if (String(e?.kind).includes("EmailNotVerified") || String(e?.message).toLowerCase().includes("email")) {
      console.log("[otp] → email NOT verified yet: an OTP roundtrip (otpRequest → otpVerify) is required first.");
    }
  }

  const after = await client.getUsage();
  const delta = after.balance.available - before.balance.available;
  console.log(`\n[otp] balance AFTER: ${after.balance.available} base units (delta ${delta >= 0 ? "+" : ""}${delta})`);
  console.log(`[otp] self-admit minted ${delta > 0 ? delta + " base units into balance" : "NOTHING into balance"}.`);
}

main().catch((e) => {
  console.error("[otp] FAILED:", e);
  process.exit(1);
});
