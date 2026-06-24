/**
 * Exploration (priority 3) — contract lifecycle: version bump, monotonicity, disable/enable/unregister.
 *
 *  - Re-register `aidlink` at a HIGHER version (0.1.1)         → expect success (non-destructive).
 *  - Re-register `aidlink` at a NON-increasing version (0.1.0) → expect "version not higher".
 *  - On a THROWAWAY contract (`aidlink-lifecycle`, to avoid risking contract_id=445):
 *      register → invoke (works) → disable → invoke (expect blocked) → enable → invoke (works)
 *      → unregister → invoke (expect gone).
 *
 *   AIDLINK_CONFIRM_METERED=1 yarn tsx src/explore-contract-lifecycle.ts
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { bootstrap } from "./lib/client.js";

const WASM = resolve(dirname(fileURLToPath(import.meta.url)), "../../contract/target/wasm32-wasip2/release/aidlink.wasm");
const THROWAWAY = "aidlink-lifecycle";

async function step<T>(label: string, fn: () => Promise<T>): Promise<{ ok: boolean; val?: T; err?: string }> {
  try {
    const val = await fn();
    console.log(`  ✅ ${label}: ${JSON.stringify(val)}`);
    return { ok: true, val };
  } catch (e: any) {
    const err = String(e?.detail ?? e?.message ?? e);
    console.log(`  ⛔ ${label}: ${err.slice(0, 160)}`);
    return { ok: false, err };
  }
}

async function main() {
  if (process.env.AIDLINK_CONFIRM_METERED !== "1") {
    console.error("[lifecycle] REFUSING TO RUN: METERED. Use AIDLINK_CONFIRM_METERED=1.");
    process.exit(3);
  }
  const { client, tenant, tenantDid } = await bootstrap();
  const wasm = await readFile(WASM);
  const hex = tenantDid.replace(/^did:t3n:/, "");
  const invoke = (tail: string, version: string) =>
    client.executeAndDecode({ script_name: `z:${hex}:${tail}`, script_version: version, function_name: "check-eligibility", input: { beneficiary_id: "ben_001" } });

  console.log("== VERSION BUMP + MONOTONICITY (on real `aidlink`) ==");
  await step("register aidlink @0.1.1 (higher → expect OK)", () => tenant.contracts.register({ tail: "aidlink", version: "0.1.1", wasm }));
  await step("register aidlink @0.1.0 (non-increasing → expect rejection)", () => tenant.contracts.register({ tail: "aidlink", version: "0.1.0", wasm }));
  await step("invoke aidlink @0.1.1 (new version usable)", () => invoke("aidlink", "0.1.1"));

  console.log("\n== DISABLE / ENABLE / UNREGISTER (on throwaway `" + THROWAWAY + "`) ==");
  await step(`register ${THROWAWAY} @0.1.0`, () => tenant.contracts.register({ tail: THROWAWAY, version: "0.1.0", wasm }));
  await step(`invoke ${THROWAWAY} (pre-disable → expect OK)`, () => invoke(THROWAWAY, "0.1.0"));
  await step(`contracts.disable(${THROWAWAY})`, () => tenant.contracts.disable(THROWAWAY));
  await step(`invoke ${THROWAWAY} (post-disable → expect blocked)`, () => invoke(THROWAWAY, "0.1.0"));
  await step(`contracts.enable(${THROWAWAY})`, () => tenant.contracts.enable(THROWAWAY));
  await step(`invoke ${THROWAWAY} (post-enable → expect OK)`, () => invoke(THROWAWAY, "0.1.0"));
  await step(`contracts.unregister(${THROWAWAY})`, () => tenant.contracts.unregister(THROWAWAY));
  await step(`invoke ${THROWAWAY} (post-unregister → expect gone)`, () => invoke(THROWAWAY, "0.1.0"));

  console.log("\n[lifecycle] done — contract_id=445 (`aidlink`) untouched except an additive 0.1.1 version.");
}

main().catch((e) => {
  console.error("[lifecycle] FAILED:", e?.detail ?? e?.message ?? e);
  process.exit(1);
});
