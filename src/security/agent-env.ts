const FORBIDDEN = [
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_APP_PRIVATE_KEY",
  "FORGE_GITHUB_TOKEN",
  "FORGE_GITHUB_APP_PRIVATE_KEY",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_ACCESS_KEY_ID",
];

const ALLOWED = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "CI",
  "NODE_ENV",
  "COREPACK_HOME",
  "PNPM_HOME",
  "FORGE_RUN_ID",
  "FORGE_TASK_ID",
  "FORGE_MODEL_PROVIDER",
  "FORGE_MODEL_ID",
  "GIT_TERMINAL_PROMPT",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_GLOBAL",
];

const MODEL_KEY_PATTERN = /(API_KEY|ACCESS_TOKEN)$/;

export function forbiddenAgentVariables(env: NodeJS.ProcessEnv): string[] {
  return FORBIDDEN.filter((name) => {
    const value = env[name];
    return typeof value === "string" && value.length > 0;
  });
}

export function buildAgentEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  for (const name of ALLOWED) {
    const value = source[name];
    if (typeof value === "string") env[name] = value;
  }
  for (const [name, value] of Object.entries(source)) {
    if (typeof value !== "string" || value.length === 0) continue;
    if (MODEL_KEY_PATTERN.test(name) && !FORBIDDEN.includes(name)) {
      env[name] = value;
    }
  }
  for (const name of FORBIDDEN) delete env[name];
  return env;
}

export function assertAgentEnvironment(env: NodeJS.ProcessEnv): void {
  const present = forbiddenAgentVariables(env);
  if (present.length > 0) {
    throw new Error(
      `Agent environment still contains forbidden credential variables: ${present.join(", ")}.`,
    );
  }
}
