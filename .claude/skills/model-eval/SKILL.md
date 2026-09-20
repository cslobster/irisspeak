---
name: model-eval
description: Run the card-model evaluation suite (board_eval question bank + held-out, judge_boards blind LLM judge, setting_eval sensitivity/precision) against a given model directory and diff the numbers against the committed results JSON in model/eval/. User-invoked; needs a Python env with onnxruntime/transformers/sentence-transformers and the model files, which are not in git.
disable-model-invocation: true
argument-hint: <model-dir> <onnx-path> [run-name]
---

# Evaluate a card model and diff it against the committed results

Everything below was read from the scripts' argparse and docstrings on 2026-09-20 — re-read them if they
have changed (`model/eval/board_eval.py`, `judge_boards.py`, `setting_eval.py`, `evaluate_run.sh`,
`docs/BOARD-EVAL.md`, `docs/DISTILLATION.md` "Results"). Do not invent flags.

## Inputs you need (none are in git)

| What | Where it comes from | Used by |
|---|---|---|
| **model dir** (`BOARD_MODEL_DIR`): `cards.json`, `reranker.json`, `freq.json`, `card_vecs.bin` | `site/chunk_model.py` + `eval/export_reranker.py` output for a run (`$WORK/site/model_<run>`), or the shipped set from `https://model.irisspeak.org/{cards,reranker,freq}.json` + `card_vecs.bin` | all three |
| **ONNX** (`BOARD_ONNX`): `card_model_fp16.onnx` (+ `_data` if exported with external weights) | `export/export_onnx_optimum.py` + `export/quantize_nbits.py` → `$WORK/export/out_<run>/`; the shipped one is the concatenation, in `manifest.json` order, of the `v7/card_model_fp16.partNN` chunks on the CDN (sha256 in the manifest) | board_eval, setting_eval, judge_boards |
| held-out states `model/data/states/test_qa.jsonl`, `test_qa_youth.jsonl`, `test_gen.jsonl` | `model/data/build_states.py` (git-ignored: licence) | `board_eval --qa`, `judge_boards` |
| `datasets/aac-setting-turns/` | in git | setting_eval, judge_boards `--history same/off` |
| Python: `numpy onnxruntime transformers sentence_transformers` (+ `torch` for `--ckpt`) | the user's venv/conda — `/usr/bin/python3` has none of them; ask which python to use | all |
| `claude` CLI on PATH | judge_boards shells out to `claude -p` as the judge (no API key needed) | judge_boards |

Arguments: `$0` = model dir, `$1` = ONNX path, `$2` = optional run name for labelling. If they are missing, ask
rather than guessing a path.

## Paths: override with env, never edit the scripts

- `board_eval.py` and `setting_eval.py` read **`BOARD_MODEL_DIR`** and **`BOARD_ONNX`** from the environment
  (`setting_eval` also takes `--model-dir`/`--onnx`). Their defaults (`model/site/public/model`,
  `model/export/out_v31/…`) do not exist in this checkout, so always export both.
- `board_eval.py` reads the tokenizer name from `BOARD_TOKENIZER`, else `extended_vocab.json` next to the ONNX,
  else `HuggingFaceTB/SmolLM2-135M-Instruct`; it also loads `web-client/public/folders.json` relative to the
  repo, so run it from this checkout.
- `evaluate_run.sh` (the whole Modal-run pipeline: fetch checkpoint → export → chunk → retrain reranker → all
  evals) hardcodes **`WORK=${WORK:-$HOME/work4/aac}`** and **`REPO=${REPO:-$HOME/work3/ai_aactalk}`** — pass
  them on the command line: `WORK=/path/to/work REPO=/Users/jeremysihan/aac sh model/eval/evaluate_run.sh <run>`.
  It expects `$WORK/train/out/<run>/card_model.pt` and writes to `$WORK/export/out_<run>` and
  `$WORK/site/model_<run>`.
- `judge_boards.py` hardcodes `WORK = ~/work4/aac` with **no env override**; its `--models` specs are
  `name=model_dir:onnx_dir[:alpha]` joined onto `WORK` with `os.path.join`, so **absolute paths bypass it**
  (`onnx_dir` is a directory; the script appends `card_model_fp16.onnx`).

## Recipe

