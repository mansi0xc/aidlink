/**
 * Shared T3N bootstrap for AidLink /app scripts.
 *
 * Produces an authenticated `T3nClient` (handshake + authenticate) and a `TenantClient`
 * bound to the authenticated DID. These calls (handshake/authenticate) are NOT metered —
 * see BUGS.md BUG-005 metering notes. Anything beyond this (register/maps/seed/invoke) IS
 * metered and must wait for the balance top-up.
 */
import "dotenv/config";
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

export interface Bootstrap {
  client: T3nClient;
  tenant: TenantClient;
  tenantDid: string;
  address: string;
  baseUrl: string;
}

export function requireApiKey(): string {
  const v = process.env.T3N_API_KEY;
  if (!v || v.startsWith("0x...")) {
    console.error("[client] Missing T3N_API_KEY in app/.env — refusing to mock.");
    process.exit(2);
  }
  return v;
}

/**
 * Handshake + authenticate, then build a tenant client. The tenant DID is read back from
 * the authenticated session (never hard-coded), per the setup docs.
 */
export async function bootstrap(): Promise<Bootstrap> {
  const apiKey = requireApiKey();
  setEnvironment("testnet");
  const baseUrl = getNodeUrl();

  const wasmComponent = await loadWasmComponent();
  const address = eth_get_address(apiKey);

  const client = new T3nClient({
    baseUrl,
    wasmComponent,
    handlers: { EthSign: metamask_sign(address, undefined, apiKey) },
  });

  await client.handshake();
  const did = await client.authenticate(createEthAuthInput(address));
  const tenantDid = did.value;

  const tenant = new TenantClient({ t3n: client, baseUrl, tenantDid, environment: "testnet" });

  return { client, tenant, tenantDid, address, baseUrl };
}

/** Hex-encode the 20-byte tenant id from a `did:t3n:<40-hex>` string. */
export function tenantHex(tenantDid: string): string {
  return tenantDid.replace(/^did:t3n:/, "");
}

/** Print the current balance (read-only, not metered). Returns base units available. */
export async function printBalance(client: T3nClient, label = "balance"): Promise<number> {
  const usage = await client.getUsage();
  const b = usage.balance;
  console.log(`[${label}] available=${b.available} base units, reserved=${b.reserved}`);
  return b.available;
}
