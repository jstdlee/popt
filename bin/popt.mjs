#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 leilei
//
// Independent command-line prompt optimizer inspired by
// linshenkx/prompt-optimizer, Copyright (C) 2025 linshenkx, AGPL-3.0-only.
// https://github.com/linshenkx/prompt-optimizer
import { readFileSync } from "node:fs";
import readline from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";
import { parseArgs, usage } from "../src/args.mjs";
import { resolveCredentials } from "../src/config.mjs";
import { complete } from "../src/llm.mjs";
import { runPipeline } from "../src/pipeline.mjs";
import { buildMessages } from "../src/templates.mjs";

const VERSION = "0.1.0";

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => chunks.push(chunk));
    stdin.on("end", () => resolve(chunks.join("").trim()));
    stdin.on("error", reject);
  });
}

async function loadInput(args) {
  if (args.file) return readFileSync(args.file, "utf8").trim();
  if (args.prompt) return args.prompt;
  if (!stdin.isTTY) return readStdin();
  return "";
}

function writeResult(text) {
  const trimmed = text.replace(/\s+$/u, "");
  stdout.write(trimmed);
  stdout.write("\n");
}

async function optimize(args, input, iterate) {
  const creds = resolveCredentials();
  const model = args.model || creds.model;
  const baseUrl = (args.baseUrl || creds.baseUrl).replace(/\/$/, "");
  const mode = iterate ? "iterate" : args.mode;
  if (args.dryRun) {
    const messages = buildMessages({ mode, input, iterate });
    stdout.write(`${JSON.stringify({ model, baseUrl, rounds: args.rounds, messages }, null, 2)}\n`);
    return input;
  }
  if (!creds.apiKey) {
    throw new Error("no API key. Set POPT_API_KEY, or keep Magpie's key in ~/.omp/agent/models.yml");
  }
  const result = await runPipeline({
    mode,
    input,
    iterate,
    rounds: args.rounds,
    complete: (messages) => complete({
      baseUrl,
      apiKey: creds.apiKey,
      model,
      messages,
      stream: false,
      effort: args.effort,
    }),
    onStep(event) {
      if (args.quiet) return;
      if (event.phase === "draft" || event.phase === "revise") {
        stderr.write(`popt: ${event.phase} ${event.round}/${event.limit} via ${model}\n`);
      } else if (event.phase === "critique-result") {
        const critique = event.critique;
        if (critique.pass) stderr.write(`popt: critique ${event.round}: pass\n`);
        else {
          const missing = critique.missing.join(" | ") || "-";
          const invented = critique.invented.join(" | ") || "-";
          stderr.write(`popt: critique ${event.round}: missing=${missing} invented=${invented}\n`);
        }
      }
    },
  });
  writeResult(result.text);
  return result.text;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    stderr.write(`${error.message}\n${usage()}`);
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    stdout.write(usage());
    return;
  }
  if (args.version) {
    stdout.write(`${VERSION}\n`);
    return;
  }
  if (args.interactive && !stdin.isTTY) {
    stderr.write("popt: --interactive needs a terminal\n");
    process.exitCode = 2;
    return;
  }
  let input = await loadInput(args);
  if (!input) {
    stderr.write(usage());
    process.exitCode = 2;
    return;
  }
  let current = await optimize(args, input, args.iterate);
  if (!args.interactive) return;
  const rl = readline.createInterface({ input: stdin, output: stderr });
  try {
    while (true) {
      const line = (await rl.question("iterate> ")).trim();
      if (!line || line === "exit" || line === ".exit") break;
      current = await optimize({ ...args, stream: args.stream }, current, line);
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  stderr.write(`popt: ${error.message}\n`);
  process.exitCode = 1;
});
