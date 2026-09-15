# Data, model, training, and evaluation plan

Companion to `PLAN.md`. Vocabulary: `vocab/vocab.csv` (3,038 cards, version in `vocab/registry.json`).

## 1. Training data

### 1.1 What a training example is

One **state** = (profile header, partner turn or none, last two dialogue turns, selected-card prefix)
and a **soft target** over 3,038 cards + `<aac_end>`. Every conversation turn expands into one state per
prefix position. Datasets are stored as JSONL:

```json
{"conv_id":"turk_0421","turn":2,"profile":{"age":"adult","setting":"home"},
 "partner":"Would you like to sit down?","history":["..."],
 "prefix":["card_0187"],
 "targets":{"card_0409":0.6,"card_0301":0.3,"card_0188":0.1},
 "acceptable_sequences":[["card_0187","card_0409"],["card_0301"]],
 "source":"turk_dialogues","review":"unreviewed"}
```

### 1.2 Sources, in priority order

| source | what it gives | size | licence | status |
|---|---|---|---|---|
| Vertanen Turk dialogues (`data/raw/turk_dialogues`) | invented two-sided dialogues, 6 turns, train/dev/test split by chain; filtered version (1,155 dialogues, offensive content removed) is the training corpus, unfiltered (1,420) kept raw | 1,155 filtered chains, ~6.9k turns | **CC BY-ND 3.0 per readme** (not CC BY 4.0): fine to train on, do not publish derived dialogue text | downloaded, ingested |
| aactext "imagine" corpus (`data/raw/aactext_imagine`) | AAC-like standalone utterances, no partner turn; used for the no-question mode and for vocabulary frequency | 6,141 sentences, worker-level split | CC BY 4.0 | downloaded |
| willwade/AACConversations (Hugging Face) | GPT-generated scenario dialogues; every row is an AAC-user utterance with scene, context turns, intended vs typed text; English kept for en-US/GB/CA/AU/NZ/ZA | 10,218 train + 2,611 test English rows; 89.5% have a partner utterance | CC BY 4.0, gated (accepted with the user's HF account) | downloaded, ingested |
| DailyDialog | everyday two-party dialogues, good source of partner questions and short replies | 13k dialogues | CC BY-NC-SA 4.0 (research only) | to download |
| Synthetic (Claude) | persona-conditioned dialogues written directly as card sequences with multiple acceptable answers | target 25k conversations | ours | to generate |
| Cboard public boards | phrase priors and category structure | n/a | CC BY | optional |

Do not use the two restricted test files in the aactext zip (Switchboard, Venkatagiri comm) for training.

### 1.3 Mapping English to card sequences

`data/map.py` (to write) converts an English utterance to card sequences:

1. Normalise: lowercase, expand contractions with the same table as the vocab builder, lemmatise.
2. Longest-phrase-first match over `label` and `aliases`. For every composable phrase card also emit the
   expanded variant (see `vocab/README.md`). Enumerate all variants as `acceptable_sequences`.
3. Drop function-word residue that has no card (articles, "please" is a card, "the" is core so it maps).
4. Coverage = mapped content words / content words. Keep examples with coverage >= 0.85, put the rest in
   `data/unmapped.jsonl` with the missing concepts. That file is the vocabulary backlog.
5. Telegraphic compression: AAC users say "want pizza" not "I would like some pizza". Produce a
   compressed variant by dropping determiners and politeness fillers, keep both as acceptable.

Measured with `data/map.py` on 2026-09-01 (vocab version 202e136b586a, coverage gate 0.85, max 8 cards):

| corpus | utterances | accepted | mean coverage | main rejection causes |
|---|---|---|---|---|
| aactext imagine | 6,142 | 83.7% | 0.944 | slang, names, misspellings |
| Turk dialogues (filtered) | 6,521 | 61.6% | 0.919 | 1,419 turns need more than 8 cards; 1,086 low coverage |
| AACConversations en train | 10,218 | 58.6% | 0.876 | long sentences; names; topic bias ("diversity", "cultural", "community") |
| AACConversations en test | 2,611 | 57.6% | 0.877 | same |

Rejected turns are still useful as partner turns and as history. Names are mapped to a `<name>` slot,
which the personal-cards layer fills at run time. Accepted sequences skew long (mode 5 cards); the
telegraphic compression variant and the `<aac_end>` states matter for realistic tap counts.

Pipeline commands:

```
python3 data/ingest.py                      # resumable; prints HF gating instructions if needed
python3 data/map.py --in data/processed/turk_dialogues_turns.jsonl --text-field utterance \
    --out data/mapped/turk_dialogues_turns.jsonl
python3 vocab/build_vocab.py --lists vocab/sources/obf_lists --scratch <scratch> \
    --out vocab --registry vocab/registry.json   # after adding backlog words from *_unmapped.jsonl
```

### 1.4 Synthetic generation

Generate with Claude, one call per scenario, output JSON only. Prompt inputs:

- The full card list as `id: speak` lines, grouped by category (about 25k tokens, cache it).
- A persona: age band (child / teen / adult), setting (home, school, clinic, community), 3 interests,
  literacy level, and a communication style (single-card, telegraphic, phrase-card user).
- A scenario seed from the Turk or DailyDialog partner turns, or a scene type (mealtime, pain, choice
  between two options, greeting, refusal, repair after misunderstanding, user-initiated request).
- Instruction: write 4 to 6 turns; partner turns in English; AAC turns as card-id sequences only;
  for each AAC turn give 3 to 6 acceptable sequences with a weight, covering at least one request,
  one refusal or negative, one uncertain or repair reply where natural.

Validate every output: ids must exist, sequences <= 6 cards, no repeated card, weights sum to 1. Reject
conversations where the AAC user never uses a core card, and cap any single card at 2 percent of all
targets to stop "yes" and "no" from dominating.

### 1.5 Review

A speech-language professional reviews a stratified sample of 400 states (by intent and source) and
marks each acceptable sequence as acceptable / plausible / wrong. Report agreement. Use the reviewed
subset as the graded-label source for the reranker (3 reference, 2 acceptable, 1 plausible, 0 wrong).

### 1.6 Splits

Split by conversation and by persona. Hold out 10 percent of partner questions entirely so unseen-question
recall is measurable. Turk dialogues keep their published train/dev/test chains.

## 2. Model choice

Benchmark three candidates on the same data, in this order:

| model | role | why |
|---|---|---|
| MiniLM-L6 bi-encoder + card table (22M) | floor and WASM fallback | context embedding dot card embedding, plus a prefix GRU; trains in minutes |
| Qwen2.5-0.5B-Instruct | primary | proven transformers.js export, tied embeddings, 896 hidden |
| Gemma 3 270M | small alternative | 100M transformer + big embedding table, very fast per step |

Decision rule: the LLM must beat the bi-encoder by >= 8 points unseen-question Recall@16, else ship
the bi-encoder first and keep the LLM as the WebGPU-only upgrade.

## 3. Training the candidate model

### 3.1 Tokens and head

- Add 3,038 card tokens plus `<aac_start>`, `<aac_end>`. Initialise each card embedding from the mean of
  Qwen's token embeddings of its `speak` form; composable cards average that with their components.
- Loss is computed only at card positions. Logits are restricted to the 3,039 card rows.
- After training, slice the 3,039 rows into a separate output head for export. Keep the full input
  embedding table for partner text.
- Ablation: atomic card tokens in the prefix versus plain-text prefix (`speak` forms joined by commas).

### 3.2 Prompt format

```
<|profile|> age: child; setting: school; likes: dinosaurs, lego, swimming
<|partner|> What do you want for lunch?
<|history|> partner: Did you have a good morning? | user: yes
<|aac|> <aac_start> <card_0187> <card_0409>   -> predict next card or <aac_end>
```

Sample the profile header from the persona; drop it entirely for 20 percent of examples so the model works
without one. Drop the partner turn for the no-question mode (about 25 percent of states).

### 3.3 Hyperparameters (starting point)

| setting | value |
|---|---|
| fine-tune | full, bf16, AdamW, no quantisation during training |
| learning rate | 2e-5 backbone; 1e-3 for new embedding and head rows for the first 300 steps, then 2e-5 |
| batch | 64 states, sequence length <= 384 |
| epochs | 3, pick by dev Recall@16 |
| loss | cross-entropy against soft targets; label smoothing 0.05 over card rows only |
| end token | weight 1.5 on `<aac_end>` states (they are rarer than card states) |
| GPU | one 24 GB card, about 2 hours per epoch at 300k states |

### 3.4 Preference tuning (after SFT is solid)

Build pairs from the reviewed set: chosen = graded 3 or 2 sequence, rejected = graded 0 sequence sampled
from the SFT model's own top-100 (hard negatives). Run DPO with beta 0.1, one epoch, on the card positions
only. Compare against the soft-target SFT checkpoint; keep DPO only if unseen-question Recall@16 and
end-token accuracy do not regress.

### 3.5 GRPO (only if a named sequence metric is still short)

Reward on `expand(sequence)`:
`2.0 F1 + 1.0 valid_end + 0.5 brevity(taps) - 1.0 repetition - 1.5 off-intent - beta KL`.
Off-intent means the sequence intent class disagrees with every acceptable sequence's intent class.
Sample 8 sequences per state, 4 cards max. Stop when the metric moves or after 2k steps.

### 3.6 Export

ONNX, q4 weight-only for the transformer, fp16 for embeddings and the sliced head. transformers.js on
WebGPU with WASM fallback. Persist KV cache across steps, truncate on delete. Return hidden state at the
prediction position for the reranker. Parity test: top-100 overlap with the bf16 model >= 0.97 on 2k states.

## 4. Reranker and personalisation data

Run the SFT model over every training state and store its actual top 100 with log-probs. Features per
candidate: log-prob, rank, hidden·card_embedding, category, intent, core, safety, composable,
personal frequency (decayed), recency, rejection rate, already-in-prefix, shares-components-with-prefix.
Labels from 1.5. MLP 100x(24 -> 64 -> 1), listwise softmax loss over the 100 candidates, personal-feature
dropout 0.5 so cold start works. Export to ONNX.

## 5. Evaluation

### 5.1 Candidate model (teacher-forced states)

| metric | split | target |
|---|---|---|
| Recall@1 / @16 / @100 against any acceptable next card | seen / unseen questions | R@16 > 0.80, R@100 > 0.97 |
| MRR | same | report |
| `<aac_end>` precision and recall | all | > 0.90 |
| top-100 overlap after quantisation | all | > 0.97 |

### 5.2 Free-running sequences

Sample greedy and top-p sequences from the empty prefix. Report expanded-sequence F1 against the best
acceptable sequence, intent-class accuracy, repetition rate (< 2 percent), invalid end rate, mean taps.

### 5.3 Whole system with a simulated user

The simulated user has a target sequence. At each step it taps the target card if it is in the slate,
else it "searches" (cost 3 taps) and inserts it. Report **taps per utterance** and **search rate**, with and
without the reranker, and per grid size 16/24/36. This is the number that matters for AAC and it is the
one to put in a paper.

### 5.4 Slate quality

NDCG@16 against graded labels, intent diversity (distinct intent classes in the slate, target >= 3),
cards moved per step (<= 4 of 16), refusal and repair card reachable in one tap (100 percent).

### 5.5 Human evaluation

Ten sessions with AAC users or clinicians on scripted scenarios: task completion, taps, and a 5-point
"the board offered what I wanted to say" rating. Compare static Cboard layout versus predicted slate.

## 6. Order of work

1. `data/map.py` and the coverage gate; run it on Turk dialogues and aactext; read `unmapped.jsonl`
   and add missing cards to the vocab (rebuild with `--registry` so ids stay stable).
2. Request access to AACConversations; download DailyDialog.
3. Synthetic generation, validation, review sample.
4. Bi-encoder baseline, then Qwen SFT with soft targets, then the input-representation ablation.
5. Export and parity test in the browser.
6. Top-100 dumps, reranker, simulated-user evaluation.
7. DPO, and GRPO only on evidence.
