# Experiment plan: testing the hybrid AAC next-card proposal

Goal: decide, with numbers, (a) which local model to ship, (b) whether the cloud planner earns its cost,
and (c) how far the whole system sits from a frontier cloud model used directly. Everything runs on the
vocabulary in `vocab/vocab.csv` (3,094 cards, version in `vocab/registry.json`).

## 1. Systems under test

| id | system | what it is | role |
|---|---|---|---|
| S0 | Static board | CBoard Classic layout, no prediction, user navigates categories | floor every AAC user already has |
| S1 | Frequency | global unigram + personal counts + setting boost, no partner text | cheapest possible predictor |
| S2 | MiniLM bi-encoder | 22M sentence encoder; partner vector · card table + prefix bigram | CPU-only fallback and the floor a pretrained LLM must beat |
| S3 | SmolLM2-135M-Instruct | 135M decoder (576 hidden, 30 layers, Apache 2.0) with 3,096 card tokens, sliced 3,095-row head, pruned input embeddings, KV cache per tap; stock q4f16 ONNX 117 MB, ≈80 MB after pruning | primary local model |
| S4 | Gemma 3 270M | same recipe; 273 MB q4f16 because of its 262k vocabulary | step-up if S3 leaves recall on the table |
| S5 | Qwen2.5-0.5B | same recipe; 483 MB | upper local candidate; local planner backend |
| S6 | S3 + cloud planner | SmolLM2 scoring + planner boosts from gpt-5.6-luna (cloud/planner.py) | the hybrid proposal |
| S7 | S4 + cloud planner | same with Gemma local | hybrid, larger local |
| S8 | Frontier direct | gpt-5.6-luna asked for 16 cards directly, Structured Outputs, effort medium; measured 12.3 s | quality ceiling and cost/latency reference |
| S9 | S3 + local planner | SmolLM2 scorer with Qwen2.5-0.5B as planner, all in browser | privacy-preserving alternative to S6/S7 |

Decision rules: S3 must beat S2 by ≥ 8 points unseen-question Recall@16; S4/S5 must beat S3 by ≥ 5 points to
justify 2 to 4 times the download; every shipped model keeps top-100 overlap ≥ 0.97 after quantisation and
embedding pruning. The GRU from earlier drafts is dropped: with 1,113 of 3,094 cards never seen as targets in
the real data, a model trained from scratch cannot rank the tail, and a pretrained 135M model can.

Every system shares the slate policy (fixed safety cells, position stability) so differences come from
ranking only. Every system exposes the same interface: `(profile, setting, history, partner, prefix) ->
ranked card ids`, which is what makes the comparison fair and the replay harness simple.

## 2. Training data: cleaning and preparation

Inputs are the files produced this session: `data/processed/*.jsonl` and `data/mapped/*.jsonl`.

### 2.1 Cleaning steps (script: `data/build_states.py`, to write)

1. Drop mapped rows with coverage < 0.85 or more than 8 cards (already applied by `map.py`).
2. Drop AAC Conversations rows whose `target_text` contains any of the top 30 topic-bias tokens
   (diversity, cultural, community, multicultural, festival, unity, tradition ...) unless the partner turn
   also contains them. Expect to lose about 8 percent of that corpus.
3. Replace `<name>` slots with a `<name>` card id; personal names never enter the vocab.
4. Deduplicate exact (partner, target) pairs across sources.
5. Turk: skip a turn's partner context when the previous turn is empty (removed by the filter); those become
   no-question states.
6. Cap any single card at 2 percent of all next-card targets by down-sampling states (prevents yes/no
   dominance).
7. Attach a setting label: from `scene` for AAC Conversations (keyword map to the 8 settings), from a
   keyword heuristic for Turk, `unknown` for AACText.
8. Expand every accepted utterance into per-prefix states with soft targets, as shown in the samples.
9. Partner dropout: mark 25 percent of states with a partner turn as no-partner duplicates.

### 2.2 Expected sizes after cleaning

