/**
 * Phase 1 provisioning — STAGED, NOT YET RUN. Every step here is METERED.
 *
 * Guarded by AIDLINK_CONFIRM_METERED=1 so it cannot run by accident before the balance
 * top-up (BUGS.md BUG-005) is confirmed. To run later:
 *   AIDLINK_CONFIRM_METERED=1 yarn tsx src/provision.ts
 *
 * Steps (in order):
 *   1. register the WASM contract            (ChargeReason: contract_register)
 *   2. create `eligibility` + `secrets` maps (ChargeReason: kv_bytes)
 *   3. seed secrets: payout_api_key, payout_url
 *   4. write a sample eligibility decision   (so check-eligibility has data)
 *   5. ensure egress allow-list for the payout host  [MECHANISM UNCONFIRMED — see note]
 *
 * Shapes used here are all confirmed from @terminal3/t3n-sdk@3.9.0 index.d.ts:
 *   tenant.contracts.register({ tail, version, wasm })  -> { contract_id, ... }
 *   tenant.maps.create({ tail, visibility, writers, readers })
 *   tenant.executeControl("map-entry-set", { map_name: tenant.canonicalName(tail), key, value })
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { bootstrap, printBalance } from "./lib/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../contract/target/wasm32-wasip2/release/aidlink.wasm");

const CONTRACT_TAIL = "aidlink";
const CONTRACT_VERSION = "0.1.0";

// Demo data + secrets (override via env when running for real).
const SAMPLE_BENEFICIARY = process.env.AIDLINK_BENEFICIARY ?? "ben_001";
const PAYOUT_URL = process.env.AIDLINK_PAYOUT_URL ?? "https://aidlink-payout.example.com/v1/payouts";
const PAYOUT_API_KEY = process.env.PAYOUT_API_KEY ?? "aidlink_mock_key";

function guard() {
  if (process.env.AIDLINK_CONFIRM_METERED !== "1") {
    console.error(
      "\n[provision] REFUSING TO RUN: this script performs METERED operations " +
        "(contract_register, kv_bytes …).\n" +
        "Confirm the balance top-up first, then re-run with AIDLINK_CONFIRM_METERED=1.\n",
    );
    process.exit(3);
  }
}

async function main() {
  guard();
  const { client, tenant, tenantDid } = await bootstrap();
  console.log(`[provision] tenant ${tenantDid}`);
  await printBalance(client, "provision:before");

  // (1) Register the contract.
  const wasm = await readFile(WASM_PATH);
  console.log(`[provision] registering ${CONTRACT_TAIL}@${CONTRACT_VERSION} (${wasm.byteLength} bytes) …`);
  const reg: any = await tenant.contracts.register({
    tail: CONTRACT_TAIL,
    version: CONTRACT_VERSION,
    wasm,
  });
  const contractId = reg?.contract_id ?? reg?.contractId;
  console.log(`[provision] registered. contract_id=${contractId}`, reg);

  // (2) Create maps. readers MUST be set or the KV governor denies (common-errors doc).
  // MapAlreadyExists is safe to ignore on re-runs.
  for (const tail of ["eligibility", "secrets"]) {
    try {
      await tenant.maps.create({
        tail,
        visibility: "private",
        writers: { only: [contractId] },
        readers: { only: [contractId] },
      } as any);
      console.log(`[provision] created map z:<tid>:${tail}`);
    } catch (e: any) {
      if (String(e?.message ?? e).toLowerCase().includes("already")) {
        console.log(`[provision] map ${tail} already exists — ok`);
      } else {
        throw e;
      }
    }
  }

  // (3) Seed secrets via the control plane (bypasses normal ACL — seed-api-key doc).
  await tenant.executeControl("map-entry-set", {
    map_name: tenant.canonicalName("secrets"),
    key: "payout_api_key",
    value: PAYOUT_API_KEY,
  });
  await tenant.executeControl("map-entry-set", {
    map_name: tenant.canonicalName("secrets"),
    key: "payout_url",
    value: PAYOUT_URL,
  });
  console.log("[provision] seeded secrets: payout_api_key, payout_url");

  // (4) Write a sample eligibility decision so check-eligibility returns approved.
  await tenant.executeControl("map-entry-set", {
    map_name: tenant.canonicalName("eligibility"),
    key: SAMPLE_BENEFICIARY,
    value: JSON.stringify({ approved: true, zone: "Z3", reason: "verified flood-zone resident" }),
  });
  console.log(`[provision] wrote eligibility[${SAMPLE_BENEFICIARY}] = approved`);

  // (5) Egress allow-list for the payout host.
  await ensureEgressAllowlist(PAYOUT_URL);

  await printBalance(client, "provision:after");
  console.log("\n[provision] done.");
}

/**
 * UNCONFIRMED MECHANISM — do not guess silently.
 *
 * The host gates outbound HTTP on the contract's `http_allow_list` (host-interfaces WIT
 * doc-comment; `egress_denied` otherwise). The narrative docs only describe adding hosts
 * via the dashboard ("Authorized TEE contract → allowed hosts"). The SDK exposes
 * `agent-auth update-authorisations` (with an `allowedHosts` field) for USER→AGENT
 * delegation grants — relevant to Phase 2's delegated/cross-tenant calls — but no
 * confirmed SDK call sets a TENANT-LOCAL contract's egress allow-list for a self-call.
 *
 * Resolution plan (zero-token research already noted): on the first live run, try the
 * dashboard allow-list for the payout host; if an SDK/control-plane op exists
 * (e.g. an executeControl op name), capture it and log the finding in BUGS.md.
 */
async function ensureEgressAllowlist(payoutUrl: string) {
  const host = new URL(payoutUrl).host;
  console.warn(
    `[provision] ⚠️  EGRESS ALLOW-LIST for "${host}" is not set programmatically here — ` +
      `mechanism unconfirmed (see function doc + BUGS.md). Add it via the dashboard before ` +
      `invoking disburse-payout/probe, or wire the confirmed op here once known.`,
  );
}

main().catch((e) => {
  console.error("\n[provision] FAILED.");
  console.error(e);
  process.exit(1);
});
