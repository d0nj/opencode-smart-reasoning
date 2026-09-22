import { describe, expect, test } from "bun:test";
import plugin from "../src/index.ts";
import { SmartReasoning } from "../src/rpc.ts";

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

function fakeCtx() {
  const hooks: Record<string, (event: any) => Promise<void> | void> = {};
  const emitted: { name: string; data: unknown }[] = [];
  let handlers: Record<string, (input: any) => Promise<unknown>> = {};
  return {
    hooks,
    emitted,
    handlers: () => handlers,
    ctx: {
      options: { apiKey: "test-key" },
      session: {
        hook: async (name: string, cb: (event: any) => unknown) => {
          hooks[name] = cb as (event: any) => Promise<void>;
        },
        get: async () => ({}),
      },
      model: {
        list: async () => ({
          data: [
            {
              providerID: "opencode",
              modelID: "gpt-5.5",
              variants: [{ id: "high", settings: { reasoningEffort: "high" } }],
            },
          ],
        }),
      },
      rpc: {
        register: async (_def: unknown, impl: typeof handlers) => {
          handlers = impl;
          return {
            events: {
              emit: async (name: string, data: unknown) => {
                emitted.push({ name, data });
              },
            },
            dispose: async () => {},
          };
        },
      },
    } as any,
  };
}

describe("rpc", () => {
  test("registers the SmartReasoning definition", async () => {
    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify(cannedJev), { status: 200 });
    const { ctx } = fakeCtx();
    let seen: unknown;
    (ctx as any).rpc.register = async (def: unknown, impl: any) => {
      seen = def;
      return {
        events: { emit: async () => {} },
        dispose: async () => {},
      };
    };
    await (plugin as any).setup(ctx);
    expect((seen as typeof SmartReasoning).id).toBe(SmartReasoning.id);
  });

  test("emits decided and answers getDecision", async () => {
    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify(cannedJev), { status: 200 });
    const { hooks, emitted, handlers, ctx } = fakeCtx();
    await (plugin as any).setup(ctx);
    await hooks["prompt"]({ sessionID: "s1", prompt: { text: "fix the bug" } });
    await hooks["context"]({
      sessionID: "s1",
      agent: "build",
      model: { providerID: "opencode", id: "gpt-5.5" },
      messages: [],
      options: {},
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].name).toBe("decided");
    expect(emitted[0].data).toMatchObject({
      session: "s1",
      effort: "high",
      variant: "high",
    });
    expect(await handlers()["getDecision"]({ sessionID: "s1" })).toMatchObject(
      {
        effort: "high",
      },
    );
    expect(await handlers()["getDecision"]({ sessionID: "nope" })).toEqual({});
  });
});