| source | accepted utterances | approx. states |
|---|---|---|
| AAC Conversations train | ~5,500 after topic filter | ~30k |
| Turk train + dev turns | ~2,900 | ~16k |
| AACText train + dev | ~4,700 | ~18k |
| synthetic (Claude, reviewed sample) | 25,000 conversations, ~75k AAC turns | ~350k |
| total | | ~410k states |

The synthetic set is generated only after the three real corpora are cleaned, seeded from their partner
turns and scenes, with personas, and written directly as card ids with 3 to 6 acceptable sequences each.
Validation rules: ids exist, <= 6 cards, no repeats, weights sum to 1, at least one core card per
conversation, per-card cap 2 percent.

### 2.3 Training recipes

| system | data | recipe | time |
|---|---|---|---|
| S1 | states | counts only | seconds |
| S2 | states | contrastive fine-tune of MiniLM, 2 epochs, in-batch negatives; card table encoded once | 20 min laptop GPU |
| S3 | states | GRU 128/256, AdamW 1e-3, 10 epochs, soft-target CE, partner dropout 0.25 | 30 min |
| S4 | states | full fine-tune bf16, card tokens mean-initialised, LR 2e-5 (1e-3 new rows first 300 steps), 3 epochs, batch 64 | 1 to 2 h on one 24 GB GPU |
| S5 | states | same as S4 | 4 to 6 h |
| S6/S7 | replay logs | learn blend weights a..e by logistic regression on dev replay | minutes |
| S9 | S5 checkpoint | Qwen prompted with the planner schema, no extra training | none |

Learned blend weights and the personal n-gram use only the dev split; test is never touched until the
final run.

## 3. Test data

Three fixed test sets, frozen before any training, stored under `data/test/`:

| set | content | size | measures |
|---|---|---|---|
| T1 held-out corpora | AAC Conversations en test (2,611 rows) + Turk test chains (217 dialogues) + AACText test (566), mapped the same way | ~1,800 accepted utterances, ~9k states | in-distribution next-card quality |
| T2 unseen questions | 10 percent of distinct partner questions removed from all training sources, plus 150 new parent/teacher/clinician questions written by hand and mapped | ~600 utterances | generalisation, the number that matters |
| T3 scripted dialogues | 40 multi-turn scenarios (5 per setting), 4 to 8 turns each, each AAC turn with 3 to 6 reviewed acceptable sequences | 40 dialogues, ~250 AAC turns | whole-system and human tests |

T3 is written by a speech-language professional or with one reviewing, covers request, refusal,
uncertainty, repair, social and feeling intents, and includes at least one turn per dialogue where the
"right" answer is "no", "nothing", or "I don't know". These dialogues are also the human-test scripts.

A fourth set, T4, is the personalisation probe: 5 synthetic user profiles with 200 logged utterances each,
generated so that each user has 30 favourite cards. It measures whether the personal layer learns.

## 4. Offline evaluation

### 4.1 Next-card metrics (T1, T2), per system

- Recall@1, @8, @16, @100 against the soft-target set; MRR.
- `<aac_end>` precision and recall.
- Split by: partner present vs absent; seen vs unseen question; setting.
- For S4/S5 also: top-100 overlap after 4-bit quantisation (>= 0.97 required).

### 4.2 Simulated-user replay (T1, T2, T3), per system

A scripted user holds a target sequence (the best acceptable one). At each step it taps the target card
if it is on the grid, otherwise it pays a search cost of 3 taps and inserts it. Report:

- taps per utterance (primary), search rate, time-to-first-grid, cards moved per step.
- for hybrid systems: planner calls per utterance, planner latency p50/p95, and the same taps-per-utterance
  with the planner switched off, so the planner's contribution is a subtraction.

Cloud responses are cached by (system, state) so replays are deterministic and reruns cost nothing.

### 4.3 Slate quality (T3)

NDCG@16 against graded labels, intent diversity (distinct intents on the grid, target >= 3), refusal and
repair reachable in one tap (must be 100 percent), unwanted-suggestion rate as judged in 4.5.

