/**
 * Read-only balance diagnostic (NOT metered) — dumps the exact getUsage()
 * payload and the token-conversion math for the BUGS.md balance entry.
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
  BASE_UNITS_PER_TOKEN,
  TOKEN_DECIMALS,
} from "@terminal3/t3n-sdk";

const apiKey = process.env.T3N_API_KEY!;
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
const usage = await client.getUsage();

console.log("node:", baseUrl);
console.log("DID :", did.value);
console.log("TOKEN_DECIMALS       =", TOKEN_DECIMALS);
console.log("BASE_UNITS_PER_TOKEN =", BASE_UNITS_PER_TOKEN);
console.log("raw usage.balance    =", JSON.stringify(usage.balance));
console.log("raw usage.entries    =", JSON.stringify(usage.entries));
console.log(
  `available: ${usage.balance.available} base units = ${formatTokens(usage.balance.available)} T3N tokens`,
);
console.log(
  `claimed grant 20,000 tokens would be ${20000 * BASE_UNITS_PER_TOKEN} base units; ` +
    `we hold ${usage.balance.available} base units (ratio ${
      (20000 * BASE_UNITS_PER_TOKEN) / Math.max(usage.balance.available, 1)
    }x short).`,
);
