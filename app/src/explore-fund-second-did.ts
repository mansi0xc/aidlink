/**
 * BUG-018 prep — attempt to self-provision a FUNDED second DID (no dashboard/email access).
 *
 * A fresh key → new DID, then `submitUserInput({ becomeDevTenant: true })`: a first-time
 * testnet self-admit is documented to mint welcome credits into the new tenant. If that funds
 * the DID above the 10k-token floor, we can use it as an uninvited cross-tenant caller (B) to
 * finally answer BUG-018. If it errors (EmailNotVerified) or mints nothing, the second-DID
 * path is not self-serviceable and we say so.
 *
 *   AIDLINK_CONFIRM_METERED=1 yarn tsx src/explore-fund-second-did.ts
 *
 * Prints the fresh key so a successful one can be reused by explore-cross-tenant-authz.ts.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import {
  T3nClient, setEnvironment, getNodeUrl, loadWasmComponent,
  eth_get_address, metamask_sign, createEthAuthInput, formatTokens,
} from "@terminal3/t3n-sdk";

async function main() {
  if (process.env.AIDLINK_CONFIRM_METERED !== "1") {
    console.error("[fund] REFUSING TO RUN: METERED. Use AIDLINK_CONFIRM_METERED=1.");
    process.exit(3);
  }
  setEnvironment("testnet");
  const baseUrl = getNodeUrl();
  const wasm = await loadWasmComponent();

  const key = process.env.SECOND_KEY ?? "0x" + randomBytes(32).toString("hex");
  const address = eth_get_address(key);
  const client = new T3nClient({ baseUrl, wasmComponent: wasm, handlers: { EthSign: metamask_sign(address, undefined, key) } });
  await client.handshake();
  const did = (await client.authenticate(createEthAuthInput(address))).value;
  console.log(`[fund] fresh key: ${key}`);
  console.log(`[fund] DID: ${did}  address: ${address}`);

  const before = await client.getUsage();
  console.log(`[fund] balance BEFORE: ${before.balance.available} base units`);

  console.log("[fund] submitUserInput({ profile, becomeDevTenant:true }) on the fresh DID …");
  try {
    const res = await client.submitUserInput({
      profile: { first_name: "TenantB", role: "security-test-only" },
      becomeDevTenant: true,
    });
    console.log("[fund] submitUserInput result:", JSON.stringify(res));
    if (res.tenantAdmit) console.log(`[fund] tenantAdmit.status=${res.tenantAdmit.status} grantedCredits=${res.tenantAdmit.grantedCredits ?? "null"}`);
  } catch (e: any) {
    console.log(`[fund] ⛔ submitUserInput threw: kind=${e?.kind ?? ""} ${String(e?.detail ?? e?.message ?? e).slice(0, 200)}`);
  }

  const after = await client.getUsage();
  console.log(`[fund] balance AFTER: ${after.balance.available} base units = ${formatTokens(after.balance.available)} tokens`);
  const funded = after.balance.available >= 10_000_000_000;
  console.log(`[fund] ${funded ? "✅ FUNDED above the 10k-token floor — usable as caller B" : "⛔ NOT funded — second-DID path is not self-serviceable"}`);
  if (funded) console.log(`[fund] reuse with: SECOND_KEY=${key} ... explore-cross-tenant-authz.ts`);
}

main().catch((e) => { console.error("[fund] FAILED:", e?.detail ?? e?.message ?? e); process.exit(1); });
