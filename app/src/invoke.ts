/**
 * Phase 1 invocation — STAGED, NOT YET RUN. METERED (ChargeReason: invocation + host calls).
 *
 * Guarded by AIDLINK_CONFIRM_METERED=1. Runs CHEAPEST-FIRST so the very first live spend is
 * the minimal isolated placeholder probe, per the agreed plan:
 *   1. probe-placeholder  — one host call, one templated field ({{profile.first_name}}).
 *   2. check-eligibility   — KV lookup only, no egress, no PII.
 *   3. disburse-payout     — full path: eligibility + http-with-placeholders payout.
 *
 * Stop after step 1 by default (PROBE_ONLY=1, the default) so we confirm placeholder
 * resolution + grant wiring before spending on the rest. Set PROBE_ONLY=0 to run all three.
 *
 * Canonical action payload (from index.d.ts executeAndDecode/execute doc):
 *   { script_name, script_version, function_name, input, pii_did? }
 * `pii_did` is the user whose profile the host resolves {{profile.*}} from. For the demo
 * the beneficiary DID is supplied via AIDLINK_BENEFICIARY_DID (must have a populated
 * profile + a grant to this contract — see report notes; that setup is a live-run
 * prerequisite, not done here).
 */
import { bootstrap, printBalance } from "./lib/client.js";

const CONTRACT_TAIL = "aidlink";
const SCRIPT_VERSION = process.env.AIDLINK_SCRIPT_VERSION ?? "0.1.0";
const PROBE_ONLY = process.env.PROBE_ONLY !== "0";

const BENEFICIARY = process.env.AIDLINK_BENEFICIARY ?? "ben_001";
const BENEFICIARY_DID = process.env.AIDLINK_BENEFICIARY_DID; // pii_did for placeholder resolution
const PROBE_URL = process.env.AIDLINK_PROBE_URL ?? "https://aidlink-payout.example.com/echo";

function guard() {
  if (process.env.AIDLINK_CONFIRM_METERED !== "1") {
    console.error(
      "\n[invoke] REFUSING TO RUN: METERED invocations. " +
        "Confirm the top-up, then re-run with AIDLINK_CONFIRM_METERED=1.\n",
    );
    process.exit(3);
  }
}

async function main() {
  guard();
  const { client, tenantDid } = await bootstrap();
  const scriptName = `z:${tenantDid.replace(/^did:t3n:/, "")}:${CONTRACT_TAIL}`;
  console.log(`[invoke] script_name=${scriptName} version=${SCRIPT_VERSION}`);
  await printBalance(client, "invoke:before");

  // (1) Cheapest isolated placeholder probe — first live spend.
  console.log("\n[invoke] (1) probe-placeholder field=first_name …");
  const probe = await client.executeAndDecode({
    script_name: scriptName,
    script_version: SCRIPT_VERSION,
    function_name: "probe-placeholder",
    input: { url: PROBE_URL, field: "first_name" },
    ...(BENEFICIARY_DID ? { pii_did: BENEFICIARY_DID } : {}),
  });
  console.log("[invoke] probe result:", probe);
  await printBalance(client, "invoke:after-probe");

  if (PROBE_ONLY) {
    console.log(
      "\n[invoke] PROBE_ONLY — stopping after the cheap probe. " +
        "Set PROBE_ONLY=0 to run eligibility + payout.",
    );
    return;
  }

  // (2) Eligibility — KV lookup, no PII, no egress.
  console.log("\n[invoke] (2) check-eligibility …");
  const elig = await client.executeAndDecode({
    script_name: scriptName,
    script_version: SCRIPT_VERSION,
    function_name: "check-eligibility",
    input: { beneficiary_id: BENEFICIARY },
  });
  console.log("[invoke] eligibility:", elig);

  // (3) Payout — full privacy path.
  console.log("\n[invoke] (3) disburse-payout …");
  const payout = await client.executeAndDecode({
    script_name: scriptName,
    script_version: SCRIPT_VERSION,
    function_name: "disburse-payout",
    input: { beneficiary_id: BENEFICIARY, amount: "250.00", currency: "USD" },
    ...(BENEFICIARY_DID ? { pii_did: BENEFICIARY_DID } : {}),
  });
  console.log("[invoke] payout:", payout);
  await printBalance(client, "invoke:after");
}

main().catch((e) => {
  console.error("\n[invoke] FAILED.");
  console.error(e);
  process.exit(1);
});
