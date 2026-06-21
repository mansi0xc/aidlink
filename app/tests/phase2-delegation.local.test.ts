/**
 * Phase 2 delegation — LOCAL test (no sandbox, no network, nothing mocked).
 *
 * Runs the REAL @terminal3/t3n-sdk delegation primitives offline to prove the
 * human-helper credential is correctly time-boxed, function-scoped, and validly signed by
 * the beneficiary — and that the SDK's own validators accept/reject the same way the Rust
 * contract would. This is the substantive correctness proof for Phase 2's delegation,
 * independent of any live balance.
 *
 * Run:  yarn tsx --test tests/phase2-delegation.local.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { validateCredentialBody, canonicaliseCredential } from "@terminal3/t3n-sdk";
import {
  buildHelperCredential,
  signAsBeneficiary,
  recoverSigner,
  isWithinWindow,
  helperPubkeyFromSecret,
  secretFromHex,
} from "../src/lib/delegation.js";

const BENEFICIARY_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const HELPER_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";
const BENEFICIARY_DID = "did:t3n:1111111111111111111111111111111111111111";
const ORG_DID = "did:t3n:2222222222222222222222222222222222222222";
// NOTE: the credential `contract` field maxes ~40 chars (see BUGS.md BUG-012), so a full
// z-tenant script name `z:<40hex>:aidlink` (50 chars) does NOT fit — use a short logical id.
const CONTRACT = "z:aidlink";

function makeSigned(nowSecs: number, windowSecs = 300) {
  const helperPubkey = helperPubkeyFromSecret(secretFromHex(HELPER_KEY));
  const cred = buildHelperCredential({
    beneficiaryDid: BENEFICIARY_DID,
    orgDid: ORG_DID,
    contract: CONTRACT,
    helperPubkey,
    functions: ["disburse-payout"],
    windowSecs,
    nowSecs,
  });
  return { cred, signed: signAsBeneficiary(cred, secretFromHex(BENEFICIARY_KEY)) };
}

test("credential is time-boxed: not_after = not_before + window", () => {
  const now = 1_750_000_000;
  const { cred } = makeSigned(now, 300);
  assert.equal(cred.not_before_secs, BigInt(now));
  assert.equal(cred.not_after_secs, BigInt(now + 300));
  assert.equal(isWithinWindow(cred, now + 10), true);
  assert.equal(isWithinWindow(cred, now + 999), false, "must be expired past the window");
});

test("credential is function-scoped (sorted, deduped, lowercase)", () => {
  const helperPubkey = helperPubkeyFromSecret(secretFromHex(HELPER_KEY));
  const cred = buildHelperCredential({
    beneficiaryDid: BENEFICIARY_DID,
    orgDid: ORG_DID,
    contract: CONTRACT,
    helperPubkey,
    functions: ["Disburse-Payout", "disburse-payout", "check-eligibility"],
    windowSecs: 60,
    nowSecs: 1_750_000_000,
  });
  assert.deepEqual(cred.functions, ["check-eligibility", "disburse-payout"]);
});

test("beneficiary signature recovers to the beneficiary's own address", () => {
  const now = 1_750_000_000;
  const { signed } = makeSigned(now);
  const recovered = recoverSigner(signed);
  assert.deepEqual(recovered, signed.signerAddr, "ethRecoverEip191 must match the signer addr");
  assert.equal(recovered.length, 20);
});

test("validateCredentialBody accepts a well-formed credential and the JCS is deterministic", () => {
  const now = 1_750_000_000;
  const { cred } = makeSigned(now);
  assert.doesNotThrow(() => validateCredentialBody(cred));
  // RFC 8785 JCS is canonical → byte-identical across calls.
  assert.deepEqual(canonicaliseCredential(cred), canonicaliseCredential(cred));
});

test("validateCredentialBody rejects an empty function set", () => {
  const helperPubkey = helperPubkeyFromSecret(secretFromHex(HELPER_KEY));
  // Build a structurally-complete credential but with no functions, then validate.
  const bad = {
    v: "ot3.delegation/1",
    user_did: BENEFICIARY_DID,
    agent_pubkey: helperPubkey,
    org_did: ORG_DID,
    contract: CONTRACT,
    functions: [] as string[],
    scopes: [],
    metadata: {},
    not_before_secs: 1_750_000_000n,
    not_after_secs: 1_750_000_300n,
    vc_id: randomBytes(16),
  };
  assert.throws(() => validateCredentialBody(bad as any));
});
