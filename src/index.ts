import { Plugin } from "@opencode/plugin";
import { appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyEffort,
  buildCatalog,
  buildPromptState,
  buildState,
  catalogKey,
  DEFAULT_MAX_KEYWORDS,
  findMaxKeyword,
  hashPrompt,
  type CatalogEntry,
  type CatalogModel,
} from "./effort.js";
import {
  askJev,
  decideEffort,
  type EffortLevel,
} from "./jev.js";

export interface JevReasoningOptions {
  model?: string;
  endpoint?: string;
  apiKey?: string;
  defaultEffort?: EffortLevel;
  maxEffort?: EffortLevel;
  minConfidence?: number;
  stakesThreshold?: number;
  timeoutMs?: number;
  includeAgents?: string[];
  excludeAgents?: string[];
  maxStateChars?: number;
  debug?: boolean;
  optionTemplates?: Record<string, Record<string, unknown>>;
  respectExplicitVariant?: boolean;
  maxKeywords?: string[];
}

const DEFAULT_EXCLUDE = ["title", "summary", "compaction"];

const LOG_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "smart-reasoning.log",
);

function debugLog(opts: { debug?: boolean }, msg: string): void {
  if (!opts.debug) return;
  console.error(msg);
  appendFile(LOG_FILE, `${new Date().toISOString()} ${msg}\n`).catch(() => {});
}

interface StashedDecision {
  promptHash: string;
  effort: EffortLevel;
}

async function sessionVariant(
  ctx: { session: { get: (input: { sessionID: string }) => Promise<unknown> } },
  sessionID: string,
): Promise<string | undefined> {
  try {
    const session = (await ctx.session.get({ sessionID })) as {
      model?: { variant?: string | null } | null;
    };
    return session?.model?.variant ?? undefined;
  } catch {
    return undefined;
  }
}

