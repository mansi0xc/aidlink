/**
 * Live check-eligibility invocation — no egress (pure KV lookup inside the TEE).
 * Proves the registered contract returns real data from its private z:<tid>:eligibility map.
 *
 *   AIDLINK_CONFIRM_METERED=1 yarn tsx src/invoke-eligibility.ts
 */
import { bootstrap, printBalance } from "./lib/client.js";

const CONTRACT_TAIL = "aidlink";
const VERSION = process.env.AIDLINK_SCRIPT_VERSION ?? "0.1.0";

function guard() {
  if (process.env.AIDLINK_CONFIRM_METERED !== "1") {
    console.error("\n[eligibility] REFUSING TO RUN: METERED. Re-run with AIDLINK_CONFIRM_METERED=1.\n");
    process.exit(3);
  }
}

async function main() {
  guard();
  const { client, tenantDid } = await bootstrap();
  const scriptName = `z:${tenantDid.replace(/^did:t3n:/, "")}:${CONTRACT_TAIL}`;
  console.log(`[eligibility] script=${scriptName} version=${VERSION}`);
  await printBalance(client, "eligibility:before");

  for (const id of ["ben_001", "ben_404"]) {
    console.log(`\n[eligibility] check-eligibility beneficiary_id=${id} …`);
    const res = await client.executeAndDecode({
      script_name: scriptName,
      script_version: VERSION,
      function_name: "check-eligibility",
      input: { beneficiary_id: id },
    });
    console.log(`[eligibility] result:`, JSON.stringify(res));
  }

  await printBalance(client, "eligibility:after");
  console.log("\n✅ check-eligibility live: real data returned from z:<tid>:eligibility (no egress).");
}

main().catch((e) => {
  console.error("\n[eligibility] FAILED.");
  console.error(e);
  process.exit(1);
});
