import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Trusted control-plane marker. It records that this Pi process was started by
 * Telecom Forge. Usage and tool events stay in Pi's JSONL stream so they are
 * not counted twice.
 */
export default function telemetryExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async () => {
    pi.appendEntry("forge-run", {
      runId: process.env.FORGE_RUN_ID ?? "unknown",
      taskId: process.env.FORGE_TASK_ID ?? "unknown",
    });
  });
}
