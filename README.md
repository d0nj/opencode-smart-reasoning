# opencode-smart-reasoning

Per-request smart reasoning routing for OpenCode agents, decided by
[Jev](https://opencode.ai/docs/zen/#jev) (TypeSafe SystemOne via OpenCode Zen).

The plugin hooks the agent-loop model call (`ctx.session.hook("context")`),
asks Jev how much reasoning the current task needs, and applies the matching
[model variant](https://opencode.ai/docs/models/#variants) via
`event.options`. No prompt rewriting, no text parsing, no hardcoded
provider lists.

Question design follows the Context7 TypeSafe docs: atomic `choice` +
`noul` questions evaluated in parallel, composed in code.

## Install

```jsonc
// opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{ "package": "opencode-smart-reasoning", "options": {
    "model": "jev-1.13-free",
    "defaultEffort": "medium",
    "maxEffort": "xhigh",
  } }],
}
```

Local dev:

```jsonc
{ "plugins": [{ "package": "./path/to/opencode-jev", "options": {} }] }
```

## Auth

Uses your existing Zen key. Set one of:

- `OPENCODE_API_KEY` (preferred, same key as `/connect`)
- `JEV_API_KEY` (override)

Optional: `JEV_MODEL` (default `jev-1.13-free`, paid: `jev-1.13`).

## Endpoint override

Three levels, most specific wins:

1. `endpoint` plugin option — e.g. a self-hosted SystemOne gateway or mock.
2. `JEV_ENDPOINT` environment variable.
3. Default `https://opencode.ai/zen/v1/systemone`.

```jsonc
{ "plugins": [{ "package": "opencode-smart-reasoning", "options": {
  "endpoint": "https://my-gateway.internal/systemone",
} }] }
```

Note: config/option changes require restarting the `opencode2` process.

## How it decides

The decision happens **before the request**, at prompt admission
(`ctx.session.hook("prompt")`), and is applied to that request in the
model-dispatch hook (`ctx.session.hook("context")`):

1. `prompt` hook: asks Jev once per new user prompt, stashes the effort per
   session (retry-safe: replayed admissions of the same prompt reuse the
   stash instead of paying for Jev twice).
2. `context` hook: applies the stashed effort to the outgoing model call, so
   tool-loop continuations of the same prompt reuse it without another call.
   Only when no stash exists (synthetic messages, sessions predating the
   plugin) does it fall back to a one-off decision from the messages.

- `reasoning_effort` (choice: minimal/low/medium/high/xhigh) — base level.
- `high_stakes` (noul) — >= 0.7 bumps one level (irreversible /
  production / security / payments / migration work).
- Choice confidence < `minConfidence` (0.35) falls back to `defaultEffort`.
- Result is clamped to `maxEffort`.

Fail-open: missing key, timeout (8s), or Jev error leaves model defaults
untouched.

## Explicit variants win

A user-pinned variant (agent `variant` in config, `variant_cycle` keybind,
`--model` with variant, `switchModel`) always beats Jev when
`respectExplicitVariant` is true (default):

- the `prompt` hook skips the Jev call when the session already pins
  `model.variant` (no wasted cost or latency);
- the `context` hook never sets options on a request carrying
  `model.variant`.

Set `respectExplicitVariant: false` to let Jev override even pinned
variants.

## Provider mapping

Fully data-driven — no hardcoded provider or model lists:

1. At startup the plugin reads `ctx.model.list()` and learns every model's
   real variant vocabulary (`variants[{id, settings}]`).
2. Jev's abstract effort (`minimal…xhigh`) is clamped to the request
   model's own variant ids (nearest on a weakest→strongest scale, ties
   break upward). Variants are placed by id, or — for custom ids like
   `fast` — by the effort strings in their own settings; `max` sits at
   the top, so `xhigh` decisions land on it where supported.
3. The resolved variant's own `settings` payload is spread into the request
   — exactly what selecting that variant would do, whatever keys that
   provider uses.
4. No catalog data (unknown model, settings-less or custom-only variants)?
   Options are left untouched and model defaults apply.

`optionTemplates` covers the gaps: per-provider/model option payloads with
an `{effort}` placeholder, e.g. `{ "deepseek/*": { "reasoningEffort":
"{effort}" } }`. Keys: exact `provider/model`, `provider/*`, `*/model`,
`*` (most specific wins).

Auxiliary agents `title`/`summary`/`compaction` are excluded by default;
override with `includeAgents`/`excludeAgents`.

## Footer status

The package ships a second entrypoint (`./tui`, loaded automatically) that
adds the decided effort to the prompt footer, e.g. `effort high/max`. Every
applied decision is also appended as JSON to
`~/.local/share/opencode/smart-reasoning.jsonl` (override with the
`statusFile` option, `false` disables). Restart the TUI to pick up either
side after updating.

## Options

See `JevReasoningOptions` in `src/index.ts`. Full example in
`opencode.jsonc.example`.