export default {
  ...Plugin.define({
    id: "smart-reasoning",
    async setup(ctx) {
      const opts = (ctx.options ?? {}) as JevReasoningOptions;
      const exclude = new Set(
        (opts.excludeAgents ?? DEFAULT_EXCLUDE).map((a) => a.toLowerCase()),
      );
      const include = opts.includeAgents
        ? new Set(opts.includeAgents.map((a) => a.toLowerCase()))
        : null;
      const maxChars = opts.maxStateChars ?? 4000;
      const respectVariant = opts.respectExplicitVariant !== false;
      const maxKeywords = opts.maxKeywords ?? DEFAULT_MAX_KEYWORDS;

      let catalog = new Map<string, CatalogEntry>();
      const refreshCatalog = async () => {
        try {
          const out = (await ctx.model.list()) as unknown;
          const models = (
            Array.isArray(out) ? out : ((out as { data?: unknown }).data ?? [])
          ) as CatalogModel[];
          catalog = buildCatalog(models);
        } catch {
        }
      };
      await refreshCatalog();
      let lastRefresh = Date.now();
      const maybeRefresh = () => {
        if (Date.now() - lastRefresh < 5 * 60 * 1000) return;
        lastRefresh = Date.now();
        void refreshCatalog();
      };
      const stashed = new Map<string, StashedDecision>();

      const jevOpts = () => ({
        endpoint: opts.endpoint,
        model: opts.model,
        apiKey: opts.apiKey,
        timeoutMs: opts.timeoutMs ?? 8000,
      });
      const decideOpts = () => ({
        defaultEffort: opts.defaultEffort ?? "medium",
        maxEffort: opts.maxEffort ?? "xhigh",
        minConfidence: opts.minConfidence ?? 0.35,
        stakesThreshold: opts.stakesThreshold ?? 0.7,
      });
      const remember = (sessionID: string, value: StashedDecision) => {
        if (stashed.size > 500) {
          const oldest = stashed.keys().next();
          if (!oldest.done) stashed.delete(oldest.value);
        }
        stashed.set(sessionID, value);
      };

      await ctx.session.hook("prompt", async (event) => {
        try {
          const text = (event.prompt.text ?? "").trim();
          if (!text) return;
          if (respectVariant && (await sessionVariant(ctx, event.sessionID))) {
            stashed.delete(event.sessionID);
            return;
          }
          const promptHash = hashPrompt(
            `${event.sessionID}:${text.slice(-maxChars)}`,
          );
          if (stashed.get(event.sessionID)?.promptHash === promptHash) return;

          const maxKeyword = findMaxKeyword(text, maxKeywords);
          if (maxKeyword) {
            remember(event.sessionID, { promptHash, effort: "xhigh" });
            debugLog(
              opts,
              `[smart-reasoning] prompt session=${event.sessionID} ` +
                `effort=xhigh (keyword=${maxKeyword})`,
            );
            return;
          }

          const response = await askJev(
            buildPromptState(text, maxChars),
            jevOpts(),
          );
          const decision = decideEffort(response, decideOpts());
          remember(event.sessionID, {
            promptHash,
            effort: decision.effort,
          });

          debugLog(
            opts,
            `[smart-reasoning] prompt session=${event.sessionID} ` +
              `effort=${decision.effort} (choice=${decision.rawChoice} ` +
              `conf=${decision.confidence.toFixed(2)} stakes=${decision.highStakes.toFixed(2)}` +
              `${decision.bumpedForStakes ? " bumped" : ""})`,
          );
        } catch (err) {
          debugLog(
            opts,
            `[smart-reasoning] prompt skipped: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });

      const applyDecision = (
        event: {
          agent: string;
          model: { providerID: string; id: string; variant?: string };
          options: Record<string, unknown>;
        },
        effort: EffortLevel,
      ) => {
        const key = catalogKey(event.model.providerID, event.model.id);
        const entry = catalog.get(key);
        if (!entry) void maybeRefresh();
        const applied = applyEffort(
          event.options,
          event.model.providerID,
          event.model.id,
          effort,
          entry,
          opts.optionTemplates,
        );
        debugLog(
          opts,
          `[smart-reasoning] apply agent=${event.agent} ` +
            `model=${event.model.providerID}/${event.model.id} ` +
            `effort=${effort}` +
            (applied.variantId ? ` variant=${applied.variantId}` : "") +
            (applied.applied ? "" : " (no catalog data, defaults kept)"),
        );
      };

      await ctx.session.hook("context", async (event) => {
        try {
          const agent = event.agent.toLowerCase();
          if (exclude.has(agent)) return;
          if (include && !include.has(agent)) return;
          if (respectVariant && event.model.variant) return;

          const hit = stashed.get(event.sessionID);
          if (hit) {
            applyDecision(
              {
                agent: event.agent,
                model: event.model,
                options: event.options as Record<string, unknown>,
              },
              hit.effort,
            );
            return;
          }

          const state = buildState(
            event.messages,
            event.agent,
            `${event.model.providerID}/${event.model.id}`,
            maxChars,
          );
          if (!state.trim()) return;
          if (findMaxKeyword(state, maxKeywords)) {
            remember(event.sessionID, {
              promptHash: hashPrompt(`${event.sessionID}:${state}`),
              effort: "xhigh",
            });
            applyDecision(
              {
                agent: event.agent,
                model: event.model,
                options: event.options as Record<string, unknown>,
              },
              "xhigh",
            );
            return;
          }
          const response = await askJev(state, jevOpts());
          const decision = decideEffort(response, decideOpts());
          remember(event.sessionID, {
            promptHash: hashPrompt(`${event.sessionID}:${state}`),
            effort: decision.effort,
          });
          applyDecision(
            {
              agent: event.agent,
              model: event.model,
              options: event.options as Record<string, unknown>,
            },
            decision.effort,
          );
        } catch (err) {
          debugLog(
            opts,
            `[smart-reasoning] context skipped: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
    },
  }),

  async server() {
    return {};
  },
};
