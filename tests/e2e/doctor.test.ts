import { execa } from "execa";
import { describe, expect, it } from "vitest";

describe("doctor", () => {
  it("reports a usable local setup without cloud credentials", async () => {
    const result = await execa("pnpm", ["exec", "tsx", "src/cli.ts", "doctor", "--json"], {
      reject: false,
      env: {
        ...process.env,
        FORGE_HISTORY_BUCKET: "",
        FORGE_GITHUB_TOKEN: "",
        FORGE_MODEL_PROVIDER: "",
        FORGE_MODEL_ID: "",
      },
    });
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as { ok: boolean; checks: Array<{ name: string; detail: string }> };
    expect(report.ok).toBe(true);
    const history = report.checks.find((check) => check.name === "s3_history");
    expect(history?.detail).toMatch(/not set/i);
    const github = report.checks.find((check) => check.name === "github_app");
    expect(github?.detail).toMatch(/not configured/i);
  });
});