```bash
cd /Users/jeremysihan/aac/model
export BOARD_MODEL_DIR="$0" BOARD_ONNX="$1"      # from the skill arguments
RUN=$2; export OUT=/private/tmp/model-eval-${RUN:-candidate}; mkdir -p "$OUT"     # $2 = optional run name

# 1. question bank (80 questions, 8 settings, board built exactly like the web app). --no-md = do not rewrite
#    docs/ or eval/board_eval_results.json; capture stdout instead. Last line: "VARIANT ...: pass N/80  content-only M/80"
python3 eval/board_eval.py --no-md              | tee "$OUT/bank.txt"        | tail -1
python3 eval/board_eval.py --no-md --rerank     | tee "$OUT/bank_rerank.txt" | tail -1     # reranker on (off by default in the apps)

# 2. held-out corpus questions (needs data/states/*.jsonl). --qa N = N first-card states; --qa-file picks the split
python3 eval/board_eval.py --no-md --qa 400                                          | tail -1   # test_qa.jsonl (adult-heavy)
python3 eval/board_eval.py --no-md --qa 400 --qa-file data/states/test_qa_youth.jsonl | tail -1
python3 eval/board_eval.py --no-md --qa 400 --qa-file data/states/test_gen.jsonl      | tail -1

# 3. setting conditioning: prints "setting sensitivity : x.xxx" and "setting precision : x.xxx" (no JSON output)
python3 eval/setting_eval.py --model-dir "$BOARD_MODEL_DIR" --onnx "$BOARD_ONNX" --dataset ../datasets/aac-setting-turns | tee "$OUT/setting.txt"

# 4. blind judge, candidate vs the shipped model, with history the way users see it (the v7 decision was made on
#    --history off/same/live). --n = questions per gate (youth, gen); --out = where the verdict rows go.
python3 eval/judge_boards.py --models shipped=/abs/shipped_model_dir:/abs/shipped_onnx_dir cand="$BOARD_MODEL_DIR":"$(dirname "$BOARD_ONNX")" \
    --n 50 --history off --out "$OUT/judge_history_off.json"
```

Other real flags, if the user asks for an ablation: `board_eval.py --panel 15,3,3 --no-routing --no-quick
--no-pins --all-folders --max-folders N --mass X --mass-mode p|rank --more N --row-thresh X --row-mass X
--prior-alpha A --bank FILE --md FILE`; `setting_eval.py --k N --show N --ckpt PT --backbone NAME`;
`judge_boards.py --seed --per-call --workers --timeout`.

To regenerate the committed artefacts on purpose (only when the user says the candidate is the new shipped
model): `python3 eval/board_eval.py` **without** `--no-md` rewrites `model/eval/board_eval_results.json` and
writes the markdown to `--md` (default `model/docs/BOARD-EVAL.md`, which does not exist — pass
`--md ../docs/BOARD-EVAL.md` for the real one); `judge_boards.py` defaults `--out` to
`model/eval/judge_boards_results.json`.

## Diff against the committed results

Committed files in `model/eval/`: `board_eval_results.json` (one row per bank question: `setting, q, status
direct|folder|miss, direct[], via_folder[], best_rank, board{}, top_expected`), `judge_boards_results.json` and
`judge_boards_{history_off,history_same,prior}.json`, `judge_v5_v7_history_*.json` (rows: `gate, setting,
question, model, cards[], answerable 0-2, plausible /9, filler /9`), `reranker_results.json`, `baselines_results.json`.

Per-question bank diff — the JSON is only written on a run **without** `--no-md`, and always to the hardcoded
`model/eval/board_eval_results.json` (the committed copy), so run once with `--md`, move the result aside and
restore the committed file before diffing:

```bash
python3 eval/board_eval.py --md "$OUT/bank.md" | tail -1
mv eval/board_eval_results.json "$OUT/board_eval_results.json" && git checkout eval/board_eval_results.json
python3 - <<'EOF'
import json, os
old = {(r['setting'], r['q']): r for r in json.load(open('eval/board_eval_results.json'))}
new = {(r['setting'], r['q']): r for r in json.load(open(os.environ.get('OUT', '/private/tmp/model-eval-candidate') + '/board_eval_results.json'))}
rank = {'direct': 2, 'folder': 1, 'miss': 0}
for k in sorted(old):
    a, b = old[k]['status'], new.get(k, {}).get('status', '?')
    if a != b: print('%-8s %-45s %s -> %s  (best rank %s -> %s)' % (k[0], k[1][:45], a, b, old[k]['best_rank'], new.get(k, {}).get('best_rank')))
print('regressions:', sum(1 for k in old if rank.get(new.get(k, {}).get('status'), -1) < rank[old[k]['status']]))
EOF
```

Judge diff — mean `answerable`, share of `answerable == 2`, mean `plausible`, mean `filler` per `model × gate`,
candidate vs the committed file for the same `--history` setting (the script prints this table itself; recompute
it from the JSON for the committed file).

Baselines to beat (from `evaluate_run.sh`'s header and `docs/DISTILLATION.md` "Results"): bank **80/80**
(content-only 74/80), held-out `test_qa` **332/371**, youth 203–206/400, generated 371–376/400, setting
sensitivity 0.519 (v31) / precision 0.473 (v5/v7), judge "fully answerable" v7: 78% corpus / 100% generated with
off-topic history. Report every number side by side with the committed one, and say plainly which moved.

## Do not

- Edit `evaluate_run.sh`, `judge_boards.py` or the committed results JSON to make paths work — env and
  absolute paths cover every case above.
- Upload or deploy anything (`site/upload_model.sh`, `site/deploy_model.sh`) — that is a separate, user-run step.
- Treat a single judge run as decisive: it samples questions (`--seed`) and an LLM judge; two runs differ by a
  few points.
