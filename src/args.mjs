// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 leilei
import { MODES } from "./templates.mjs";

export function usage() {
  return `popt — rewrite a prompt. stdout is only the rewritten prompt.

usage:
  popt [options] [prompt...]
  echo "旅行自拍" | popt -m system
  popt -m image -f idea.txt
  popt -i "更短，只要五步" < prompt.md
  popt -I -m user "旅行自拍"

options:
  -m, --mode <auto|system|user|image>
                                   default: auto (the analyst picks; shown on stderr)
  -i, --iterate <change>           revise the prompt from stdin, -f, or the positional text.
                                   With -m, the reviser also gets that mode's craft reference
  -I, --interactive                answer a few questions first, then revise from the terminal
  -f, --file <path>                read the prompt from a file
      --rounds <n>                 most candidates to write and review; default 2.
                                   Stops at the first pass; the best-scored one wins
      --once                       analyze and write once, no review
      --lang <tag>                 output language, e.g. en; default: the input's
      --brief                      print the analyst's brief (JSON) to stderr
      --model <id>                 default: grok/grok-4.7 (Magpie)
      --base-url <url>             default: http://127.0.0.1:3425/v1
      --effort <low|medium|high|xhigh>
      --no-stream                  accepted; intermediate passes are never streamed
      --dry-run                    print the first request (the analyzer's) as JSON, no API call
  -q, --quiet
  -h, --help
  -v, --version

Inspired by linshenkx/prompt-optimizer (AGPL-3.0-only). This program does not
include that project's source or template text. See NOTICE.
`;
}

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const out = {
    help: false,
    version: false,
    mode: "auto",
    lang: "",
    showBrief: false,
    iterate: "",
    interactive: false,
    file: "",
    model: "",
    baseUrl: "",
    effort: "",
    stream: true,
    dryRun: false,
    quiet: false,
    rounds: 2,
    prompt: "",
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const take = () => {
      const value = argv[++i];
      if (value === undefined || value.startsWith("-")) throw new Error(`missing value for ${arg}`);
      return value;
    };
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-h" || arg === "--help") out.help = true;
    else if (arg === "-v" || arg === "--version") out.version = true;
    else if (arg === "-m" || arg === "--mode") out.mode = take();
    else if (arg === "-i" || arg === "--iterate") out.iterate = take();
    else if (arg === "-I" || arg === "--interactive") out.interactive = true;
    else if (arg === "-f" || arg === "--file") out.file = take();
    else if (arg === "--model") out.model = take();
    else if (arg === "--base-url") out.baseUrl = take();
    else if (arg === "--effort") out.effort = take();
    else if (arg === "--no-stream") out.stream = false;
    else if (arg === "--once") out.rounds = 1;
    else if (arg === "--rounds") out.rounds = Number(take());
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--lang") out.lang = take();
    else if (arg === "--brief") out.showBrief = true;
    else if (arg === "-q" || arg === "--quiet") out.quiet = true;
    else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else positional.push(arg);
  }
  out.prompt = positional.join(" ").trim();
  if (!out.help && !out.version && !MODES.includes(out.mode)) {
    throw new Error(`unknown mode: ${out.mode}`);
  }
  const efforts = new Set(["", "low", "medium", "high", "xhigh"]);
  if (!efforts.has(out.effort)) throw new Error(`unknown effort: ${out.effort}`);
  if (!Number.isInteger(out.rounds) || out.rounds < 1 || out.rounds > 5) {
    throw new Error(`rounds must be an integer from 1 to 5`);
  }
  return out;
}
