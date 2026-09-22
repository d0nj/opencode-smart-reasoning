export const JEV_ENDPOINT_DEFAULT = "https://opencode.ai/zen/v1/systemone";
export const JEV_MODEL_DEFAULT = "jev-1.13-free";
export const JEV_MODEL_PAID = "jev-1.13";

export type EffortLevel = "minimal" | "low" | "medium" | "high" | "xhigh";

export const EFFORT_ORDER: readonly EffortLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JevNoulAnswer {
  type: "noul";
  noul: number;
}

export interface JevSystemOneResponse {
  model: string;
  answers: {
    reasoning_effort?: JevChoiceAnswer;
    high_stakes?: JevNoulAnswer;
  };
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface JevRequestOptions {
  endpoint?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function resolveApiKey(explicit?: string): string {
  const key =
    explicit?.trim() ||
    process.env["JEV_API_KEY"]?.trim() ||
    process.env["OPENCODE_API_KEY"]?.trim() ||
    "";
  if (!key) {
    throw new Error(
      "Missing Jev/Zen API key. Set OPENCODE_API_KEY (or JEV_API_KEY).",
    );
  }
  return key;
}

export function buildJevQuestions() {
  return {
    reasoning_effort: {
      type: "choice",
      instructions:
        "How much reasoning does this coding task need? Judge only the task described in the state.",
      criteria: {
        minimal:
          "Trivial lookup, greeting, formatting, or a single obvious answer with no tradeoffs.",
        low: "Simple well-defined task: single-file edit, explain code, or small fix with a clear path.",
        medium:
          "Moderate task: multi-file change, debugging with some unknowns, or choosing between a few approaches.",
        high: "Complex task: ambiguous requirements, system-wide refactor, hard bug, security or performance critical work, novel design.",
        xhigh:
          "Exceptional: mission-critical architecture, intricate distributed logic, adversarial security, or high-uncertainty research where a wrong answer is costly.",
      },
    },
    high_stakes: {
      type: "noul",
      instructions:
        "Does this task involve irreversible, production, security, auth, payments, data-loss, migration, or deployment actions where a mistake is costly?",
    },
  } as const;
}

export async function askJev(
  state: string,
  opts: JevRequestOptions = {},
): Promise<JevSystemOneResponse> {
  const endpoint =
    opts.endpoint?.trim() ||
    process.env["JEV_ENDPOINT"]?.trim() ||
    JEV_ENDPOINT_DEFAULT;
  const model =
    opts.model?.trim() ||
    process.env["JEV_MODEL"]?.trim() ||
    JEV_MODEL_DEFAULT;
  const apiKey = resolveApiKey(opts.apiKey);
  const timeoutMs = opts.timeoutMs ?? 8000;

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        state,
        questions: buildJevQuestions(),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Jev request failed (${res.status}): ${text.slice(0, 300)}`,
      );
    }
    return (await res.json()) as JevSystemOneResponse;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

export interface EffortDecision {
  effort: EffortLevel;
  bumpedForStakes: boolean;
  confidence: number;
  rawChoice: string;
  highStakes: number;
}

function clampEffort(
  effort: EffortLevel,
  max: EffortLevel,
): EffortLevel {
  return EFFORT_ORDER.indexOf(effort) <= EFFORT_ORDER.indexOf(max)
    ? effort
    : max;
}

function bumpOne(effort: EffortLevel): EffortLevel {
  const i = EFFORT_ORDER.indexOf(effort);
  return EFFORT_ORDER[Math.min(i + 1, EFFORT_ORDER.length - 1)];
}

function isEffort(value: string): value is EffortLevel {
  return (EFFORT_ORDER as readonly string[]).includes(value);
}

export function decideEffort(
  response: JevSystemOneResponse,
  opts: {
    defaultEffort?: EffortLevel;
    maxEffort?: EffortLevel;
    minConfidence?: number;
    stakesThreshold?: number;
  } = {},
): EffortDecision {
  const defaultEffort = opts.defaultEffort ?? "medium";
  const maxEffort = opts.maxEffort ?? "xhigh";
  const minConfidence = opts.minConfidence ?? 0.35;
  const stakesThreshold = opts.stakesThreshold ?? 0.7;

  const choice = response.answers.reasoning_effort;
  const stakes = response.answers.high_stakes?.noul ?? 0;

  if (!choice || !isEffort(choice.choice)) {
    return {
      effort: clampEffort(defaultEffort, maxEffort),
      bumpedForStakes: false,
      confidence: choice?.confidence ?? 0,
      rawChoice: choice?.choice ?? "unknown",
      highStakes: stakes,
    };
  }

  let effort =
    choice.confidence < minConfidence ? defaultEffort : choice.choice;
  let bumped = false;
  if (stakes >= stakesThreshold && effort !== "xhigh") {
    effort = bumpOne(effort);
    bumped = true;
  }
  return {
    effort: clampEffort(effort, maxEffort),
    bumpedForStakes: bumped,
    confidence: choice.confidence,
    rawChoice: choice.choice,
    highStakes: stakes,
  };
}
