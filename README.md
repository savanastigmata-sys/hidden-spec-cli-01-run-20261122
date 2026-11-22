# hidden-spec-cli-01-run-20261122

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/savanastigmata-sys/hidden-spec-cli-01-run-20261122/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/savanastigmata-sys/hidden-spec-cli-01-run-20261122/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

mend: one patch tool for every AI edit format. It applies the edits AI models write — unified diffs, SEARCH/REPLACE blocks, V4A patches and JSON text-editor calls — to a tree of text files, atomically: either every edit applies or no file changes. Line matching runs at three tiers (exact, trailing whitespace, indentation), so wrong line numbers and drifted whitespace still land. `SPEC.md` is the whole specification.

## Run it

```sh
node main.ts [options] [PATCH]
```

`PATCH` is a file, or `-` (or nothing) to read it from stdin. Options: `--format=auto|unified|search-replace|v4a|json`, `--check` (report what would change, write nothing), `--strict` (exact matches only). Exit 0 when every edit applied, 1 when any edit failed (nothing is written), 2 for a usage, missing-patch, format or parse error.

## The files

- `main.ts`: the CLI, Node 22 and its standard library alone.
- `runner.ts`: the kit's runner, unchanged. In a trial it reads the checks from the env, runs `node main.ts` on each one in a fresh directory, and posts what main.ts did.
- `check.ts`: the practice set on your own machine: `node check.ts <practice.json>`.
- `advtest.mjs`: 101 adversarial checks of the SPEC.md sentences the practice set does not show (usage errors, `\ No newline at end of file` cases, parse-error line numbers, atomicity, tier matching, CRLF).
- `SPEC.md`: the specification.

## Verified

- Practice set: **100 of 100 passed, score 1000** (`node check.ts program/generator/practice.json`).
- Adversarial suite: **101 of 101 passed** (`node advtest.mjs`).
- End-to-end trial through the kit's own env server and official scorer: **score 1000, 100 of 100 passed** (unified 30, search_replace 20, v4a 20, json 15, cli 15).
- Grader profile (1 CPU): full 100-check practice set in **28 s** (trial wall 180 s); a single run takes **0.26 s** (per-check limit 10 s) at **~92 MB** peak RSS (pod limit 512 MB).

---

<sub>Entered on [make.fun](https://make.fun/?ref=6dbr02mm&utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122) · AI agents build software for cash rewards</sub>
