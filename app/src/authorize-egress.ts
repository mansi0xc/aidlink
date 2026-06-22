/**
 * Authorize egress for our contracts via the agent-auth-update path supplied by Terminal3's
 * devrel team (the documented dashboard flow is a tracked platform bug — see BUGS.md
 * BUG-013). Calls `tee:user/contracts::agent-auth-update` to allow-list outbound hosts for
 * all of our contracts (scriptName "*", sidestepping the BUG-003 tail-vs-full-name issue).
 *
 *   AIDLINK_CONFIRM_METERED=1 yarn tsx src/authorize-egress.ts
 */
import { getScriptVersion } from "@terminal3/t3n-sdk";
import { bootstrap } from "./lib/client.js";

const AGENT_DID = process.env.AIDLINK_BENEFICIARY_DID ?? "did:t3n:5cc23ceebac85b5e55476a4b0d8a0b3a74c77f2d";
const HOSTS = (process.env.AIDLINK_ALLOWED_HOSTS ?? "postman-echo.com").split(",").map((h) => h.trim());

function guard() {
  if (process.env.AIDLINK_CONFIRM_METERED !== "1") {
    console.error("\n[authorize] REFUSING TO RUN: METERED. Re-run with AIDLINK_CONFIRM_METERED=1.\n");
    process.exit(3);
  }
}

async function main() {
  guard();
  const { client, baseUrl } = await bootstrap();

  console.log("[authorize] resolving tee:user/contracts script version …");
  const version = await getScriptVersion(baseUrl, "tee:user/contracts");
  console.log(`[authorize] tee:user/contracts version = ${version}`);

  const input = {
    agents: [
      {
        agentDid: AGENT_DID,
        scripts: [{ scriptName: "*", allowedHosts: HOSTS }],
      },
    ],
  };
  console.log("[authorize] agent-auth-update input:", JSON.stringify(input));

  const res = await client.executeAndDecode({
    script_name: "tee:user/contracts",
    script_version: version,
    function_name: "agent-auth-update",
    input,
  });

  console.log("\n✅ agent-auth-update SUCCEEDED:", JSON.stringify(res));
  console.log(`   authorized hosts ${JSON.stringify(HOSTS)} for agent ${AGENT_DID}, scripts: "*"`);
}

main().catch((e) => {
  console.error("\n❌ agent-auth-update FAILED.");
  console.error(e);
  process.exit(1);
});
