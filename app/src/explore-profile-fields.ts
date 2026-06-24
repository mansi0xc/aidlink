/**
 * Exploration (priority 2) — map EVERY {{profile.*}} field via probe-placeholder.
 *
 * For each candidate field we template `{{profile.<field>}}`, send it through the contract's
 * http-with-placeholders path to the (allow-listed) echo endpoint, and classify the outcome:
 *   RESOLVED        — host substituted a value (the field is present + resolvable)
 *   EMPTY/ABSENT    — `placeholder-unknown` ("missing field") — valid path, no value
 *   DENIED          — `placeholder-denied` — malformed / non-`profile` namespace
 *   OTHER           — anything else (egress, etc.)
 *
 * Produces a table for BUGS.md. Resolved PII is masked in output (first char only).
 *
 *   AIDLINK_CONFIRM_METERED=1 yarn tsx src/explore-profile-fields.ts
 */
import { bootstrap } from "./lib/client.js";

const PROBE_URL = process.env.AIDLINK_PROBE_URL ?? "https://postman-echo.com/post";
const PII_DID = process.env.AIDLINK_BENEFICIARY_DID ?? "did:t3n:5cc23ceebac85b5e55476a4b0d8a0b3a74c77f2d";
const SCRIPT_VERSION = process.env.AIDLINK_SCRIPT_VERSION ?? "0.1.0";

// UserInputProfile fields (from index.d.ts) + host-side paths the z-tenant-flight demo used
// + control probes (a deliberately-unknown name, to see if the host allow-lists field names).
const DEFAULT_FIELDS = [
  "first_name", "last_name", "country_of_residence", "document_issuance_country",
  "ssn", "address", "email_address", "phone_number", "campaign_code", "role",
  "date_of_birth", "gender",
  "verified_contacts.email.value", "verified_contacts.phone.value",
  "bank_account", "iban", "nonexistent_field_xyz",
];
// Override with FIELDS=a,b,c to run a subset. Spacing avoids the outbox_calls_per_minute_max=10 cap.
const FIELDS = (process.env.FIELDS ? process.env.FIELDS.split(",") : DEFAULT_FIELDS).map((f) => f.trim());
const DELAY_MS = Number(process.env.AIDLINK_PROBE_DELAY_MS ?? 7000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mask(v: string): string {
  if (!v) return "(empty)";
  return v.length <= 1 ? "*" : v[0] + "***";
}

async function main() {
  if (process.env.AIDLINK_CONFIRM_METERED !== "1") {
    console.error("[fields] REFUSING TO RUN: METERED. Use AIDLINK_CONFIRM_METERED=1.");
    process.exit(3);
  }
  const { client, tenantDid } = await bootstrap();
  const scriptName = `z:${tenantDid.replace(/^did:t3n:/, "")}:aidlink`;
  console.log(`[fields] script=${scriptName} pii_did=${PII_DID}\n`);

  const rows: { field: string; outcome: string; note: string }[] = [];
  for (let i = 0; i < FIELDS.length; i++) {
    const field = FIELDS[i];
    if (i > 0) await sleep(DELAY_MS); // stay under outbox_calls_per_minute_max=10
    let outcome = "OTHER", note = "";
    try {
      let res: any;
      for (let attempt = 0; ; attempt++) {
        try {
          res = await client.executeAndDecode({
            script_name: scriptName,
            script_version: SCRIPT_VERSION,
            function_name: "probe-placeholder",
            input: { url: PROBE_URL, field },
            pii_did: PII_DID,
          });
          break;
        } catch (err: any) {
          const m = String(err?.detail ?? err?.message ?? err).toLowerCase();
          if ((m.includes("too_many_requests") || m.includes("rate limit") || m.includes("quota exceed")) && attempt < 2) {
            console.log(`    (${field}: rate-limited — waiting 65s for the outbox window to reset)`);
            await sleep(65000);
            continue;
          }
          throw err;
        }
      }
      // postman-echo echoes the body; probe_value is the host-substituted value (or still-templated).
      const val: string = res?.json?.probe_value ?? res?.data?.probe_value ?? "";
      if (typeof val === "string" && val.includes("{{profile.")) {
        outcome = "STILL-TEMPLATED"; note = "host did not substitute (unexpected)";
      } else {
        outcome = "RESOLVED"; note = `value=${mask(val)} (len ${String(val).length})`;
      }
    } catch (e: any) {
      const d = String(e?.detail ?? e?.message ?? e).toLowerCase();
      if (d.includes("missing field") || d.includes("placeholder-unknown") || d.includes("profile missing")) {
        outcome = "EMPTY/ABSENT"; note = "placeholder-unknown";
      } else if (d.includes("placeholder-denied") || d.includes("not permitted")) {
        outcome = "DENIED"; note = "placeholder-denied";
      } else if (d.includes("egress")) {
        outcome = "OTHER"; note = "egress_denied";
      } else {
        outcome = "OTHER"; note = String(e?.detail ?? e?.message ?? e).slice(0, 80);
      }
    }
    console.log(`  ${field.padEnd(32)} ${outcome.padEnd(16)} ${note}`);
    rows.push({ field, outcome, note });
  }

  console.log("\n=== MARKDOWN TABLE (for BUGS.md) ===");
  console.log("| `{{profile.<field>}}` | outcome | note |");
  console.log("|---|---|---|");
  for (const r of rows) console.log(`| \`${r.field}\` | ${r.outcome} | ${r.note} |`);
}

main().catch((e) => {
  console.error("[fields] FAILED:", e?.detail ?? e?.message ?? e);
  process.exit(1);
});
