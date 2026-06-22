/**
 * Generate a static, double-clickable audit-viewer.html with the REAL audit-log.jsonl rows
 * embedded directly in the page's <script> (no server, no fetch, no CORS).
 *
 *   yarn audit-viewer
 *
 * Reads the hash-chained ledger written by src/lib/audit.ts and maps its emitted fields
 * (seq, prev_hash, kind, beneficiary_id, ts, detail, hash) into exactly the shape the HTML
 * expects — { kind, beneficiary_id, detail, hash, ts } — without touching the design. The
 * ROWS array is replaced in place, so re-running after more live activity is idempotent.
 *
 * `--dedupe` (or AIDLINK_DEDUPE=1): a DISPLAY-ONLY collapse of consecutive rows that are
 * identical in kind + beneficiary_id + detail (keeps the first, drops exact repeats). This
 * only affects what the HTML renders — `audit-log.jsonl` is never modified; the underlying
 * hash-chained ledger stays exactly as recorded. `yarn audit-viewer` passes `--dedupe`.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOG = process.env.AIDLINK_AUDIT_LOG ?? resolve(APP_DIR, "audit-log.jsonl");
const HTML = resolve(APP_DIR, "audit-viewer.html");

/** As emitted by src/lib/audit.ts (AuditRow). */
interface RealRow {
  kind: string;
  beneficiary_id: string;
  ts: number;
  detail?: Record<string, unknown>;
  hash: string;
}

/** Exactly the shape the HTML's ROWS array consumes. */
interface ViewRow {
  kind: string;
  beneficiary_id: string;
  detail: Record<string, unknown>;
  hash: string;
  ts: number;
}

function main() {
  if (!existsSync(LOG)) {
    console.error(`[audit-viewer] no audit log at ${LOG} — run a live phase (provision/phase2-*) first.`);
    process.exit(1);
  }
  if (!existsSync(HTML)) {
    console.error(`[audit-viewer] template not found at ${HTML} (expected the uploaded viewer).`);
    process.exit(1);
  }

  const allRows: ViewRow[] = readFileSync(LOG, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const r = JSON.parse(line) as RealRow;
      return {
        kind: r.kind,
        beneficiary_id: r.beneficiary_id,
        detail: r.detail ?? {},
        // Full SHA-256 → 12-char prefix to match the design's hash-chip (still a verifiable
        // prefix of the real chain hash).
        hash: typeof r.hash === "string" ? r.hash.slice(0, 12) : String(r.hash),
        ts: r.ts, // epoch ms — new Date(ts) in the page renders it directly
      };
    });

  // Display-only de-dupe: collapse CONSECUTIVE rows identical in kind + beneficiary_id +
  // detail. Never touches audit-log.jsonl — the on-disk ledger keeps every recorded row.
  const dedupe = process.argv.includes("--dedupe") || process.env.AIDLINK_DEDUPE === "1";
  const sig = (r: ViewRow) => `${r.kind}|${r.beneficiary_id}|${JSON.stringify(r.detail)}`;
  const rows = dedupe
    ? allRows.filter((r, i) => i === 0 || sig(r) !== sig(allRows[i - 1]))
    : allRows;
  if (dedupe && rows.length !== allRows.length) {
    console.log(`[audit-viewer] de-dupe: ${allRows.length} recorded rows → ${rows.length} displayed (display-only; ledger unchanged)`);
  }

  const template = readFileSync(HTML, "utf8");
  const arrayLiteral = `const ROWS = ${JSON.stringify(rows, null, 2)};`;
  // Function replacement avoids `$`-token interpretation in the JSON payload.
  const out = template.replace(/const ROWS = \[[\s\S]*?\];/, () => arrayLiteral);
  if (out === template) {
    console.error("[audit-viewer] could not locate the `const ROWS = [...]` array to replace.");
    process.exit(1);
  }

  writeFileSync(HTML, out);
  console.log(`[audit-viewer] embedded ${rows.length} real rows from ${LOG}`);
  console.log(`[audit-viewer] wrote ${HTML} — double-click to open (no server needed).`);
  for (const r of rows) {
    console.log(`  • ${r.kind.padEnd(19)} ${r.beneficiary_id.padEnd(10)} ${JSON.stringify(r.detail).slice(0, 72)}`);
  }
}

main();
