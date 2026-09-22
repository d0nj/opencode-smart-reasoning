
import type { EffortLevel } from "./jev.js";

const SCALE = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ScaleEntry = (typeof SCALE)[number];

function scaleIndex(value: string): number {
  return SCALE.indexOf(value.toLowerCase() as ScaleEntry);
}

function scalePosition(variant: CatalogVariant): number {
  const byId = scaleIndex(variant.id);
  if (byId >= 0) return byId;
  const settings = variant.settings ?? {};
  for (const key of ["reasoningEffort", "thinkingLevel"]) {
    const value = settings[key];
    if (typeof value === "string" && scaleIndex(value) >= 0) {
      return scaleIndex(value);
    }
  }
  return -1;
}

export interface CatalogVariant {
  id: string;
  settings?: Record<string, unknown>;
}

export interface CatalogEntry {
  providerID: string;
  modelID: string;
  variants: CatalogVariant[];
}

export interface CatalogModel {
  providerID: string;
  modelID?: string;
  id?: string;
  variants?: { id: string; settings?: Record<string, unknown> }[];
}

export function catalogKey(providerID: string, modelID: string): string {
  return `${providerID.toLowerCase()}/${modelID.toLowerCase()}`;
}

export function buildCatalog(models: CatalogModel[]): Map<string, CatalogEntry> {
  const catalog = new Map<string, CatalogEntry>();
  for (const m of models) {
    const modelID = (m.modelID ?? m.id ?? "").trim();
    if (!m.providerID || !modelID) continue;
    catalog.set(catalogKey(m.providerID, modelID), {
      providerID: m.providerID,
      modelID,
      variants: (m.variants ?? []).filter((v) => v?.id),
    });
  }
  return catalog;
}

export function resolveVariant(
  desired: EffortLevel,
  variants: readonly CatalogVariant[],
): string | undefined {
  const known = variants
    .map((v) => ({ id: v.id, at: scalePosition(v) }))
    .filter((v) => v.at >= 0);
  if (known.length === 0) return undefined;
  const want = scaleIndex(desired);
  let best = known[0];
  let bestDist = Math.abs(best.at - want);
  for (const v of known.slice(1)) {
    const dist = Math.abs(v.at - want);
    if (dist < bestDist || (dist === bestDist && v.at > best.at)) {
      best = v;
      bestDist = dist;
    }
  }
  return best.id;
}

export interface AppliedEffort {
  variantId?: string;
  applied: boolean;
}

export type OptionTemplates = Record<string, Record<string, unknown>>;

export function matchTemplate(
  templates: OptionTemplates | undefined,
  providerID: string,
  modelID: string,
): Record<string, unknown> | undefined {
  if (!templates) return undefined;
  const provider = providerID.toLowerCase();
  const model = modelID.toLowerCase();
  const keys = [
    `${provider}/${model}`,
    `${provider}/*`,
    `*/${model}`,
    `*`,
  ];
  for (const key of keys) {
    const found = Object.entries(templates).find(
      ([k]) => k.toLowerCase() === key,
    );
    if (found) return found[1];
  }
  return undefined;
}

export function substituteEffort(
  value: unknown,
  effort: string,
): unknown {
  if (typeof value === "string") return value.split("{effort}").join(effort);
  if (Array.isArray(value)) return value.map((v) => substituteEffort(v, effort));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, substituteEffort(v, effort)]),
    );
  }
  return value;
}

export function applyEffort(
  options: Record<string, unknown>,
  providerID: string,
  modelID: string,
  effort: EffortLevel,
  entry?: CatalogEntry,
  templates?: OptionTemplates,
): AppliedEffort {
  const resolved =
    entry && resolveVariant(effort, entry.variants);

  const template = matchTemplate(templates, providerID, modelID);
  if (template) {
    Object.assign(
      options,
      substituteEffort(template, resolved ?? effort) as Record<string, unknown>,
    );
    return { variantId: resolved, applied: true };
  }

  const variant = resolved
    ? entry?.variants.find((v) => v.id.toLowerCase() === resolved.toLowerCase())
    : undefined;
  if (variant?.settings && typeof variant.settings === "object") {
    Object.assign(options, variant.settings);
    return { variantId: resolved, applied: true };
  }
  return { variantId: resolved, applied: false };
}

export function buildPromptState(text: string, maxChars = 4000): string {
  const body = text.length > maxChars ? text.slice(-maxChars) : text;
  return `task: ${body}`;
}

export function buildState(
  messages: unknown,
  agent: string,
  modelID: string,
  maxChars = 4000,
): string {
  const text = extractLastUserText(messages);
  const body = text.length > maxChars ? text.slice(-maxChars) : text;
  return `agent=${agent} model=${modelID}\ntask: ${body}`;
}

function extractLastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as {
      role?: string;
      content?: unknown;
      text?: string;
    };
    const role = (m?.role ?? "").toLowerCase();
    if (role !== "user" && role !== "human") continue;
    const text = contentToText(m?.content ?? m?.text ?? "");
    if (text.trim()) return text.trim();
  }
  return "";
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const p = part as { type?: string; text?: unknown };
          if (typeof p.text === "string") return p.text;
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

export function hashPrompt(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export const DEFAULT_MAX_KEYWORDS = ["ultrathink"];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findMaxKeyword(
  text: string,
  keywords: readonly string[] = DEFAULT_MAX_KEYWORDS,
): string | undefined {
  for (const keyword of keywords) {
    const word = keyword.trim();
    if (!word) continue;
    if (new RegExp(`(?<!\\w)${escapeRegExp(word)}(?!\\w)`, "i").test(text)) {
      return word;
    }
  }
  return undefined;
}
