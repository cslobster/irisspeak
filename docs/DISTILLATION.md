# Distilling a large model into the 135M card model

Written 15 Sep 2026.

## What the student actually has to do

The card model is not a chatbot. At each step it produces one distribution over ~3,300 card rows, and the board
shows the top nine. A family never sees a single "answer"; they see a *set*. So the quantity worth transferring
from a large teacher is the distribution, not a sampled reply.

That makes the objective unusually convenient, because `train/train_smollm.py` already optimises

```python
loss = -(T * F.log_softmax(logits, 1)).sum(1).mean()
```

against a soft target `T`. Cross-entropy to a fixed teacher distribution differs from KL only by the teacher's
own entropy, which has no gradient. **Supplying `T` from a teacher turns the existing trainer into a
distillation trainer with no change to the training code.** Only the data changes.

## Why the model needed this at all

Asked "What do you want to do?" with the setting set to play, the shipped model ranked *coffee* 10th and *a
ball* 2396th. The reranker cannot repair that: it only rescores the model's top 100.

The cause was the training data, in two layers.

| | |
|---|---|
| Setting coverage | 51.6% of states unlabelled, 36.8% home. Play 1.2%, school 1.1%, doctor 0.9%, selfcare 0.3% |
| Setting labels on synthetic rows | assigned with `rng.choice()`, uncorrelated with content |

The second is worse than the first. 5,276 rows told the model that "Setting: X." predicts nothing, so it
learned to ignore the token. That line is now fixed: prompts that are not tied to a place are labelled
`unknown`, which is the honest label.

## Why the knowledge had to come from a teacher

Before generating anything we looked for the association "a ball belongs to play" inside the project. It is not
there, and all three measurements are in the dataset README:

- **PMI over the setting-labelled corpus** returns *football* → transport and *book* → doctor. School has 95
  target observations and play 93; *ball*, *swing*, *lego* and *homework* have none.
- **Embedding similarity to each setting's mined questions** works where the questions are content-rich
  (selfcare, restaurant) and collapses where they are generic. "What do you want to do?" carries no play
  semantics; play words scored *below* the distractors.
- **Folder-to-setting embedding** is reliable for the first two entries and noise below (*toys* → restaurant).

So the teacher supplies world knowledge the corpus lacks. This is the one place it enters, and it enters as
training data, never as a runtime lookup.

## The two data recipes, and why both exist

**Sequence-level (`datasets/aac-setting-turns/`).** The teacher writes whole turns: a question for a setting
and the 1-4 cards a child taps. Generated four ways: free-form per setting, one pass per question in the app's
mined bank, a question-type sweep (who / where / when / how many / either-or / yes-no / repair), and a
vocabulary-coverage pass that hands over cards nothing has used yet. This gives breadth of *questions* and is
released as a standalone dataset.

**Distribution-level (`model/data/distill/targets.jsonl`).** For each state — setting, question, and the cards
already tapped — the teacher returns the twelve most likely next cards *with weights*, plus `END` when stopping
is likely. Mapped onto card ids and renormalised, that is `T` directly.

The second is the real distillation and is far more efficient per teacher call: one call yields a twelve-card
distribution instead of one path through it. The first still matters, because it is what supplies the diverse
*questions* that the distillation states are built from.

## Choices worth recording

- **Prefix depths.** States are distilled at prefix 0, 1 and 2, because the app re-predicts after every tap.
  Empty-prefix states are generated first, so a run cut short still covers every question.
- **Temperature.** `--distill-temperature` reshapes the teacher before normalising. Above 1 softens it, which
  spreads mass onto the tail the board's lower rows draw from; below 1 sharpens toward the teacher's top pick.
  Default 1.0, i.e. the teacher's own weights.
- **Dropping unmappable mass.** Teacher words with no card are dropped and the rest renormalised. A state is
  kept only if at least three cards survive, so a state answered mostly in words this board lacks never becomes
  a target.
