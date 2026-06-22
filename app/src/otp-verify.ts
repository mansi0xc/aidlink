/**
 * Exploration (priority 1) — otpVerify leg. Redeems OTP_CODE against the claim email and
 * captures the real OtpVerifyResult, then runs a submitUserInput to confirm the full chain.
 *
 *   AIDLINK_CONFIRM_METERED=1 OTP_CODE=123456 yarn tsx src/otp-verify.ts
 */
import { bootstrap } from "./lib/client.js";

const EMAIL = process.env.AIDLINK_EMAIL ?? "olivygungin@gmail.com";
const CODE = process.env.OTP_CODE;

async function main() {
  if (process.env.AIDLINK_CONFIRM_METERED !== "1") {
    console.error("[otp-verify] REFUSING TO RUN: METERED. Use AIDLINK_CONFIRM_METERED=1.");
    process.exit(3);
  }
  if (!CODE) {
    console.error("[otp-verify] set OTP_CODE=<code from the email>.");
    process.exit(2);
  }
  const { client, tenantDid } = await bootstrap();
  console.log(`[otp-verify] DID ${tenantDid}  email=${EMAIL}  code=${CODE}`);

  console.log("[otp-verify] otpVerify({ otpCode, request:{ emailChannel } }) …");
  const res = await client.otpVerify({
    otpCode: CODE,
    request: { emailChannel: { emailAddress: EMAIL } },
  });
  console.log("[otp-verify] result:\n" + JSON.stringify(res, null, 2));
  console.log(`[otp-verify] status=${res.status ?? "(none)"} did=${res.did ?? "?"} email=${res.email ?? "?"}`);
}

main().catch((e) => {
  console.error("[otp-verify] FAILED:", e?.detail ?? e?.message ?? e);
  process.exit(1);
});