### 4.4 Personalisation (T4)

Run each profile's 200 utterances in order; report taps per utterance in the first 50 vs the last 50.
A working personal layer shows a drop; a broken one shows none or a rise in deletions.

### 4.5 Frontier-model comparisons (the "GPT-6 question")

Use the newest frontier model available at test time, and hold the model id fixed in the report. Three
distinct comparisons, because they answer different questions:

1. **Ceiling.** S8 (frontier direct, returns 16 cards) on T2 and T3. This is the quality ceiling; the
   gap between S7 and S8 in taps per utterance is the cost of running locally. Report S8's latency and cost
   per utterance alongside, since a 3-second grid is not a usable AAC product regardless of recall.
2. **Planner backend swap.** S6 with the frontier model as planner vs S6 with a mid-tier model
   (e.g. the small/mini tier) vs S9 with local Qwen as planner. Measures how much planner quality matters
   once a local scorer is in front of it.
3. **Judge.** The frontier model as a grader, blind to system identity, rates each displayed grid on T3
   for (a) contains an appropriate answer, (b) contains a way to refuse or repair, (c) contains nothing
   inappropriate for the profile. Agreement with the human reviewer on a 200-grid sample is reported so
   the judge is calibrated, not trusted.

Pass criterion for the proposal: S7 reaches at least 85 percent of S8's taps-per-utterance improvement
over S0 on T2, at under 150 ms per tap and under 2 calls per utterance.

## 5. Actual AAC dialogue tests

### 5.1 Wizard-free scripted sessions (before users)

Two team members run the 40 T3 dialogues live on a tablet: one plays the partner and speaks the scripted
turn, one uses the board to answer with the scripted intent. Record taps, time per turn, grid changes,
and every moment the user reached for a card that was not there. Do this for S3, S7, S8. This catches
latency and position-stability problems that replay cannot.

### 5.2 AAC user sessions

- 8 to 10 participants who use symbol-based AAC, with consent from them and, for minors, carers;
  clinician present.
- Each session: 6 scripted dialogues from T3 in the participant's typical settings, plus 10 minutes of
  free conversation with a familiar partner.
- Within-subject design: each participant uses the static board (S0), local-only (S3 or S4 depending on
  device), and hybrid (S7), in counterbalanced order.
- Measures: taps per utterance, words per minute, utterance completion rate, number of abandoned
  utterances, deletions, and a 5-item questionnaire (the board offered what I wanted; it felt predictable;
  I could say no easily; it moved things around too much; I would use this).
- Partner measure: the partner rates whether they understood the reply, per turn.
- Log everything locally; export only with consent.

Success: hybrid reduces taps per utterance versus static by at least 30 percent on scripted dialogues
without increasing abandoned utterances, and "I could say no easily" scores no worse than static.

### 5.3 Two-week home/school pilot

Three participants keep the device in local-only mode for one week and hybrid for one week. Measures from
the logs: taps per utterance trend, personal-card hit rate, search rate, planner call count and any
failures when offline.

## 6. Reporting

One table per test set with all systems as rows and the metrics above as columns, plus:

- device latency table (iPad, mid Android tablet, Chromebook WASM) for S3, S4, S5;
- cost per 1,000 utterances for S6, S7, S8;
- the ablation column "planner off" for hybrids;
- the frontier judge's agreement with the human reviewer.

## 7. Order of work and rough effort

1. Freeze T1/T2 splits; write the 150 hand questions and the 40 T3 dialogues; review (1 week).
2. `data/build_states.py`, cleaning, state files, synthetic generation and validation (1 week).
3. S1, S2, S3 trained and replayed; blend weights fitted (3 days).
4. S4, S5 trained, exported, quantisation parity, device latency (1 week).
5. Planner contract, caching, S6/S7/S9 replay; frontier ceiling S8 and judge (4 days).
6. Scripted live sessions, then AAC user sessions (2 to 3 weeks including recruitment).
7. Pilot and report (3 weeks).
