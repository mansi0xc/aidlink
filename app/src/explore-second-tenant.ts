/**
 * Exploration (priority 2) — can we self-provision a genuine SECOND tenant/DID?
 *
 * Generates a fresh ETH key, authenticates it (→ a new DID), and probes how far a brand-new
 * identity gets: balance (welcome grant?), tenant status (admitted?), and whether it can
 * register a contract. Establishes empirically whether a true A≠B two-tenant setup is
 * self-serviceable, or blocked on funding/admission/email.
 *
 *   AIDLINK_CONFIRM_METERED=1 yarn tsx src/explore-second-tenant.ts
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import {
  T3nClient,
  TenantClient,
  setEnvironment,
  getNodeUrl,
  loadWasmComponent,
  eth_get_address,
  metamask_sign,
  createEthAuthInput,
} from "@terminal3/t3n-sdk";

const WASM = resolve(dirname(fileURLToPath(import.meta.url)), "../../contract/target/wasm32-wasip2/release/aidlink.wasm");

async function main() {
  if (process.env.AIDLINK_CONFIRM_METERED !== "1") {
    console.error("[2nd] REFUSING TO RUN: METERED. Use AIDLINK_CONFIRM_METERED=1.");
    process.exit(3);
  }
  setEnvironment("testnet");
  const baseUrl = getNodeUrl();
  const wasm = await loadWasmComponent();

  const key = "0x" + randomBytes(32).toString("hex");
  const address = eth_get_address(key);
  console.log(`[2nd] fresh key → address ${address}`);

  const client = new T3nClient({ baseUrl, wasmComponent: wasm, handlers: { EthSign: metamask_sign(address, undefined, key) } });
  await client.handshake();
  const did = await client.authenticate(createEthAuthInput(address));
  console.log(`[2nd] authenticated NEW DID: ${did.value}`);

  const usage = await client.getUsage();
  console.log(`[2nd] balance: ${usage.balance.available} base units (welcome grant for a fresh DID?)`);

  const tenant = new TenantClient({ t3n: client, baseUrl, tenantDid: did.value, environment: "testnet" });
  console.log("[2nd] tenant.tenant.me() …");
  try {
    const me = await tenant.tenant.me();
    console.log("[2nd] me():", JSON.stringify(me));
  } catch (e: any) {
    console.log(`[2nd] me() threw: ${e?.detail ?? e?.message ?? e}`);
  }

  console.log("[2nd] attempting contract register on the fresh DID …");
  try {
    const wasmBytes = await readFile(WASM);
    const reg = await tenant.contracts.register({ tail: "aidlink-verify", version: "0.1.0", wasm: wasmBytes });
    console.log("[2nd] ✅ register OK:", JSON.stringify(reg), "→ a fresh DID CAN be a tenant");
  } catch (e: any) {
    console.log(`[2nd] ⛔ register failed: ${e?.detail ?? e?.message ?? e}`);
    console.log("[2nd] → a fresh DID likely needs funding + admission (email-verified) first.");
  }
}

main().catch((e) => {
  console.error("[2nd] FAILED:", e?.detail ?? e?.message ?? e);
  process.exit(1);
});
