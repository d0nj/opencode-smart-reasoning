import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export interface DecisionRecord {
  t: string;
  session: string;
  agent: string;
  model: string;
  effort: string;
  variant?: string;
  applied: boolean;
  choice?: string;
  conf?: number;
  stakes?: number;
  keyword?: string;
}

export function defaultStatusPath(): string {
  const base =
    process.env["XDG_DATA_HOME"] && process.env["XDG_DATA_HOME"].trim()
      ? process.env["XDG_DATA_HOME"]
      : join(homedir(), ".local", "share");
  return join(base, "opencode", "smart-reasoning.jsonl");
}

export function appendDecision(path: string, record: DecisionRecord): void {
  try {
    appendFileSync(path, JSON.stringify(record) + "\n");
  } catch {
    return;
  }
}

export function readDecisions(path: string, limit = 50): DecisionRecord[] {
  try {
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, "utf8").split("\n");
    const out: DecisionRecord[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        out.unshift(JSON.parse(line) as DecisionRecord);
      } catch {
        continue;
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function lastDecisionFor(
  path: string,
  sessionID: string,
): DecisionRecord | undefined {
  const records = readDecisions(path, 200);
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].session === sessionID) return records[i];
  }
  return undefined;
}

export function tmpStatusPath(suffix: string): string {
  return join(tmpdir(), `smart-reasoning-${suffix}.jsonl`);
}
