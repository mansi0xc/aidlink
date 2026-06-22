/**
 * Exploration (priority 1) — otpRequest leg. Sends a one-time code to the claim email and
 * captures the real OtpRequestResult shape. Pair with src/otp-verify.ts (OTP_CODE=...) to
 * complete the roundtrip once you read the code from the mailbox.
 *
 *   AIDLINK_CONFIRM_METERED=1 yarn tsx src/otp-request.ts
 */
import { bootstrap } from "./lib/client.js";

const EMAIL = process.env.AIDLINK_EMAIL ?? "olivygungin@gmail.com";

async function main() {
  if (process.env.AIDLINK_CONFIRM_METERED !== "1") {
    console.error("[otp-request] REFUSING TO RUN: METERED. Use AIDLINK_CONFIRM_METERED=1.");
    process.exit(3);
  }
  const { client, tenantDid } = await bootstrap();
  console.log(`[otp-request] DID ${tenantDid}  email=${EMAIL}`);
  console.log("[otp-request] otpRequest({ emailChannel }) …");
  const res = await client.otpRequest({ emailChannel: { emailAddress: EMAIL } });
  console.log("[otp-request] result:\n" + JSON.stringify(res, null, 2));
  console.log(`\n→ Check ${EMAIL} for the code, then:`);
  console.log(`  AIDLINK_CONFIRM_METERED=1 OTP_CODE=<code> yarn tsx src/otp-verify.ts`);
}

main().catch((e) => {
  console.error("[otp-request] FAILED:", e?.detail ?? e?.message ?? e);
  process.exit(1);
});
