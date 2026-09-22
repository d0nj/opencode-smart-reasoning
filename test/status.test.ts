import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendDecision,
  defaultStatusPath,
  lastDecisionFor,
  readDecisions,
} from "../src/status.ts";

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "sr-status-"));
  return {
    path: join(dir, "decisions.jsonl"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("status", () => {
  test("round-trips decisions and returns the latest per session", () => {
    const { path, cleanup } = sandbox();
    try {
      appendDecision(path, {
        t: "1",
        session: "a",
        agent: "build",
        model: "m",
        effort: "low",
        applied: true,
      });
      appendDecision(path, {
        t: "2",
        session: "b",
        agent: "build",
        model: "m",
        effort: "high",
        variant: "high",
        applied: true,
      });
      appendDecision(path, {
        t: "3",
        session: "a",
        agent: "build",
        model: "m",
        effort: "xhigh",
        applied: false,
      });
      expect(readDecisions(path)).toHaveLength(3);
      expect(lastDecisionFor(path, "a")?.effort).toBe("xhigh");
      expect(lastDecisionFor(path, "b")?.variant).toBe("high");
      expect(lastDecisionFor(path, "zzz")).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  test("skips malformed lines and missing files", () => {
    const { path, cleanup } = sandbox();
    try {
      appendDecision(path, {
        t: "1",
        session: "a",
        agent: "build",
        model: "m",
        effort: "low",
        applied: true,
      });
      appendFileSync(path, "not json\n");
      expect(readDecisions(path)).toHaveLength(1);
      expect(readDecisions(path + ".missing")).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("default path lives under the data dir", () => {
    expect(defaultStatusPath()).toMatch(/smart-reasoning\.jsonl$/);
  });
});
