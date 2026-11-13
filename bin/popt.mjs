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
import { createAsker } from "../src/ask.mjs";
import { briefSummary } from "../src/brief.mjs";
import { resolveCredentials } from "../src/config.mjs";
import { critiqueSummary } from "../src/critique.mjs";
import { complete } from "../src/llm.mjs";
import { runIterate, runPipeline } from "../src/pipeline.mjs";
import { buildAnalyzeMessages, buildReviseMessages } from "../src/templates.mjs";

const VERSION = "0.2.0";

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
  stdout.write(text.replace(/\s+$/u, ""));
  stdout.write("\n");
}

function progress(args, model) {
  const say = (line) => {
    if (!args.quiet) stderr.write(`popt: ${line}\n`);
  };
  return (event) => {
    switch (event.phase) {
      case "analyze":
        say(`analyze via ${model}${event.reason ? ` (${event.reason})` : ""}`);
        break;
      case "analyze-fallback":
        say("analyst reply unreadable; writing without a brief");
        break;
      case "brief": {
        const { brief } = event;
        say(`brief: ${briefSummary(brief)}`);
        if (args.mode === "auto" && brief.mode_confidence !== "high") {
          say(`mode=${brief.mode} (auto, ${brief.mode_confidence} confidence). Use -m to choose.`);
        }
        if (brief.assumptions.length) say(`assumed: ${brief.assumptions.join("; ")}`);
        const answered = (brief.decisions ?? []).filter((d) => d.source === "default");
        if (answered.length && !args.interactive) say(`defaults: ${answered.map((d) => d.answer).join("; ")} (ask with -I)`);
        if (brief.placeholders.length) say(`placeholders: ${brief.placeholders.map((p) => `{{${p.name}}}`).join(" ")}`);
        if (args.showBrief) stderr.write(`${JSON.stringify(brief, null, 2)}\n`);
        break;
      }
      case "draft":
      case "revise":
        say(`${event.phase} ${event.round}/${event.limit}`);
        break;
      case "critique-result":
        say(`critique ${event.round}: ${critiqueSummary(event.critique)}`);
        break;
      default:
    }
  };
}

function client(args) {
  const creds = resolveCredentials();
  const model = args.model || creds.model;
  const baseUrl = (args.baseUrl || creds.baseUrl).replace(/\/$/, "");
  if (!creds.apiKey) {
    throw new Error("no API key. Set POPT_API_KEY, or keep Magpie's key in ~/.omp/agent/models.yml");
  }
  return {
    model,
    complete: (messages, opts = {}) => complete({
      baseUrl,
      apiKey: creds.apiKey,
      model,
      messages,
      stream: false,
      effort: args.effort,
      temperature: opts.temperature,
    }),
  };
}

function dryRun(args, input) {
  const creds = resolveCredentials();
  const messages = args.iterate
    ? buildReviseMessages({ current: input, change: args.iterate, mode: args.mode })
    : buildAnalyzeMessages({ input, modeRequest: args.mode });
  const model = args.model || creds.model;
  const baseUrl = args.baseUrl || creds.baseUrl;
  stdout.write(`${JSON.stringify({ model, baseUrl, rounds: args.rounds, messages }, null, 2)}\n`);
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
  if (args.dryRun) {
    dryRun(args, input);
    return;
  }
  const { model, complete: call } = client(args);
  const onStep = progress(args, model);
  let rl = null;
  const terminal = () => {
    rl ??= readline.createInterface({ input: stdin, output: stderr });
    return rl;
  };
  try {
    let result;
    if (args.iterate) {
      result = await runIterate({
        current: input,
        change: args.iterate,
        mode: args.mode,
        rounds: args.rounds,
        complete: call,
        onStep,
      });
    } else {
      result = await runPipeline({
        mode: args.mode,
        input,
        rounds: args.rounds,
        lang: args.lang,
        complete: call,
        onStep,
        ask: args.interactive
          ? createAsker({
            question: (prompt) => terminal().question(prompt),
            write: (text) => stderr.write(text),
            autoMode: args.mode === "auto",
          })
          : undefined,
      });
    }
    writeResult(result.text);
    if (!args.interactive) return;
    let current = result.text;
    while (true) {
      const line = (await terminal().question("iterate> ")).trim();
      if (!line || line === "exit" || line === ".exit") break;
      const next = await runIterate({
        current,
        change: line,
        mode: args.iterate ? args.mode : result.brief?.mode,
        brief: result.brief,
        input: args.iterate ? "" : input,
        rounds: 1,
        complete: call,
        onStep,
      });
      current = next.text;
      writeResult(current);
    }
  } finally {
    rl?.close();
  }
}

main().catch((error) => {
  stderr.write(`popt: ${error.message}\n`);
  process.exitCode = 1;
});
