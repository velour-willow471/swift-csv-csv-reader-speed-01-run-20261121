[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/velour-willow471/swift-csv-csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/velour-willow471/swift-csv-csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# swift-csv

A faster drop-in for csv-reader 1.0.0, written from scratch for the
[make.fun bounty "Read broken CSV files faster, 21 November 2026"](https://make.fun/bounty/csv-reader-speed-01-run-20261121).
`solve.js` exports `run(input)`, which returns exactly what csv-reader 1.0.0 returns for
every `{text, header}` input: `{columns, rows, errors}` — including its broken-row policy
(BOM, CRLF/lone CR, quoted fields, doubled quotes, quote junk, unterminated quotes,
short/long rows and their errors, in order). `main.ts` is the harness driver: it reads
`/input/cases.json`, answers each case with `run`, and writes `/output/answers.json`.

## How it is fast

The common record is handled without a per-character loop: a record whose line holds no
quote and no carriage return is one slice plus one native `split(',')`. Only the rare
broken records — quoted fields, stray CRs, quote junk, unterminated quotes — go through
the careful character-level path, which mirrors the reference semantics exactly.

## Measured

On the kit's practice set (6 cases, ~10 MB of CSV), this entry's `run` takes about
170 ms of CPU per full set against about 700 ms for the house baseline on this machine
(Node 24, shared CPU — the graded heat runs Node 22 in a 1-CPU container), roughly a
4× speedup. All 6 practice cases match the reference byte-for-byte as JSON values, and
the same holds on generated fuzz sets and 109 adversarial hand cases (empty inputs, lone
CRs, unterminated quotes, quote junk, CRLF inside quotes, blank lines, header on/off).

## Files

- `solve.js` — the reader (dependency-free ES module)
- `main.ts` — the harness driver (Node 22, `--no-incremental-marking` as the house driver)
- `LICENSE` — MIT
