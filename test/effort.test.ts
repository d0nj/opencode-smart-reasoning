import { describe, expect, test } from "bun:test";
import {
  applyEffort,
  buildCatalog,
  buildPromptState,
  buildState,
  findMaxKeyword,
  hashPrompt,
  matchTemplate,
  resolveVariant,
  substituteEffort,
} from "../src/effort.ts";
import { decideEffort, type JevSystemOneResponse } from "../src/jev.ts";

function choiceResponse(
  choice: string,
  confidence: number,
  stakes: number,
): JevSystemOneResponse {
  return {
    model: "jev-1.13-free",
    answers: {
      reasoning_effort: {
        type: "choice",
        choice,
        probabilities: { [choice]: 0.9 },
        confidence,
      },
      high_stakes: { type: "noul", noul: stakes },
    },
  };
}

describe("decideEffort", () => {
  test("passes through a confident choice", () => {
    const d = decideEffort(choiceResponse("low", 0.9, 0.1));
    expect(d.effort).toBe("low");
    expect(d.bumpedForStakes).toBe(false);
  });

  test("bumps one level on high stakes", () => {
    const d = decideEffort(choiceResponse("medium", 0.9, 0.85));
    expect(d.effort).toBe("high");
    expect(d.bumpedForStakes).toBe(true);
  });

  test("falls back on low confidence", () => {
    const d = decideEffort(choiceResponse("xhigh", 0.1, 0.0), {
      defaultEffort: "medium",
    });
    expect(d.effort).toBe("medium");
  });

  test("clamps to maxEffort", () => {
    const d = decideEffort(choiceResponse("xhigh", 0.9, 0.0), {
      maxEffort: "medium",
    });
    expect(d.effort).toBe("medium");
  });
});

describe("resolveVariant", () => {
  const ids = (ids: string[]) => ids.map((id) => ({ id }));

  test("passes through when supported", () => {
    expect(
      resolveVariant(
        "high",
        ids(["minimal", "low", "medium", "high", "xhigh"]),
      ),
    ).toBe("high");
  });

  test("clamps Anthropic [high, max] upward", () => {
    expect(resolveVariant("low", ids(["high", "max"]))).toBe("high");
    expect(resolveVariant("medium", ids(["high", "max"]))).toBe("high");
    expect(resolveVariant("xhigh", ids(["high", "max"]))).toBe("max");
  });

  test("clamps Google [low, high], ties break upward", () => {
    expect(resolveVariant("minimal", ids(["low", "high"]))).toBe("low");
    expect(resolveVariant("medium", ids(["low", "high"]))).toBe("high");
  });

  test("places custom ids via their settings", () => {
    const variants = [
      { id: "fast", settings: { reasoningEffort: "low" } },
      { id: "high", settings: { reasoningEffort: "high" } },
      { id: "max", settings: { reasoningEffort: "max" } },
    ];
    expect(resolveVariant("minimal", variants)).toBe("fast");
    expect(resolveVariant("medium", variants)).toBe("high");
    expect(resolveVariant("xhigh", variants)).toBe("max");
  });

  test("returns undefined without placeable variants", () => {
    expect(resolveVariant("high", [])).toBeUndefined();
    expect(resolveVariant("high", ids(["thinking", "fast"]))).toBeUndefined();
  });

  test("buildCatalog keys by provider/model, case-insensitive", () => {
    const catalog = buildCatalog([
      {
        providerID: "Anthropic",
        modelID: "Claude-Sonnet-4-5",
        variants: [{ id: "high" }, { id: "max" }],
      },
    ]);
    expect(catalog.get("anthropic/claude-sonnet-4-5")?.variants).toHaveLength(
      2,
    );
  });
});

