import { ForgeError } from "../lib/errors.js";

const PATTERNS: Array<{ name: string; expression: RegExp }> = [
  { name: "github_token", expression: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { name: "github_pat", expression: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: "github_oauth", expression: /\bgho_[A-Za-z0-9]{20,}\b/g },
  { name: "aws_access_key", expression: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "slack_token", expression: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "openai_style", expression: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "private_key", expression: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "forge_test_secret", expression: /\bFORGE_TEST_SECRET_[A-Za-z0-9_-]+\b/g },
];

export interface Redaction {
  text: string;
  findings: string[];
}

export function redactSecrets(input: string): Redaction {
  let text = input;
  const findings = new Set<string>();
  for (const pattern of PATTERNS) {
    pattern.expression.lastIndex = 0;
    if (pattern.expression.test(text)) {
      findings.add(pattern.name);
      pattern.expression.lastIndex = 0;
      text = text.replace(pattern.expression, "[REDACTED]");
    }
  }
  return { text, findings: [...findings] };
}

export function assertNoSecrets(input: string, label: string): void {
  const result = redactSecrets(input);
  if (result.findings.length > 0) {
    throw new ForgeError(
      "SECRET_DETECTED",
      `${label} contains secret-like content (${result.findings.join(", ")}).`,
      { exitCode: 3 },
    );
  }
}
