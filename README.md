# popt

Command-line prompt optimizer. Rewrites a short instruction into a system prompt, a user prompt, or an image prompt. The rewritten prompt is the only thing written to stdout.

Inspired by [linshenkx/prompt-optimizer](https://github.com/linshenkx/prompt-optimizer), Copyright (C) 2025 linshenkx, AGPL-3.0-only. This repository does not include that project's source or its built-in template text. The meta-prompts here were written for this CLI. See [NOTICE](NOTICE).

Generation follows that project's loop, not a single rewrite. A draft is checked against the original. A failed check becomes the next revision's change request. Stdout is only the last accepted prompt. `--rounds` defaults to 2 and stops early when the check passes. `--once` skips the check.

## License

GNU Affero General Public License v3.0 only. Same terms as prompt-optimizer. Copyright (C) 2026 leilei for this implementation.

## Requirements

- Node.js 22+
- [Magpie](https://usemagpie.ai) gateway on `http://127.0.0.1:3425/v1`
- Default model: `grok/grok-4.7`

The API key is read, and never printed, from the first of:

1. `POPT_API_KEY`
2. `MAGPIE_API_KEY`
3. `OPENAI_API_KEY`
4. `providers.magpie.apiKey` in `~/.omp/agent/models.yml`

Override the endpoint with `POPT_BASE_URL` or `--base-url`, and the model with `POPT_MODEL` or `--model`.

## Use

```sh
popt "旅行自拍"
popt -m system "旅行自拍"
popt -m image "旅行自拍"
popt -i "改成只要五步" < prompt.md
popt -I -m user "旅行自拍"
```

Progress goes to stderr. A pipe receives only the prompt:

```sh
popt -q "分析财报" > prompt.md
```

`--dry-run` prints the messages that would be sent and does not call the model.

In `--interactive`, type a change request after `iterate>`. An empty line or `exit` stops.

## Layout

- `src/templates.mjs` — original meta-prompts and fences
- `src/llm.mjs` — Magpie chat-completions client (`grok/grok-4.7`)
- `bin/popt.mjs` — CLI

```sh
npm test
```
