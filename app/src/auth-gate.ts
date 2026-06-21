/**
 * Phase 0 auth gate — a REAL round-trip against the T3N testnet sandbox.
 *
 * No mocks, no stubs. If the key is missing or the sandbox rejects the call,
 * this exits non-zero with the actual error. Success = a real token balance
 * printed back from the node.
 *
 * Run: yarn auth-gate   (from /app)
 */
import "dotenv/config";
import {
  T3nClient,
  setEnvironment,
  getNodeUrl,
  loadWasmComponent,
  eth_get_address,
  metamask_sign,
  createEthAuthInput,
  formatTokens,
} from "@terminal3/t3n-sdk";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith("0x...") || v.includes("did:t3n:...")) {
    console.error(
      `\n[auth-gate] Missing/placeholder ${name}. Set it in app/.env — refusing to mock.\n`,
    );
    process.exit(2);
  }
  return v;
}

async function main() {
  const apiKey = requireEnv("T3N_API_KEY");

  setEnvironment("testnet");
  const baseUrl = getNodeUrl();
  console.log(`[auth-gate] environment=testnet node=${baseUrl}`);

  const wasmComponent = await loadWasmComponent();
  const address = eth_get_address(apiKey);
  console.log(`[auth-gate] derived wallet address: ${address}`);

  const client = new T3nClient({
    baseUrl,
    wasmComponent,
    handlers: { EthSign: metamask_sign(address, undefined, apiKey) },
  });

  console.log("[auth-gate] handshake() …");
  const hs = await client.handshake();
  console.log(`[auth-gate] handshake ok: ${JSON.stringify(hs)}`);

  console.log("[auth-gate] authenticate() …");
  const did = await client.authenticate(createEthAuthInput(address));
  console.log(`[auth-gate] authenticated DID: ${did.value}`);

  if (process.env.T3N_DID && process.env.T3N_DID !== did.value) {
    console.warn(
      `[auth-gate] NOTE: authenticated DID differs from .env T3N_DID (${process.env.T3N_DID}).`,
    );
  }

  console.log("[auth-gate] getUsage() …");
  const usage = await client.getUsage();
  const b = usage.balance;
  console.log(
    `[auth-gate] BALANCE available=${formatTokens(b.available)} ` +
      `reserved=${formatTokens(b.reserved)} ` +
      `(base units: available=${b.available} reserved=${b.reserved}) ` +
      `credit_exhausted=${b.credit_exhausted}`,
  );

  console.log("\n✅ Phase 0 auth gate PASSED — real balance returned from the live sandbox.");
}

main().catch((err) => {
  console.error("\n❌ Phase 0 auth gate FAILED.");
  console.error(err);
  process.exit(1);
});
