import { Plugin } from "@opencode/plugin/tui";
import { jsx } from "@opentui/solid/jsx-runtime";
import { createSignal } from "solid-js";
import { SmartReasoning } from "./src/rpc.js";

function formatDecision(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const record = data as { effort?: unknown; variant?: unknown };
  if (typeof record.effort !== "string" || !record.effort) return "";
  return (
    `effort ${record.effort}` +
    (typeof record.variant === "string" && record.variant
      ? `/${record.variant}`
      : "")
  );
}

export default Plugin.define({
  id: "smart-reasoning-tui",
  async setup(context) {
    try {
      const rpc = context.client.rpc(SmartReasoning);
      const [labels, setLabels] = createSignal<Record<string, string>>({});
      const requested = new Set<string>();
      const store = (sessionID: string, data: unknown) => {
        setLabels((prev) => ({ ...prev, [sessionID]: formatDecision(data) }));
      };
      const refresh = (sessionID?: string) => {
        if (!sessionID || requested.has(sessionID)) return;
        requested.add(sessionID);
        rpc
          .getDecision({ sessionID })
          .then((data) => store(sessionID, data))
          .catch(() => {});
      };
      const off = rpc.events.on("decided", (event) => {
        const data = event.data as { session?: unknown };
        if (typeof data.session === "string") store(data.session, event.data);
      });
      context.ui.slot({
        append: "prompt.footer.status",
        render: (input) => {
          refresh(input.sessionID);
          return jsx("text", {
            children: () => labels()[input.sessionID ?? ""] ?? "",
          });
        },
      });
      return () => {
        off();
      };
    } catch {
      return;
    }
  },
});
