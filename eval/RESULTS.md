# Eval results

Fifteen cases from `cases.json`. Each case had one sample per build. The replay stepper ran the real pipeline, with Claude Sonnet answering each model call in place of grok-4.7. Claude Fable graded the outputs blind against the six-dimension rubric (weighted, out of 60), using the same weights the reviewer uses. Builds:

- **old:** the 0.1.0 templates.
- **v1:** the brief, playbooks, and scored review.
- **v2:** v1 plus situational guesses written as slots with defaults, and a reviewer ledger.

## Round 2: three-way blind

| Case | old | v1 | v2 |
|---|---|---|---|
| 01-cat | 39 | 58 | 57 |
| 02-mug | 39 | 50 | 57 |
| 03-poster | 46 | 44 | 59 |
| 04-selfie | 34 | 48 | 58 |
| 05-portrait | 47 | 55 | 53 |
| 06-logo | 47 | 56 | 58 |
| 07-dedupe | 52 | 54 | 53 |
| 08-ratelimit | 58 | 53 | 56 |
| 09-support | 43 | 51 | 59 |
| 10-tutor | 46 | 55 | 54 |
| 11-xhs | 44 | 43 | 56 |
| 12-churn | 55 | 41 | 58 |
| 13-oneword | 43 | 35 | 53 |
| 14-template | 45 | 59 | 58 |
| 15-contract | 55 | 54 | 58 |
| **Mean** | **46.2** | **50.4** | **56.5** |
| Hard-fail flags | 1 | 6 | 0 |
| Ranked first | 1 | 5 | 9 |

- v2 ranks above old in 14 of 15 cases. The exception is 08, where old scores 58 and v2 scores 56.
- v2 ranks above v1 in 10 of 15 cases.
- v2 averages 4.3 model calls per run: 3 when the first draft passes, 5 with one revision.

## Round 1: pairwise, old vs v1

v1 won 13 cases, lost 1 (03), and tied 1 (13). Mean scores were 52.7 for v1 and 43.0 for old. v1 had three cases of invented client facts: a poster title, a business type, and a budget. The in-pipeline reviewer passed every first draft, so these went uncaught. v2 fixes this.

## Known remaining weaknesses (grader notes, v2)

- **Unmarked guesses:** a few are still stated as fact, such as "files under 100 MB" in 07 and the student region and level in 10.
- **Slot overload:** some prompts carry more slots than they need.
- **Depth-of-field contradictions:** some image prompts conflict on depth of field, for example in 01.
- **Unused numbers:** 05 lists a numeric fact that the prompt never uses.
- **Limits that cannot fit:** in 12, the self-imposed word cap is too small for the sections the prompt asks for.

## Caveats

- **Stand-in model.** Sonnet stood in for grok-4.7. Rerun with `node eval/run.mjs` against the real endpoint.
- **One sample per case.** The sample size is small.
- **Grader is not human.** Fable graded every output; no person reviewed the scores.
