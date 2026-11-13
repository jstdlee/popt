#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 leilei
//
// Replay runner for evaluating popt without an API endpoint. It runs the real
// pipeline; every model call is answered from <dir>/responses/NN.txt. When the
// next answer is missing, the request is written to <dir>/requests/NN.md and the
// process exits with code 3, so a person or another agent can answer it and run
// the stepper again. When the pipeline finishes, the prompt goes to <dir>/final.txt.
//
// usage: node eval/stepper.mjs <case-dir> [--src <popt-src-dir>]
// <case-dir>/case.json: { "mode": "user", "input": "...", "rounds": 2 }
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const dir = resolve(argv[0] ?? "");
const srcIdx = argv.indexOf("--src");
const src = resolve(srcIdx >= 0 ? argv[srcIdx + 1] : new URL("../src", import.meta.url).pathname);
const spec = JSON.parse(readFileSync(join(dir, "case.json"), "utf8"));
mkdirSync(join(dir, "requests"), { recursive: true });
mkdirSync(join(dir, "responses"), { recursive: true });

const { runPipeline } = await import(pathToFileURL(join(src, "pipeline.mjs")).href);

class NeedAnswer extends Error {}
let n = 0;
const complete = async (messages) => {
  n += 1;
  const id = String(n).padStart(2, "0");
  const answer = join(dir, "responses", `${id}.txt`);
  if (existsSync(answer)) return readFileSync(answer, "utf8");
  const body = messages.map((m) => `===== ${m.role.toUpperCase()} =====\n${m.content}`).join("\n\n");
  writeFileSync(join(dir, "requests", `${id}.md`), `${body}\n`);
  throw new NeedAnswer(id);
};

const log = [];
try {
  const result = await runPipeline({
    ...spec,
    complete,
    onStep: (event) => log.push(event.phase === "critique-result" ? { ...event } : event),
  });
  writeFileSync(join(dir, "final.txt"), `${result.text}\n`);
  writeFileSync(join(dir, "log.json"), JSON.stringify({ ...result, text: undefined, log }, null, 2));
  process.stdout.write(`done: ${join(dir, "final.txt")}\n`);
} catch (error) {
  if (error instanceof NeedAnswer) {
    process.stdout.write(`need: ${join(dir, "requests", `${error.message}.md`)} -> answer in ${join(dir, "responses", `${error.message}.txt`)}\n`);
    process.exitCode = 3;
  } else throw error;
}
