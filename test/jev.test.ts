import { describe, expect, test } from "bun:test";
import { askJev, JEV_ENDPOINT_DEFAULT } from "../src/jev.ts";

function stubFetch(calls: string[]) {
  (globalThis as any).fetch = async (url: unknown) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ model: "x", answers: {} }), {
      status: 200,
    });
  };
}

describe("endpoint override", () => {
  test("explicit option wins", async () => {
    const calls: string[] = [];
    stubFetch(calls);
    await askJev("hi", {
      endpoint: "https://example.com/custom",
      apiKey: "k",
    });
    expect(calls).toEqual(["https://example.com/custom"]);
  });

  test("JEV_ENDPOINT env is used when no option is given", async () => {
    const calls: string[] = [];
    stubFetch(calls);
    const prev = process.env["JEV_ENDPOINT"];
    process.env["JEV_ENDPOINT"] = "https://example.com/from-env";
    try {
      await askJev("hi", { apiKey: "k" });
    } finally {
      if (prev === undefined) delete process.env["JEV_ENDPOINT"];
      else process.env["JEV_ENDPOINT"] = prev;
    }
    expect(calls).toEqual(["https://example.com/from-env"]);
  });

  test("falls back to the Zen default", async () => {
    const calls: string[] = [];
    stubFetch(calls);
    const prev = process.env["JEV_ENDPOINT"];
    delete process.env["JEV_ENDPOINT"];
    try {
      await askJev("hi", { apiKey: "k" });
    } finally {
      if (prev !== undefined) process.env["JEV_ENDPOINT"] = prev;
    }
    expect(calls).toEqual([JEV_ENDPOINT_DEFAULT]);
  });
});
