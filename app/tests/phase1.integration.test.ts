/**
 * Phase 1 REAL integration test — hits the live T3N testnet sandbox + the mock payout
 * endpoint. This is NOT a unit test and mocks nothing on the SDK side.
 *
 * METERED. Guarded by AIDLINK_CONFIRM_METERED=1 (skips otherwise so CI/dev runs of the
 * mocked unit tests aren't blocked). Prerequisites for a green run (live-run setup, see
 * report): contract registered + provisioned (yarn provision), mock endpoint reachable by
 * the TEE and allow-listed, a beneficiary DID with a populated profile + grant.
 *
 * Run:  AIDLINK_CONFIRM_METERED=1 yarn tsx --test tests/phase1.integration.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bootstrap } from "../src/lib/client.js";

const RUN = process.env.AIDLINK_CONFIRM_METERED === "1";
const CONTRACT_TAIL = "aidlink";
const VERSION = process.env.AIDLINK_SCRIPT_VERSION ?? "0.1.0";
const BENEFICIARY = process.env.AIDLINK_BENEFICIARY ?? "ben_001";
const BENEFICIARY_DID = process.env.AIDLINK_BENEFICIARY_DID;
const PROBE_URL = process.env.AIDLINK_PROBE_URL ?? "https://aidlink-payout.example.com/echo";

async function ctx() {
  const { client, tenantDid } = await bootstrap();
  const scriptName = `z:${tenantDid.replace(/^did:t3n:/, "")}:${CONTRACT_TAIL}`;
  return { client, scriptName };
}

test("placeholder probe: host substitutes {{profile.first_name}} (real call)", { skip: !RUN }, async () => {
  const { client, scriptName } = await ctx();
  const res: any = await client.executeAndDecode({
    script_name: scriptName,
    script_version: VERSION,
    function_name: "probe-placeholder",
    input: { url: PROBE_URL, field: "first_name" },
    ...(BENEFICIARY_DID ? { pii_did: BENEFICIARY_DID } : {}),
  });
  // The endpoint reports whether the body still carried the literal template marker.
  assert.equal(res.was_templated, false, "host did NOT resolve the placeholder");
  assert.equal(res.resolved, true, "endpoint did not receive a resolved value");
});

test("eligibility check returns approved for the provisioned beneficiary (real call)", { skip: !RUN }, async () => {
  const { client, scriptName } = await ctx();
  const res: any = await client.executeAndDecode({
    script_name: scriptName,
    script_version: VERSION,
    function_name: "check-eligibility",
    input: { beneficiary_id: BENEFICIARY },
  });
  assert.equal(res.beneficiary_id, BENEFICIARY);
  assert.equal(res.approved, true);
});

test("payout returns a MASKED account, never plaintext (real call)", { skip: !RUN }, async () => {
  const { client, scriptName } = await ctx();
  const res: any = await client.executeAndDecode({
    script_name: scriptName,
    script_version: VERSION,
    function_name: "disburse-payout",
    input: { beneficiary_id: BENEFICIARY, amount: "250.00", currency: "USD" },
    ...(BENEFICIARY_DID ? { pii_did: BENEFICIARY_DID } : {}),
  });
  assert.match(res.account_masked, /^\*{4}\d{4}$/, "account should be masked as ****NNNN");
  assert.equal(res.status, "paid");
  // The contract must never echo a full account number anywhere in its response.
  assert.doesNotMatch(JSON.stringify(res), /\d{6,}/, "response leaked a long digit run (possible PAN)");
});
