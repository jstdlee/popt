#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 leilei
//
// Runs every case in eval/cases.json against the configured endpoint and
// writes one Markdown file per case, for side-by-side review.
//
// usage: node eval/run.mjs [--out eval/out] [--only id,id] [--model id] [--rounds n]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveCredentials } from "../src/config.mjs";
import { complete } from "../src/llm.mjs";
import { runPipeline } from "../src/pipeline.mjs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const out = resolve(opt("--out", new URL("./out", import.meta.url).pathname));
const only = opt("--only", "") ? new Set(opt("--only", "").split(",")) : null;
const creds = resolveCredentials();
const model = opt("--model", creds.model);
if (!creds.apiKey) throw new Error("no API key; see README");
const cases = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8"));
mkdirSync(out, { recursive: true });

for (const c of cases) {
  if (only && !only.has(c.id)) continue;
  const started = Date.now();
  let calls = 0;
  const result = await runPipeline({
    mode: c.mode,
    lang: c.lang,
    input: c.input,
    rounds: Number(opt("--rounds", c.rounds ?? 2)),
    complete: (messages) => {
      calls += 1;
      return complete({ baseUrl: creds.baseUrl, apiKey: creds.apiKey, model, messages });
    },
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const md = `# ${c.id}\n\n- mode: ${c.mode}\n- input: ${c.input}\n- model: ${model}\n- calls: ${calls}, ${seconds}s, passed: ${result.passed}\n\n---\n\n${result.text}\n`;
  writeFileSync(join(out, `${c.id}.md`), md);
  process.stderr.write(`${c.id}: ${calls} calls, ${seconds}s\n`);
}
