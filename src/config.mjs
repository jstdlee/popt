// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 leilei
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_BASE_URL = "http://127.0.0.1:3425/v1";
export const DEFAULT_MODEL = "grok/grok-4.7";

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/** Read providers.magpie.apiKey from an omp models.yml. Returns "" when absent. */
export function readMagpieKey(text) {
  let inProviders = false;
  let inMagpie = false;
  for (const line of String(text).split("\n")) {
    if (/^providers:/.test(line)) {
      inProviders = true;
      continue;
    }
    if (inProviders && /^[^ \t#]/.test(line)) break;
    if (inProviders && /^  magpie:/.test(line)) {
      inMagpie = true;
      continue;
    }
    if (inMagpie && /^  [^ \t#]/.test(line)) break;
    if (!inMagpie) continue;
    const match = line.match(/^    apiKey:\s*(.*?)\s*$/);
    if (match) return unquote(match[1].trim());
  }
  return "";
}

function keyFromModelsFile() {
  const path = process.env.POPT_MODELS_YML || join(homedir(), ".omp/agent/models.yml");
  try {
    return readMagpieKey(readFileSync(path, "utf8"));
  } catch {
    return "";
  }
}

export function resolveCredentials() {
  const apiKey = process.env.POPT_API_KEY || process.env.MAGPIE_API_KEY || process.env.OPENAI_API_KEY || keyFromModelsFile();
  const baseUrl = (process.env.POPT_BASE_URL || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = process.env.POPT_MODEL || DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
}
