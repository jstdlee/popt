# popt

Command-line prompt optimizer. You type a few words; popt writes the prompt an expert in that field would have written: a system prompt, a user prompt, or an image prompt. Only the finished prompt goes to stdout.

Inspired by [linshenkx/prompt-optimizer](https://github.com/linshenkx/prompt-optimizer), Copyright (C) 2025 linshenkx, AGPL-3.0-only. This repository does not include that project's source or its built-in template text. The meta-prompts here were written for this CLI. See [NOTICE](NOTICE).

## How it works

Short input is short because the writer doesn't have an expert's checklist, or the time to write it out. popt's job is to add that expertise, not to restate the request at greater length.

1. **Analyze.** An intake call writes a JSON brief. It covers which kind of prompt is needed, the domain, the deliverable, the real goal behind the words, the strategy, 3–8 concrete assumptions, the field's expert practices for this request, the risks, placeholders for facts only you know, and 0–3 questions with default answers.
2. **Ask** (only with `-I`). popt shows the questions. Enter keeps the default. Without `-I`, popt takes the defaults and lists its assumptions on stderr.
3. **Write.** The writer gets the brief, the guidance for that kind of prompt, and the craft reference for the domain (coding, writing, marketing, data, education, business, translation, agents).
4. **Review and revise.** A reviewer scores six dimensions out of 60: intent, fidelity, craft, specificity, executability, format. The code, not the model, decides pass or fail. A failing draft is revised and reviewed again, and the best-scored candidate is printed.

Content falls into one of three kinds:

- **Stated facts** stay exactly as you wrote them: numbers, names, prohibitions, either/or choices.
- **Craft decisions** are chosen freely and specifically. Examples: lens and light, the breed of an unnamed cat, document structure, edge cases, analysis method.
- **Facts only you own** are never invented. Your company, prices, policies, data, and a real person's looks become `{{placeholders}}`.

Each request gets one strategy:

- `concretize` for a one-off artefact: narrow the scenario and decide the details.
- `generalize` for something reused, like a system prompt or template: keep the inputs open, but make the rules concrete.
- `preserve` for a request that is already long and specific: organise it, but don't re-imagine it.

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
popt "窗台上的猫"                 # auto: the analyst picks image
popt -m system "高中物理辅导老师"
popt -m image --lang en "旅行自拍"
popt -I "营销"                    # answer a few questions first
popt -i "改成只要五步" < prompt.md
```

Progress goes to stderr: the brief, the assumptions it made, any placeholders, and each review score. A pipe receives only the prompt:

```sh
popt -q "分析财报" > prompt.md
popt --brief "analyze churn" 2> brief.log > prompt.md
```

| Option | Meaning |
|---|---|
| `-m auto\|system\|user\|image` | default `auto`; an explicit mode always wins |
| `-I` | answer the brief's questions, then keep revising at `iterate>` (empty line or `exit` stops) |
| `-i <change>` | revise an existing prompt from stdin, `-f`, or the argument; the change is reviewed |
| `--rounds n` | most candidates to write and review (default 2) |
| `--once` | analyze and write once, no review (2 calls) |
| `--lang <tag>` | output language, for example `en` for an image model that reads English better |
| `--brief` | print the brief JSON to stderr |
| `--dry-run` | print the analyzer request; no API call |

A default run costs 3 calls if the first draft passes, and 5 if it needs one revision. Temperatures are 0.2 for analysis, 0.7 for writing, 0 for review, and 0.4 for revision.

## Layout

- `src/prompts.mjs`: meta-prompts (analyst, writer, mode guides, reviewer, reviser, domain playbooks)
- `src/templates.mjs`: fences and message builders
- `src/brief.mjs`: brief parsing and defaults
- `src/critique.mjs`: review parsing and scoring
- `src/pipeline.mjs`: analyze → write → review → revise, plus `-i`
- `src/ask.mjs`: interactive questions
- `src/llm.mjs`: chat-completions client
- `bin/popt.mjs`: CLI
- `eval/`: 15 eval cases, an endpoint runner (`node eval/run.mjs`), and a replay stepper for model-free runs

```sh
npm test
node eval/run.mjs --only 01-cat,09-support   # needs an endpoint
```
