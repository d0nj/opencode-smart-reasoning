import { Plugin } from "@opencode/plugin/tui";
import { defaultStatusPath, lastDecisionFor } from "./status.js";

function footerText(path: string, sessionID?: string): string {
  if (!sessionID) return "";
  const record = lastDecisionFor(path, sessionID);
  if (!record) return "";
  return `effort ${record.effort}${record.variant ? `/${record.variant}` : ""}`;
}

export default Plugin.define({
  id: "smart-reasoning-tui",
  setup(context) {
    const path = defaultStatusPath();
    context.ui.slot({
      append: "prompt.footer.status",
      render: (input) => <text>{footerText(path, input.sessionID)}</text>,
    });
  },
});