- **The dead-row mask is an output, not a constraint.** `--mask-dead` removes rows that are never a training
  target, which is why 1,335 of 3,286 cards were unreachable. Distilled states name them as targets, so they
  come back automatically. The current data revives 586, including *ball*, *bubbles*, *backpack* and *crayon*.
- **Every row carries `origin`**: `corpus`, `synthetic`, `generated` or `distilled`, so any result can be
  attributed and any slice can be ablated.

## Rebuilding and retraining

```sh
python3 data/build_states.py --out data/states \
    --setting-turns ../datasets/aac-setting-turns \
    --distill data/distill/targets.jsonl
python3 train/modal_train.py --runs "distill_v1=HuggingFaceTB/SmolLM2-135M-Instruct"
python3 eval/board_eval.py --no-md          # bank, expects 80/80
python3 eval/board_eval.py --no-md --qa 400 # held-out corpus, expects 332/371
```

## Results (15 Sep 2026)

All boards scored model-only, no reranker, no pinned answers, the app's defaults on the `simplify-board` branch.

### Automatic gates

| Run | What changed | Bank (80) | Corpus, all (371) | Corpus, youth (245) | Generated, held out (400) | Setting sens. | Setting prec. |
|---|---|---|---|---|---|---|---|
| shipped v31 | | 80 (74) | **332** | **216** | 273 | 0.519 | 0.185 |
| v1 | generated + distilled, weight 1.5 | 80 (77) | 309 | | | 0.853 | 0.538 |
| v2 | generated weight 0.7, 8k distilled | 80 (78) | 311 | | | 0.809 | 0.483 |
| v3 | generated confined to starved settings | 80 (78) | 324 | 209 | | 0.839 | 0.479 |
| v4 | + audience filter (no Turk, no adult cards) | 80 (78) | 295 | 204 | 375 | 0.834 | **0.485** |
| **v5** | + conversational pass, gated (519 states) | 80 (78) | 300 | 206 | 371 | 0.835 | 0.474 |
| v6 | conversational pass ungated (1,379 states) | 80 (78) | 282 | 191 | 369 | 0.796 | 0.411 |
| teacher, live | the large model's own top cards | **80** | | **110** | 298 | | |

Bank numbers are pass (content-only). Generated-gate numbers are on the final held-out set, which includes held-out
conversational questions; v1-v3 predate it. Setting sensitivity is how much the board changes when only the setting
token changes; precision is the share of board cards whose teacher association is that setting (chance 0.143).

### What the gates measure, learned the hard way

- **The bank is saturated.** Every model scores 80.
- **The corpus gates reward imitation of adult first-card habits.** The teacher, answering the corpus questions
  live, scores 110/245 with boards like *Good, Tired, Happy, Okay, Sad, Hungry* against a gold of *Feel*, and
  *Long, Week, Day, Hour* against a gold of *Few*. Those are better boards for a child than the gold. The students
  learned the habits from 57k corpus rows, which is why they beat the teacher there by a hundred questions and why
  the distilled students sit ten below the shipped model. That gap is the student moving toward the teacher's
  boards. It is not a quality regression for the audience.
- **The generated gate rewards covering one sampled answer.** The student beats the teacher on it (375 vs 298)
  because it has absorbed thousands of teacher samples plus the corpus, and because its board carries a folder tile.

### Blind judge

120 questions (60 corpus youth, 60 held-out generated), each model's nine cards shown to a judge that cannot see
which model made them. Answerable: 0 = no reasonable reply possible, 2 = a natural specific reply is right there.

| Model | Gate | Answerable (0-2) | Plausible cards /9 | Filler cards /9 | Fully answerable |
|---|---|---|---|---|---|
| shipped | corpus youth | 1.72 | 4.9 | 3.1 | 72% |
| v4 | corpus youth | 1.78 | 5.6 | 1.9 | 80% |
| **v5** | corpus youth | **1.82** | **5.8** | **2.0** | **83%** |
| shipped | generated | 1.07 | 3.2 | 4.0 | 27% |
| v4 | generated | 1.87 | 6.7 | 0.2 | 90% |
| **v5** | generated | **1.92** | **6.7** | 0.4 | **92%** |

