import { Rpc } from "@opencode/plugin/rpc";

const decisionProperties = {
  session: { type: "string" },
  agent: { type: "string" },
  model: { type: "string" },
  effort: { type: "string" },
  variant: { type: "string" },
  applied: { type: "boolean" },
  choice: { type: "string" },
  conf: { type: "number" },
  stakes: { type: "number" },
  keyword: { type: "string" },
} as const;

export const SmartReasoning = Rpc.define({
  id: "smart-reasoning",
  methods: {
    getDecision: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: decisionProperties,
        additionalProperties: false,
      },
    },
  },
  events: {
    decided: {
      schema: {
        type: "object",
        properties: {
          ...decisionProperties,
          session: { type: "string" },
        },
        required: ["session"],
        additionalProperties: false,
      },
    },
  },
});
