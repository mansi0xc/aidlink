/**
 * AidLink audit ledger — an append-only, hash-chained log of every relief action
 * (eligibility check, payout, delegation grant, revoke). Each row carries the SHA-256 of
 * the previous row, so any tampering breaks the chain and `verify()` catches it. Bank
 * account numbers only ever appear masked (the masking happens at the payout endpoint;
 * the contract never holds the plaintext).
 *
 * File-backed JSONL by default (audit-log.jsonl) so the ledger survives across the
 * separate agent processes in a demo; pass a different path or use in-memory for tests.
 */
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

export type AuditKind =
  | "eligibility-check"
  | "payout"
  | "delegation-grant"
  | "delegation-revoke"
  | "delegation-denied";

export interface AuditEvent {
  kind: AuditKind;
  beneficiary_id: string;
  ts: number;
  /** Structured, PII-free detail (account numbers only ever masked). */
  detail?: Record<string, unknown>;
  actor?: string;
}

export interface AuditRow extends AuditEvent {
  seq: number;
  prev_hash: string;
  hash: string;
}

const GENESIS = "0".repeat(64);

function hashRow(row: Omit<AuditRow, "hash">): string {
  const h = createHash("sha256");
  h.update(JSON.stringify({ seq: row.seq, prev_hash: row.prev_hash, kind: row.kind, beneficiary_id: row.beneficiary_id, ts: row.ts, detail: row.detail ?? null, actor: row.actor ?? null }));
  return h.digest("hex");
}

export class AuditLedger {
  private rows: AuditRow[] = [];
  constructor(private readonly path?: string) {
    if (path && existsSync(path)) {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        if (line.trim()) this.rows.push(JSON.parse(line));
      }
    }
  }

  append(e: Omit<AuditEvent, "ts"> & { ts?: number }): AuditRow {
    const prev = this.rows[this.rows.length - 1];
    const base: Omit<AuditRow, "hash"> = {
      seq: this.rows.length,
      prev_hash: prev ? prev.hash : GENESIS,
      kind: e.kind,
      beneficiary_id: e.beneficiary_id,
      ts: e.ts ?? Date.now(),
      detail: e.detail,
      actor: e.actor,
    };
    const row: AuditRow = { ...base, hash: hashRow(base) };
    this.rows.push(row);
    if (this.path) appendFileSync(this.path, JSON.stringify(row) + "\n");
    return row;
  }

  all(): readonly AuditRow[] {
    return this.rows;
  }

  /** Re-derive every hash and confirm the chain is intact. */
  verify(): { ok: boolean; brokenAt?: number } {
    let prev = GENESIS;
    for (const row of this.rows) {
      const { hash, ...rest } = row;
      if (rest.prev_hash !== prev || hashRow(rest) !== hash) return { ok: false, brokenAt: row.seq };
      prev = hash;
    }
    return { ok: true };
  }

  /** Render a plain table for the read-only audit view. */
  render(): string {
    const head = "seq  ts                        kind                beneficiary    detail";
    const lines = this.rows.map((r) => {
      const ts = new Date(r.ts).toISOString();
      return [
        String(r.seq).padEnd(4),
        ts.padEnd(25),
        r.kind.padEnd(19),
        r.beneficiary_id.padEnd(14),
        JSON.stringify(r.detail ?? {}),
      ].join(" ");
    });
    const v = this.verify();
    const footer = v.ok ? `\n✓ chain intact (${this.rows.length} rows)` : `\n✗ chain BROKEN at seq ${v.brokenAt}`;
    return [head, ...lines].join("\n") + footer;
  }
}
