import { parseDocument } from "yaml";
import { ForgeError } from "./errors.js";

const DEFAULT_MAX_BYTES = 200_000;

export function parseYaml(text: string, label: string, maxBytes = DEFAULT_MAX_BYTES): unknown {
  const size = Buffer.byteLength(text);
  if (size > maxBytes) {
    throw new ForgeError("INPUT_TOO_LARGE", `${label} is ${size} bytes; limit is ${maxBytes}.`);
  }
  if (text.includes("\u0000")) {
    throw new ForgeError("INVALID_YAML", `${label} contains a NUL byte.`);
  }
  const document = parseDocument(text, { uniqueKeys: true, strict: true });
  if (document.errors.length > 0) {
    const message = document.errors.map((error) => error.message).join("; ");
    throw new ForgeError("INVALID_YAML", `${label} is not valid YAML: ${message}`);
  }
  return document.toJS({ maxAliasCount: 0 });
}
