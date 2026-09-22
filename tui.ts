import { Plugin } from "@opencode/plugin/tui";
import { jsx } from "@opentui/solid/jsx-runtime";
import { createSignal, onCleanup } from "solid-js";
import { defaultStatusPath, footerLabel } from "./src/status.js";

const PATH = defaultStatusPath();

export default Plugin.define({
  id: "smart-reasoning-tui",
  setup(context) {
    context.ui.slot({
      append: "prompt.footer.status",
      render: (input) => {
        try {
          const [label, setLabel] = createSignal(
            footerLabel(PATH, input.sessionID),
          );
          const timer = setInterval(() => {
            const next = footerLabel(PATH, input.sessionID);
            if (next !== label()) setLabel(next);
          }, 2000);
          onCleanup(() => clearInterval(timer));
          return jsx("text", { children: () => label() });
        } catch {
          return jsx("text", {
            children: footerLabel(PATH, input.sessionID),
          });
        }
      },
    });
  },
});
