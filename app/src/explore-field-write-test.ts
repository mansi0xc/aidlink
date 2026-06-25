/**
 * BUG-006 / BUG-019 settler — does writing a value make a field resolve?
 *
 * Writes obviously-FAKE values via submitUserInput:
 *   - country_of_residence = "ZZ"                    (a known UserInputProfile field, was empty)
 *   - bank_account         = "DUMMY-TEST-BANK-ACCT-0000" (a CUSTOM key, not a named field)
 * Then re-probes both through http-with-placeholders. Outcome distinguishes:
 *   - both resolve            → no allow-list; resolution = "any field that has a value"
 *   - only country resolves   → the resolved schema is a fixed allow-list of known fields
 *   - neither resolves        → writing doesn't feed the resolved store (separate path)
 *
 *   AIDLINK_CONFIRM_METERED=1 yarn tsx src/explore-field-write-test.ts
 */
import { bootstrap } from "./lib/client.js";

const PROBE_URL = process.env.AIDLINK_PROBE_URL ?? "https://postman-echo.com/post";
const PII_DID = "did:t3n:5cc23ceebac85b5e55476a4b0d8a0b3a74c77f2d";
const COUNTRY = "ZZ";
const BANK = "DUMMY-TEST-BANK-ACCT-0000";

async function probe(client: any, scriptName: string, field: string) {
  try {
    const res: any = await client.executeAndDecode({
      script_name: scriptName, script_version: "0.1.0",
      function_name: "probe-placeholder", input: { url: PROBE_URL, field }, pii_did: PII_DID,
    });
    const val: string = res?.json?.probe_value ?? res?.data?.probe_value ?? "";
    if (typeof val === "string" && val.includes("{{profile.")) return `STILL-TEMPLATED`;
    return `RESOLVED → "${val}"`;
  } catch (e: any) {
    const d = String(e?.detail ?? e?.message ?? e).toLowerCase();
    if (d.includes("missing field") || d.includes("placeholder-unknown")) return "EMPTY/ABSENT (placeholder-unknown)";
    return "OTHER: " + String(e?.detail ?? e?.message ?? e).slice(0, 80);
  }
}

async function main() {
  if (process.env.AIDLINK_CONFIRM_METERED !== "1") {
    console.error("[write] REFUSING TO RUN: METERED. Use AIDLINK_CONFIRM_METERED=1.");
    process.exit(3);
  }
  const { client, tenantDid } = await bootstrap();
  const scriptName = `z:${tenantDid.replace(/^did:t3n:/, "")}:aidlink`;

  // (A) Custom key — confirm it is rejected at WRITE time (UnrecognizedKeys).
  console.log(`[write] (A) attempt custom key bank_account="${BANK}" …`);
  try {
    await client.submitUserInput({ profile: { bank_account: BANK } as any });
    console.log("[write]   ⚠️ custom key ACCEPTED (unexpected)");
  } catch (e: any) {
    console.log(`[write]   ⛔ custom key REJECTED at write: ${String(e?.detail ?? e?.message ?? e).slice(0, 160)}`);
  }

  // (B) Known-but-empty field — write a valid dummy and see if it now resolves.
  console.log(`\n[write] (B) write known field country_of_residence="${COUNTRY}" …`);
  const res = await client.submitUserInput({ profile: { country_of_residence: COUNTRY } });
  console.log("[write]   submitUserInput result:", JSON.stringify(res));

  console.log("\n[write] re-probing after write …");
  console.log(`  country_of_residence : ${await probe(client, scriptName, "country_of_residence")}`);
  await new Promise((r) => setTimeout(r, 7000));
  console.log(`  bank_account         : ${await probe(client, scriptName, "bank_account")} (never written — should stay absent)`);
}

main().catch((e) => { console.error("[write] FAILED:", e?.detail ?? e?.message ?? e); process.exit(1); });
