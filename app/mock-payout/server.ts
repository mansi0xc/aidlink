/**
 * AidLink mock payout endpoint (Phase 1).
 *
 * Stands in for a real bank/payment rail. Its job in the demo is to *prove* the
 * privacy guarantee:
 *
 *   - The AidLink contract sends the payee/account fields as host placeholders
 *     ("{{profile.bank_account}}" etc.). It NEVER holds the plaintext.
 *   - The Terminal3 host resolves those placeholders from the beneficiary's profile
 *     on the outbound stack, so THIS endpoint receives the REAL account number.
 *   - We log the received account (server-side only), then mask it (last 4) and echo
 *     the mask back. The masking happens here, outside the contract — so the contract
 *     and the audit trail only ever see "****1234".
 *
 * If a request body still contains the literal "{{profile.…}}" markers, that means the
 * host did NOT substitute (e.g. missing grant / missing profile field) — we flag it
 * loudly so the integration test fails clearly instead of silently paying a template.
 *
 * Run:  yarn mock-payout            (defaults to PORT=8787)
 * Expose to the testnet TEE via a tunnel (e.g. cloudflared/ngrok) and add that public
 * host to the contract's http_allow_list before invoking disburse-payout.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT ?? 8787);
const EXPECTED_BEARER = process.env.PAYOUT_API_KEY ?? "aidlink_mock_key";

function maskAccount(acct: string): string {
  const digits = acct.replace(/\s+/g, "");
  if (digits.length <= 4) return "****";
  return "****" + digits.slice(-4);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Cheap placeholder probe target (no auth). Reports whether the host substituted the
  // single templated field, and echoes a masked sample so the probe response leaks nothing.
  if (req.method === "POST" && req.url?.startsWith("/echo")) {
    const raw = await readBody(req);
    let body: any = {};
    try {
      body = JSON.parse(raw);
    } catch {
      /* tolerate */
    }
    const field: string = body?.probe_field ?? "";
    const value: string = body?.probe_value ?? "";
    const wasTemplated = typeof value === "string" && value.includes("{{profile.");
    const mask =
      !value || wasTemplated ? "" : value.length <= 2 ? "*" : value.slice(0, 1) + "***";
    console.log(
      `[mock-payout] /echo probe field="${field}" resolved=${!wasTemplated && !!value} ` +
        `was_templated=${wasTemplated} sample="${mask}"`,
    );
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        probe_field: field,
        was_templated: wasTemplated,
        resolved: !wasTemplated && !!value,
        resolved_masked: mask,
      }),
    );
    return;
  }

  if (req.method !== "POST" || !req.url?.startsWith("/v1/payouts")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  // Auth: same bearer the contract reads from z:<tid>:secrets/payout_api_key.
  const auth = req.headers["authorization"];
  if (auth !== `Bearer ${EXPECTED_BEARER}`) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  const raw = await readBody(req);
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid json" }));
    return;
  }

  const account: string = body?.payee?.bank_account ?? "";
  const firstName: string = body?.payee?.first_name ?? "";

  // Privacy assertion: the host must have substituted the placeholders before egress.
  const stillTemplated =
    account.includes("{{profile.") || firstName.includes("{{profile.");
  if (stillTemplated || !account) {
    console.error(
      `[mock-payout] ⚠️  UNRESOLVED PLACEHOLDER — host did not substitute PII. ` +
        `Got account="${account}" first_name="${firstName}". ` +
        `Check the beneficiary grant + profile field.`,
    );
    res.writeHead(422, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: "unresolved_placeholder",
        detail: "payout body still contained {{profile.*}} markers — PII was not resolved host-side",
      }),
    );
    return;
  }

  const payoutId = "po_" + randomUUID().replace(/-/g, "").slice(0, 16);
  const masked = maskAccount(account);

  // Server-side log proves the host delivered the REAL account here, never the contract.
  console.log(
    `[mock-payout] ✅ payout ${payoutId} for ${body.beneficiary_id}: ` +
      `${body.amount} ${body.currency} → payee "${firstName} ${body?.payee?.last_name ?? ""}" ` +
      `acct(received full, masked for echo)=${masked}`,
  );

  res.writeHead(201, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      payout_id: payoutId,
      account_masked: masked,
      status: "paid",
    }),
  );
});

server.listen(PORT, () => {
  console.log(`[mock-payout] listening on http://localhost:${PORT}  (POST /v1/payouts)`);
  console.log(`[mock-payout] expected bearer: "${EXPECTED_BEARER}"`);
});
