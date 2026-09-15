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

## How to tell whether it worked

The bank and held-out numbers guard against regression; they do not measure the thing being fixed, because
neither contains setting-varied questions. The direct check is the board itself:

```sh
python3 eval/inspect_question.py "What do you want to do?" --setting play --watch ball park swing lego
```

Success is *ball*, *park* and *swing* arriving in the model's own top ranks, with no route pinning them. That is
also the condition for deleting the hard-coded school-subject route from `web-client/src/api/local.ts`,
`ios/.../LocalApi.swift` and `model/eval/board_eval.py`.
