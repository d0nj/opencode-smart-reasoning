import { describe, expect, test } from "bun:test";
import plugin from "../src/index.ts";

const cannedJev = {
  model: "jev-1.13-free",
  answers: {
    reasoning_effort: {
      type: "choice",
      choice: "high",
      probabilities: { high: 0.9 },
      confidence: 0.9,
    },
    high_stakes: { type: "noul", noul: 0.1 },
  },
};

function fakeCtx(sessionModel: unknown = {}) {
  const hooks: Record<string, (event: any) => Promise<void> | void> = {};
  return {
    hooks,
    ctx: {
      options: { apiKey: "test-key" },
      session: {
        hook: async (name: string, cb: (event: any) => unknown) => {
          hooks[name] = cb as (event: any) => Promise<void>;
        },
        get: async () => ({ model: sessionModel }),
      },
      model: {
        list: async () => ({
          data: [
            {
              providerID: "opencode",
              modelID: "gpt-5.5",
              variants: [
                { id: "low", settings: { reasoningEffort: "low" } },
                { id: "medium", settings: { reasoningEffort: "medium" } },
                { id: "high", settings: { reasoningEffort: "high" } },
              ],
            },
            {
              providerID: "anthropic",
              modelID: "claude-sonnet-4-5",
              variants: [
                {
                  id: "high",
                  settings: {
                    thinking: { type: "enabled", budgetTokens: 24000 },
                  },
                },
                {
                  id: "max",
                  settings: {
                    thinking: { type: "enabled", budgetTokens: 32000 },
                  },
                },
              ],
            },
          ],
        }),
      },
    } as any,
  };
}

describe("explicit variant", () => {
  test("context hook applies Jev effort when no variant is pinned", async () => {
    let calls = 0;
    (globalThis as any).fetch = async () => {
      calls++;
      return new Response(JSON.stringify(cannedJev), { status: 200 });
    };
    const { hooks, ctx } = fakeCtx();
    await (plugin as any).setup(ctx);
    await hooks["prompt"]({ sessionID: "s1", prompt: { text: "fix the bug" } });
    expect(calls).toBe(1);

    const event: any = {
      sessionID: "s1",
      agent: "build",
      model: { providerID: "opencode", id: "gpt-5.5" },
      messages: [],
      options: {},
    };
    await hooks["context"](event);
    expect(event.options.reasoningEffort).toBe("high");
  });

  test("context hook never overrides an explicit variant", async () => {
    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify(cannedJev), { status: 200 });
    const { hooks, ctx } = fakeCtx();
    await (plugin as any).setup(ctx);
    await hooks["prompt"]({ sessionID: "s1", prompt: { text: "fix the bug" } });

    const event: any = {
      sessionID: "s1",
      agent: "build",
      model: { providerID: "opencode", id: "gpt-5.5", variant: "low" },
      messages: [],
      options: {},
    };
    await hooks["context"](event);
    expect(event.options.reasoningEffort).toBeUndefined();
    expect(event.options.thinking).toBeUndefined();
  });

  test("prompt hook skips the Jev call when the session pins a variant", async () => {
    let calls = 0;
    (globalThis as any).fetch = async () => {
      calls++;
      return new Response(JSON.stringify(cannedJev), { status: 200 });
    };
    const { hooks, ctx } = fakeCtx({ variant: "low" });
    await (plugin as any).setup(ctx);
    await hooks["prompt"]({ sessionID: "s2", prompt: { text: "fix the bug" } });
    expect(calls).toBe(0);
  });

  test("respectExplicitVariant:false lets Jev override", async () => {    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify(cannedJev), { status: 200 });
    const { hooks, ctx } = fakeCtx();
    (ctx as any).options.respectExplicitVariant = false;
    await (plugin as any).setup(ctx);
    await hooks["prompt"]({ sessionID: "s1", prompt: { text: "fix the bug" } });

    const event: any = {
      sessionID: "s1",
      agent: "build",
      model: { providerID: "opencode", id: "gpt-5.5", variant: "low" },
      messages: [],
      options: {},
    };
    await hooks["context"](event);
    expect(event.options.reasoningEffort).toBe("high");
  });

  test("clamps Jev effort to the request model's own vocabulary", async () => {
    (globalThis as any).fetch = async () =>
      new Response(
        JSON.stringify({
          model: "jev-1.13-free",
          answers: {
            reasoning_effort: {
              type: "choice",
              choice: "low",
              probabilities: { low: 0.9 },
              confidence: 0.9,
            },
            high_stakes: { type: "noul", noul: 0.1 },
          },
        }),
        { status: 200 },
      );
    const { hooks, ctx } = fakeCtx();
    await (plugin as any).setup(ctx);
    await hooks["prompt"]({ sessionID: "s3", prompt: { text: "fix the bug" } });

    const event: any = {
      sessionID: "s3",
      agent: "build",
      model: { providerID: "anthropic", id: "claude-sonnet-4-5" },
      messages: [],
      options: {},
    };
    await hooks["context"](event);
    expect(event.options.reasoningEffort).toBeUndefined();
    expect(event.options.thinking).toEqual({
      type: "enabled",
      budgetTokens: 24000,
    });
  });

  test("leaves options untouched when the model has no catalog data", async () => {    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify(cannedJev), { status: 200 });
    const { hooks, ctx } = fakeCtx();
    await (plugin as any).setup(ctx);
    await hooks["prompt"]({ sessionID: "s4", prompt: { text: "fix the bug" } });

    const event: any = {
      sessionID: "s4",
      agent: "build",
      model: { providerID: "opencode", id: "big-pickle" },
      messages: [],
      options: {},
    };
    await hooks["context"](event);
    expect(event.options).toEqual({});
  });

  test("magic keyword skips Jev and pins maximum", async () => {
    let calls = 0;
    (globalThis as any).fetch = async () => {
      calls++;
      return new Response(JSON.stringify(cannedJev), { status: 200 });
    };
    const { hooks, ctx } = fakeCtx();
    await (plugin as any).setup(ctx);
    await hooks["prompt"]({
      sessionID: "s5",
      prompt: { text: "ultrathink this refactor" },
    });
    expect(calls).toBe(0);

    const event: any = {
      sessionID: "s5",
      agent: "build",
      model: { providerID: "anthropic", id: "claude-sonnet-4-5" },
      messages: [],
      options: {},
    };
    await hooks["context"](event);
    expect(event.options.thinking).toEqual({
      type: "enabled",
      budgetTokens: 32000,
    });
  });
});