Judged blind, v5 is better than the shipped model on the corpus questions too, where the automatic gate had it
worse. This is the number that answers "are the cards good enough".

### The reranker and the pins

Ablated on v4 across bank / youth / generated: model only 80/203/378, 13-feature reranker 80/204/378, 54-feature
reranker 80/204/378, full reranker with the school and doctor pins off 80/204/377. v5 and v6 agree (identical
with and without). The reranker is off by default and its assets no longer load; the pins are gone. Branch
`simplify-board`, to merge with the model swap, not before it (main auto-deploys).

### v6, a negative result

Ungating the conversational pass added 860 home-labelled states whose answers are yes, okay, later, I don't
know. The model learned to reach for generic replies and every gate fell: youth 206 -> 191, precision 0.474 ->
0.411. The gated version (v5, 519 states in the six starved settings) is the useful amount.

### Open: panel crowding

The model emits one distribution; the app buckets it into Topic 9 / Action 6 / Feeling 3 by card category, so a
panel is the best-ranked cards of that category. Cards the teacher treats as safe everywhere accumulate a large
prior: over 120 questions *Tired* is in v5's Feeling panel 53% of the time (v6 64%) and *Wait* leads its Action
panel at 39%. The shipped model has the same disease in another form (*Feel* 41%, *Need* 51%). Under test: rank
by log p(card | state) - alpha * log prior(card), the model's own training-target frequency, no word list
(`board_eval.py --prior-alpha`).

### Deployed 15 Sep 2026: v5

Model-only with prior debiasing (alpha 0.5) and no pinned answers, on R2 as `v5/`; irisspeak.com bundle verified fetching 11 v5 chunks and no reranker assets; 162 ms per prediction.

**Found at deploy: history.** Every evaluation above used an empty Earlier: block. The live prompt carries the account's last two turns, and every generated/distilled training state had none, so off-topic history dominates the setting: the play board for "What do you want to do?" echoed the previous turns (Fix, Talk, Just). Reproduced offline exactly; with play-relevant history the board is right (Park, Slide, Swim, Swing). v7 trains with an Earlier: block on half the generated states, 40% of them off-topic, and `judge_boards.py --history off|same|live` now measures boards the way users see them.

**Judged with history (the deploy stands).** Boards built with an Earlier: block, the way the app sends them,
shipped v31 against live v5, blind, 50 corpus-youth and 50 generated questions each:

| History | Model | Corpus: fully answerable | Generated: fully answerable | Filler /9 (corpus) |
|---|---|---|---|---|
| off-topic | shipped | 68% | 56% | 2.7 |
| off-topic | **v5** | **78%** | **92%** | **1.7** |
| same-setting | shipped | 57% | 43% | 2.7 |
| same-setting | **v5** | **79%** | **90%** | **1.9** |

So the history echo is a weakness relative to v5's own no-history boards, not relative to what was live before.

### Candidate before that finding

**v5**, model-only, with the board simplification. Deploy is `sh site/deploy_model.sh distill_v5 v5` (asks
before uploading; `--rollback v31` restores), then merge `simplify-board`. The iOS app bundles its own Core ML
model and is a separate release.

## How to tell whether it worked

The bank and held-out numbers guard against regression; they do not measure the thing being fixed, because
neither contains setting-varied questions. The direct check is the board itself:

```sh
python3 eval/inspect_question.py "What do you want to do?" --setting play --watch ball park swing lego
```

Success is *ball*, *park* and *swing* arriving in the model's own top ranks, with no route pinning them. That is
also the condition for deleting the hard-coded school-subject route from `web-client/src/api/local.ts`,
`ios/.../LocalApi.swift` and `model/eval/board_eval.py`.
