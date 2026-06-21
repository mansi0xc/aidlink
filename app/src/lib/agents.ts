/**
 * Two-agent bootstrap for Phase 2: the verification agent (tenant A, "government side")
 * and the disbursement agent (tenant B, "NGO side"). Each is a distinct tenant DID with
 * its own key. Real tenant boundary => the disbursement agent reaches the verification
 * agent only via `executeBusinessContract` (cross-tenant), never by sharing state.
 *
 * Keys: T3N_API_KEY_A (verification) and T3N_API_KEY_B (disbursement). For local
 * development with a single claimed key, both fall back to T3N_API_KEY with a loud
 * warning — the cross-tenant call shapes are still exercised, but A and B resolve to the
 * same DID until a second key is provided.
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
  type WasmComponent,
} from "@terminal3/t3n-sdk";

export interface Agent {
  role: "verification" | "disbursement";
  client: T3nClient;
  tenant: TenantClient;
  did: string;
  address: string;
  apiKey: string;
}

async function makeAgent(
  role: Agent["role"],
  apiKey: string,
  wasm: WasmComponent,
  baseUrl: string,
): Promise<Agent> {
  const address = eth_get_address(apiKey);
  const client = new T3nClient({
    baseUrl,
    wasmComponent: wasm,
    handlers: { EthSign: metamask_sign(address, undefined, apiKey) },
  });
  await client.handshake();
  const did = await client.authenticate(createEthAuthInput(address));
  const tenant = new TenantClient({ t3n: client, baseUrl, tenantDid: did.value, environment: "testnet" });
  return { role, client, tenant, did: did.value, address, apiKey };
}

export interface AgentPair {
  verification: Agent;
  disbursement: Agent;
  sameDid: boolean;
}

export async function bootstrapAgents(): Promise<AgentPair> {
  setEnvironment("testnet");
  const baseUrl = getNodeUrl();
  const wasm = await loadWasmComponent();

  const fallback = process.env.T3N_API_KEY;
  const keyA = process.env.T3N_API_KEY_A ?? fallback;
  const keyB = process.env.T3N_API_KEY_B ?? fallback;
  if (!keyA || !keyB) {
    console.error("[agents] need T3N_API_KEY_A and T3N_API_KEY_B (or T3N_API_KEY) — refusing to mock.");
    process.exit(2);
  }
  if (!process.env.T3N_API_KEY_A || !process.env.T3N_API_KEY_B) {
    console.warn(
      "[agents] ⚠️  Only one key present — verification and disbursement resolve to the SAME tenant DID. " +
        "Cross-tenant call shapes still run; provide T3N_API_KEY_A + _B for a true two-tenant boundary.",
    );
  }

  // Sequential (each does its own handshake/authenticate session).
  const verification = await makeAgent("verification", keyA, wasm, baseUrl);
  const disbursement = await makeAgent("disbursement", keyB, wasm, baseUrl);
  return { verification, disbursement, sameDid: verification.did === disbursement.did };
}

export function tenantHex(did: string): string {
  return did.replace(/^did:t3n:/, "");
}
