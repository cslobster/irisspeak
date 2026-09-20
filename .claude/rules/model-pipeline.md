---
paths:
  - "model/**"
  - "site/**"
  - "docs/**"
---
# Model pipeline, research site and docs/ index — loaded when a task touches `model/**`, `site/**` or `docs/**` (moved out of CLAUDE.md 2026-09-20)

## Model pipeline (`model/`) — only read when working on the model
```
model/vocab/   vocab.csv (3,238 cards, append-only ids; build_vocab.py, folders v2), README.md explains the curation
model/data/    ingest/map corpora → build_states.py (soft targets, 16 folder rows, choice augmentation) → distill_cards.py
               (teacher-distribution distillation, see docs/DISTILLATION.md); raw/mapped/states dirs are git-ignored (licence)
model/train/   train_smollm.py (card model), train_realiser.py, modal_train.py (Modal GPU)
model/export/  export_onnx_optimum.py (+ --mask), export_realiser.py, quantize_check.py (parity), Core ML variants for iOS
model/eval/    board_eval.py, judge_boards.py (blind LLM judge "could a child answer with these cards?"), reranker_e2e.py,
               setting_eval.py, results JSON committed
site/          chunk_model.py → upload_model.sh (MODEL_DIR=…) → R2; build_results.py / gen_charts.py for the paper pages
```
Shipped card model = **v7** (history-aware distillation, 2026-09-15; judged better than v5 in every
condition). The reranker + MiniLM path is retained but off by default (ablation showed the distilled
model doesn't need it). Realiser is a separate SmolLM2-135M fine-tune. Full recipes and status logs:
`docs/PLAN-RETRAIN.md`, `docs/DISTILLATION.md`, `docs/BOARD-EVAL.md`.

## docs/ index (read only what the task needs)
`PLAN-RETRAIN.md` v3 retrain + folder-row design · `DISTILLATION.md` teacher distillation & v7 ·
`BOARD-EVAL.md` evaluation method/results · `QUESTION-BANK.md` how `questions.json` was mined ·
`PLAN-DATA-TRAINING.md`, `PLAN-EXPERIMENTS.md`, `PLAN.md` earlier plans · `PLAN-MERGE.md` how
irisspeak.org became irisspeak.com · `IRIS-SPEAK-V2-DESIGN.md` v2 design · `FOLDER-RESEARCH.md`,
`CARD-DISPLAY-RESEARCH.md`, `CONTEXT-PICKER-RESEARCH.md`, `COMPETITIVE-ANALYSIS.md` research ·
`prd-corpus-expansion.md`, `prd-personalization-core.md` PRDs from the cloud-LLM era (partly
superseded; custom words/profile/history personalisation are built) · `API-BACKEND.md` points here ·
`proposal.html`, `system.svg` diagrams. `CONTEXT.md` = domain glossary for the current on-device design.