describe("applyEffort", () => {
  const catalog = (variants: { id: string; settings?: Record<string, unknown> }[]) =>
    buildCatalog([
      { providerID: "opencode", modelID: "gpt-5.5", variants },
    ]).get("opencode/gpt-5.5")!;

  test("spreads the resolved variant's own settings", () => {
    const options: Record<string, unknown> = {};
    const entry = catalog([
      {
        id: "low",
        settings: { reasoningEffort: "low", textVerbosity: "low" },
      },
      { id: "high", settings: { reasoningEffort: "high" } },
    ]);
    const applied = applyEffort(options, "opencode", "gpt-5.5", "minimal", entry);
    expect(applied).toEqual({ variantId: "low", applied: true });
    expect(options["reasoningEffort"]).toBe("low");
    expect(options["textVerbosity"]).toBe("low");
  });

  test("unknown model leaves options untouched", () => {
    const options: Record<string, unknown> = {};
    const applied = applyEffort(options, "opencode", "mystery", "medium");
    expect(applied).toEqual({ variantId: undefined, applied: false });
    expect(options).toEqual({});
  });

  test("variant without settings resolves the id but changes nothing", () => {
    const options: Record<string, unknown> = {};
    const entry = catalog([{ id: "high" }, { id: "max" }]);
    const applied = applyEffort(options, "opencode", "mystery-2", "low", entry);
    expect(applied).toEqual({ variantId: "high", applied: false });
    expect(options).toEqual({});
  });

  test("custom-only vocabulary is unresolvable", () => {
    const options: Record<string, unknown> = {};
    const entry = catalog([{ id: "thinking" }, { id: "fast" }]);
    const applied = applyEffort(options, "opencode", "mystery-3", "high", entry);
    expect(applied).toEqual({ variantId: undefined, applied: false });
    expect(options).toEqual({});
  });

  test("optionTemplates apply with {effort} substitution", () => {
    const options: Record<string, unknown> = {};
    const applied = applyEffort(
      options,
      "deepseek",
      "deepseek-v4",
      "high",
      undefined,
      {
        "deepseek/*": { reasoningEffort: "{effort}", extra: ["{effort}"] },
      },
    );
    expect(applied).toEqual({ variantId: undefined, applied: true });
    expect(options["reasoningEffort"]).toBe("high");
    expect(options["extra"]).toEqual(["high"]);
  });

  test("template specificity: exact > provider/* > */model > *", () => {
    const templates = {
      "*": { from: "star" },
      "acme/*": { from: "provider" },
      "*/widget": { from: "model" },
      "acme/widget": { from: "exact" },
    };
    expect(matchTemplate(templates, "acme", "widget")).toEqual({ from: "exact" });
    expect(matchTemplate(templates, "acme", "other")).toEqual({ from: "provider" });
    expect(matchTemplate(templates, "other", "widget")).toEqual({ from: "model" });
    expect(matchTemplate(templates, "other", "other")).toEqual({ from: "star" });
    expect(matchTemplate(undefined, "a", "b")).toBeUndefined();
    expect(matchTemplate({}, "a", "b")).toBeUndefined();
  });

  test("substituteEffort replaces {effort} deeply", () => {
    expect(
      substituteEffort({ a: "{effort}", b: [{ c: "x-{effort}" }], d: 1 }, "low"),
    ).toEqual({ a: "low", b: [{ c: "x-low" }], d: 1 });
  });
});

describe("findMaxKeyword", () => {
  test("matches case-insensitively", () => {
    expect(findMaxKeyword("please ULTRATHINK this")).toBe("ultrathink");
  });

  test("requires word boundaries", () => {
    expect(findMaxKeyword("ultrathink!")).toBe("ultrathink");
    expect(findMaxKeyword("ultrathinking hard")).toBeUndefined();
  });

  test("custom list and empty disables", () => {
    expect(findMaxKeyword("go maxmode", ["maxmode"])).toBe("maxmode");
    expect(findMaxKeyword("ultrathink this", [])).toBeUndefined();
    expect(findMaxKeyword("ultrathink this", ["  "])).toBeUndefined();
  });

  test("escapes regex characters", () => {
    expect(findMaxKeyword("use max+ mode", ["max+"])).toBe("max+");
  });
});

describe("buildPromptState", () => {
  test("prefixes task and truncates to tail", () => {
    const state = buildPromptState("abcdefghij", 4);
    expect(state).toBe("task: ghij");
  });
});

describe("buildState", () => {
  test("uses last user message", () => {
    const state = buildState(
      [
        { role: "user", content: "first" },
        { role: "assistant", content: "ok" },
        { role: "user", content: [{ type: "text", text: "second" }] },
      ],
      "build",
      "opencode/gpt-5.5",
    );
    expect(state).toContain("agent=build");
    expect(state).toContain("second");
    expect(state).not.toContain("first");
  });

  test("hash is stable", () => {
    expect(hashPrompt("abc")).toBe(hashPrompt("abc"));
  });
});
