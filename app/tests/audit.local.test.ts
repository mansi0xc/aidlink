/**
 * Audit ledger — LOCAL test (no sandbox). Proves the "immutable" claim: the hash chain
 * detects any tampering, and account numbers are only ever stored masked.
 *
 * Run:  yarn tsx --test tests/audit.local.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AuditLedger } from "../src/lib/audit.js";

test("append builds a verifiable hash chain", () => {
  const l = new AuditLedger();
  l.append({ kind: "eligibility-check", beneficiary_id: "ben_001", detail: { approved: true } });
  l.append({ kind: "payout", beneficiary_id: "ben_001", detail: { account_masked: "****6819", status: "paid" } });
  l.append({ kind: "delegation-grant", beneficiary_id: "ben_001", detail: { functions: ["disburse-payout"] } });
  const rows = l.all();
  assert.equal(rows.length, 3);
  assert.equal(rows[0].prev_hash, "0".repeat(64), "genesis prev_hash");
  assert.equal(rows[1].prev_hash, rows[0].hash, "row links to previous hash");
  assert.equal(rows[2].prev_hash, rows[1].hash);
  assert.equal(l.verify().ok, true);
});

test("tampering with a row's detail breaks the chain", () => {
  const l = new AuditLedger();
  l.append({ kind: "eligibility-check", beneficiary_id: "ben_001", detail: { approved: false } });
  l.append({ kind: "payout", beneficiary_id: "ben_001", detail: { status: "paid" } });
  // Forge an approval after the fact, without recomputing hashes.
  (l.all() as any)[0].detail.approved = true;
  const v = l.verify();
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 0);
});

test("render shows masked accounts and never a full PAN", () => {
  const l = new AuditLedger();
  l.append({ kind: "payout", beneficiary_id: "ben_001", detail: { account_masked: "****6819" } });
  const out = l.render();
  assert.match(out, /\*{4}6819/);
  assert.doesNotMatch(out, /\d{7,}/);
  assert.match(out, /chain intact/);
});
