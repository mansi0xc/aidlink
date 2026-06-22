/**
 * Phase 2 — human-helper delegation flow (SDK-native, per BUG-001).
 *
 * A beneficiary with no phone grants a local volunteer a SINGLE-USE, TIME-BOXED,
 * function-scoped authority to act for them — without handing over their ID or bank
 * details. The volunteer completes one action while the grant is live; the beneficiary
 * then revokes it; the next attempt is denied (`NotCredentialHolder` from the delegation
 * contract). Every primitive here is a real export of @terminal3/t3n-sdk@3.9.0:
 *
 *   buildDelegationCredential  → construct a time-boxed, scoped credential
 *   signCredential             → beneficiary (ETH-EOA) signs the credential locally
 *   canonicaliseCredential     → RFC 8785 JCS bytes that get signed
 *   validateCredentialBody     → same body invariants the Rust contract enforces
 *   ethRecoverEip191           → recover the signer to prove who authorized it
 *   revokeDelegation           → wraps tee:delegation/contracts::revoke (user-only)
 *
 * The build/sign/recover/validate steps are pure (no network) and are covered by
 * tests/phase2-delegation.local.test.ts. Only `revokeHelperCredential` touches the
 * sandbox (it is METERED) and is exercised live by the guarded phase2-delegation script.
 */
import {
  buildDelegationCredential,
  signCredential,
  canonicaliseCredential,
  validateCredentialBody,
  ethRecoverEip191,
  revokeDelegation,
  b64uEncodeBytes,
  VC_ID_LEN,
  type DelegationCredential,
  type RevokeDelegationResult,
  type T3nClient,
} from "@terminal3/t3n-sdk";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { randomBytes } from "node:crypto";

/** Derive a helper agent's 33-byte compressed secp256k1 pubkey from its private key. */
export function helperPubkeyFromSecret(secret: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(secret, true);
}

/** Strip `0x` and decode a hex private key to 32 raw bytes. */
export function secretFromHex(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex.replace(/^0x/, ""), "hex"));
}

export interface HelperGrantParams {
  /** Beneficiary (data owner) DID — the only party who may later revoke. */
  beneficiaryDid: string;
  /** NGO/disbursement org DID the grant is scoped to. */
  orgDid: string;
  /** Contract the helper may invoke, e.g. `z:<tidB>:aidlink`. */
  contract: string;
  /** Helper agent's 33-byte compressed pubkey (see {@link helperPubkeyFromSecret}). */
  helperPubkey: Uint8Array;
  /** Functions the helper may call — scoped, e.g. `["disburse-payout"]`. */
  functions: string[];
  /** Length of the validity window in seconds (time-box). */
  windowSecs: number;
  /** Override "now" (unix secs) — for deterministic tests. */
  nowSecs?: number;
  scopes?: string[];
  metadata?: Record<string, string>;
}

/**
 * Build a time-boxed, function-scoped delegation credential for the helper.
 * Functions are lowercased, deduped and sorted to satisfy the SDK's body invariants.
 */
export function buildHelperCredential(p: HelperGrantParams): DelegationCredential {
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const functions = [...new Set(p.functions.map((f) => f.toLowerCase()))].sort();
  return buildDelegationCredential({
    user_did: p.beneficiaryDid,
    agent_pubkey: p.helperPubkey,
    org_did: p.orgDid,
    contract: p.contract,
    functions,
    scopes: p.scopes ?? [],
    metadata: p.metadata ?? {},
    not_before_secs: now,
    not_after_secs: now + p.windowSecs,
    vc_id: randomBytes(VC_ID_LEN),
  });
}

export interface SignedCredential {
  credential: DelegationCredential;
  /** RFC 8785 JCS bytes that were signed. */
  jcs: Uint8Array;
  /** base64url-no-pad of `jcs` — the form `revokeDelegation` wants. */
  jcsB64u: string;
  /** 65-byte EIP-191 signature (r||s||v). */
  sig: Uint8Array;
  /** 20-byte ETH address recovered from the signature (the beneficiary). */
  signerAddr: Uint8Array;
}

/** Beneficiary signs the credential locally (ETH-EOA path — no network round-trip). */
export function signAsBeneficiary(
  credential: DelegationCredential,
  beneficiarySecret: Uint8Array,
): SignedCredential {
  validateCredentialBody(credential); // throws on the same invariants the Rust side rejects
  const jcs = canonicaliseCredential(credential);
  const { sig, addr } = signCredential(jcs, beneficiarySecret);
  return { credential, jcs, jcsB64u: b64uEncodeBytes(jcs), sig, signerAddr: addr };
}

/** Recover the address that signed a credential — proves who authorized the grant. */
export function recoverSigner(signed: SignedCredential): Uint8Array {
  return ethRecoverEip191(signed.jcs, signed.sig);
}

/** True iff `nowSecs` is inside the credential's [not_before, not_after] window. */
export function isWithinWindow(
  cred: DelegationCredential,
  nowSecs: number = Math.floor(Date.now() / 1000),
): boolean {
  const n = BigInt(nowSecs);
  return n >= cred.not_before_secs && n <= cred.not_after_secs;
}

/**
 * Revoke the helper's credential (whole credential, or narrow to a function subset).
 * METERED. Only the credential's `user_did` (beneficiary) may call this — any other
 * caller is rejected with `NotCredentialHolder`.
 */
export async function revokeHelperCredential(
  client: T3nClient,
  signed: SignedCredential,
  opts?: { revokedFunctions?: string[]; baseUrl?: string },
): Promise<RevokeDelegationResult> {
  // NOTE: `baseUrl` is REQUIRED under Node — revokeDelegation's default script-version
  // resolution fetches a relative URL (`/api/contracts/current?...`) that Node's fetch
  // cannot parse (ERR_INVALID_URL). See BUGS.md BUG-014. Browsers resolve it against origin.
  return revokeDelegation({
    credentialJcsB64u: signed.jcsB64u,
    client,
    ...(opts?.revokedFunctions ? { revokedFunctions: opts.revokedFunctions } : {}),
    ...(opts?.baseUrl ? { baseUrl: opts.baseUrl } : {}),
  });
}
