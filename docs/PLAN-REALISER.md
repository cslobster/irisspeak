# Cards → sentence: making the realiser sound like the child

Written 21 Sep 2026. Goal: when a child taps three cards, the app should say what *that child* meant, in a
child's own voice — "I learned math, it was fun" — instead of gluing the card words together or, worse,
answering with another question. Everything stays on the device.

## 1. What is actually shipping today (measured, not assumed)

Two code paths produce the spoken sentence:

| path | what it does | when it runs |
|---|---|---|
| `engine.realise()` (`web-client/src/engine/model.ts`) | joins the card words in tap order, capitalises, adds a full stop | until the realiser has loaded, and whenever the realiser returns nothing |
| `realiser.realise()` (`web-client/src/engine/realiser.ts`) | SmolLM2-135M fine-tune, 270 MB fp16 ONNX from R2 (`r1/`), greedy decode constrained to card words + function words | once loaded |

I downloaded the shipped ONNX and ran the two prompt forms over fifteen realistic taps. **Both are bad, in
different ways.**

Prompt as the *trainer* builds it (`Setting: …` line present):

| setting | partner asked | cards | shipped model says |
|---|---|---|---|
| school | What did you learn? | Math \| Fun | *What did you get out of it?* |
| school | How was school? | Friend \| Play \| Outside | *How was your friends playing outside?* |
| play | What do you want to play? | Ball \| Outside | *What do you want to do outside?* |
| restaurant | Do you want a drink? | Water | *Do you want a water or a can?* |
| school | Anything else? | Music \| Sing \| Happy | *Do you like music? Its happy.* |

It answers the partner's question **with another question** — the child's turn comes out as an interrogation.

Prompt as the *apps* actually build it (no `Setting:` line — see §2):

| cards | shipped model says | what the child meant |
|---|---|---|
| Math \| Fun | Math is fun. | I learned math. It was fun. |
| Friend \| Play \| Outside | So friends played outside. | I played outside with my friend. |
| Story \| More | **No story, just more.** | I want more story. |
| Tired \| No | **Not tired. Just tired.** | No, I'm tired. |
| Ipad \| Want | Ipad, please. I want to do it again. | I want the iPad. |
| Music \| Sing \| Happy | Music. Sing happy. | I sang and I was happy. |

Four of fifteen are acceptable ("Pizza, please.", "I need water.", "To the park.", "Arm hurt."). Two **invert the
meaning** — "No story, just more" for a child asking for another story is not a wording problem, it is the device
putting words in the child's mouth that contradict them. That is the most serious finding here.

## 2. Why it behaves this way

1. **The training data is adult corpus dialogue, not a child answering with cards.** `data/build_realiser.py`
   takes AACConversations, the Turk AAC dialogues and aactext, and pairs *the next turn of the conversation* with
   the cards that spell it. 58% of rows carry `setting: unknown`; the targets include things like "Oh joy. Nurse
   me back to life." and "He talks about her a lot. Smiles, too." The model learned to **continue a dialogue**,
   which is why it answers a question with a question, and why it narrates in the third person.
2. **Train/serve prompt mismatch.** `train/train_realiser.py` and `eval/realiser_eval.py` build
   `Setting: X.\nPartner: …\nCards: …\nSentence:`. Both apps (`realiser.ts:75`, `Realiser.swift:95`) omit the
   `Setting:` line. The model has therefore never seen, in training, the prompt it is asked to complete in
   production — and the setting, the one piece of context that would disambiguate "water" at a restaurant from
   "water" at the doctor, is thrown away at inference.
3. **The metric rewarded the wrong thing.** "Exact match against one reference wording" (0.29–0.39) scores
   copying the corpus's adult phrasing, and says nothing about first-person voice, meaning preservation, or
   whether the output is even an answer.
4. **No child register anywhere in the pipeline.** Nothing in the data, the prompt or the decode asks for short,
   first-person, present-tense, one-clause speech.

The constrained decode (card words + function words only) is *not* the problem and should stay — see §3.

## 3. Literature review

**Classic AAC telegraphic expansion.** [Compansion / McCoy et al.](https://aclanthology.org/W97-0503.pdf) parse
telegraphic input into a verb-argument semantic frame, then realise a surface sentence. Deterministic and
meaning-preserving, but needs a hand-built lexicon and breaks on anything outside the frames. The lesson that
survives: **expansion is a semantic-role problem, not a word-ordering problem** — "arm hurt" needs to become
"my arm hurts", which is a possessive and an agreement decision, not a shuffle.

**Keyword → sentence with a neural LM.**
[KWickChat](https://dl.acm.org/doi/10.1145/3490099.3511145) (IUI 2022) fine-tunes GPT-2 on bag-of-keywords plus
dialogue history and **persona tags**, and generates several candidates for the user to pick from. Two findings
we should copy: context (the partner's last turn) is what makes a keyword set interpretable, and a persona
conditioning signal measurably changes whose voice comes out.

**Context is the biggest lever.** Google's
[SpeakFaster](https://www.nature.com/articles/s41467-024-53873-3) (Nature Communications 2024) expands heavily
abbreviated input with an LLM conditioned on conversation context; field trials with eye-gaze users hit 29–60%
above baseline entry rate. Their ablations put most of the gain on conversational context, not model size — which
matters for us because our whole budget is a 135M model.

**Personalisation is cheap and effective.**
[Parameter-efficient personalisation for AAC text entry](https://arxiv.org/pdf/2312.14327) shows per-user tuning
of a small adapter beats prompt-only personalisation for abbreviation expansion. We do not need adapters yet, but
the conditioning signal (this child's earlier phrasings) is free: the app already stores history.

**LLM output does not sound like an AAC user.**
[Evaluating Human-LLM Representation Alignment for affective AAC sentences](https://arxiv.org/pdf/2503.11881)
(2025) finds LLM-written utterances are systematically **too formal, too verbose, and weak on first-person
voice** versus what AAC users actually say. This is exactly our failure mode, and it means "just prompt a bigger
model" would not fix it either — the target style has to be specified and trained for.

**Authenticity is a design constraint, not a nicety.** CHI work on AI in AAC
([identity and AAC voices](https://arxiv.org/abs/2605.24337), 2026;
[authorship and agency](https://eprints.whiterose.ac.uk/id/eprint/226916/1/AI-AAC-Risk-Rewards_AAM.pdf))
reports users' fear that "humanising" their words erases them — one participant noted no generated voice
"sounded autistic". Practical consequences we adopt: **never introduce a content word the child did not tap**
(our existing hard constraint — keep it), keep utterances short rather than polished, and **offer choices**
rather than one authoritative rewrite (the "Another" button already does this; it should offer genuinely
different framings).

**Method for getting the style we want.** Lexically constrained decoding
([AutoTemplate](https://arxiv.org/pdf/2211.08387) and the NeuroLogic line) is the standard way to guarantee the
keywords appear; we already do the vocabulary-mask version of this. For the *style*, the practical recipe in
2025–26 is distillation: have a large teacher write the target-style output for inputs drawn from the real input
distribution, then fine-tune the small model on it — the same pipeline `data/distill_cards.py` already uses for
the card model, with `claude -p` as the teacher.

### What the literature says to do here

1. Keep the hard lexical constraint. It is the authenticity guarantee, and it is cheap.
2. Condition on setting **and** partner question, and make training and serving use the identical prompt.
3. Fix the data, not the decoder: distil child-voice sentences for the card sequences children actually tap.
4. Add a persona signal from the child's own history (later; §6).
5. Evaluate meaning preservation and voice, not exact match against one adult wording.

## 4. The target style, written down

One sentence. At most about eight words. First person, present or simple past. Says the thing the cards mean, as
a child would say it to the person in front of them.

| cards | target |
|---|---|
| Math \| Fun | I learned math. It was fun. |
| Ball \| Outside | I want to play ball outside. |
| Arm \| Hurt | My arm hurts. |
| Story \| More | I want more story. |
| Tired \| No | No, I'm tired. |
| Water | I want water, please. |
| Friend \| Play \| Outside | I played outside with my friend. |

Rules the generator and the filter both enforce:
- no content word that no tapped card spells (existing `covered()` check, kept);
- polarity never flips: a "no"/"not" card must produce a negative sentence, and no "no" appears without one;
- one sentence, or two very short ones; no rhetorical questions unless the child tapped the question card;
- first person wherever the child is the subject; "my" for body parts and possessions;
- no adult idiom, no hedging, no politeness the child did not ask for beyond "please".

## 5. Plan

**Step 1 — data (the long pole).** `datasets/aac-setting-turns` already holds 13,555 real
`{setting, question, cards}` triples generated for the card model: exactly the tap sequences children make, across
all eight settings and every question in the app. What is missing is the sentence. A new generator
`model/data/gen_realiser_data.py` asks `claude -p` for **three** child-voice wordings per triple (one plain, one
with the first-person frame, one shorter/blunter), so the "Another" button has real alternatives. Target ~40k
pairs from the dataset, plus the corpus pairs that survive a stricter child-voice filter, so the model still
copes with card combinations nobody generated.

**Step 2 — prompt parity.** Trainer, eval, `realiser.ts` and `Realiser.swift` all build
`Setting: …\nPartner: …\nCards: …\nSentence:`. Ship the client change with the model, never before it
(`feedback-ship-app-with-model`).

**Step 3 — train.** Same SmolLM2-135M backbone and the same 270 MB fp16 export, so nothing about the app's
download budget changes. Modal, `train_realiser.py`, 2–3 epochs.

**Step 4 — evaluate.** New `model/eval/realiser_judge.py`: automatic checks (card coverage, no invented content
word, polarity preserved, is-an-answer-not-a-question, first-person rate, length) plus a blind Claude judge
comparing shipped vs new on held-out taps, the same pattern as `eval/judge_boards.py`.

**Step 5 — deploy.** `site/deploy_model.sh` for the realiser chunks (new `r2/` prefix), push the client prompt
change in the same step, verify in the browser.

**Step 6 (after it is live) — persona.** Add the child's own recent answers to the prompt as an `Earlier:` block,
the way the card model already uses history. This is the personalisation the literature supports, and the data to
train it already exists in `board_feedback` and the per-child history.

## 6. Success criteria

| | shipped | target |
|---|---|---|
| is an answer, not a question | 11/15 probes | 15/15 |
| meaning preserved (no polarity flip) | 13/15 | 15/15 |
| first-person where the child is the subject | rare | ≥ 80% |
| no invented content word | 0.993 | ≥ 0.99 (keep) |
| blind judge vs shipped, on held-out taps | — | new model preferred ≥ 65% |
| decode latency | 135 ms | ≤ 200 ms |

## 7. Baseline, measured (21 Sep 2026)

`eval/realiser_judge.py` over the fifteen probe taps, shipped model (`r1/`, 270 MB):

| prompt form | answer | polarity | covered | no-invented | first-person | words | ms |
|---|---|---|---|---|---|---|---|
| trainer's (`Setting:` line, what training and eval used) | **0.60** | 0.93 | 0.67 | 1.00 | **0.13** | 6 | 605 |
| the apps' (no `Setting:` line, what ships) | 1.00 | 0.93 | 0.87 | 1.00 | **0.33** | 3 | 293 |

The mismatch is doing real work: with the prompt it was trained on, two in five outputs are a question back at
the partner. The apps dodge that by accident, and pay for it with a model running off-distribution — third of
outputs in the child's own voice, a third of card taps not fully said.

## 8. One thing this plan does not fix

On a first visit the realiser is not loaded yet: it is 270 MB fetched from R2 in the background after the card
model, and until it arrives every sentence comes from `engine.realise()` — the plain card concatenation. So the
very first sentences a new family hears are the worst ones the app produces, whatever we do to the model.

Three ways out, none of them chosen yet:

1. **Make the model smaller** so it is there sooner — int8 weights would take 270 MB to ~70 MB. The card model
   already ships fp16; an int8 realiser needs a quality check of its own.
2. **Re-speak once it loads** — show the rule sentence, and quietly replace it with the model's when the model
   arrives, before the child presses Speak.
3. **A better rule.** Cheap, but it means hard-coded templates, which is the opposite of the direction asked for
   ("as little hard coded response as possible"), so it is listed last.

Worth deciding after the new model is measured, because option 1 changes the answer to "is the model good
enough to be worth waiting for".

## 9. Result: realiser_v4 (21 Sep 2026)

Trained on Modal (A100, SmolLM2-135M, 2 epochs, 938 steps, ~3 min) on 14,985 rows — 10,459 of them child-voice
sentences distilled from `claude -p` for the tap sequences in `datasets/aac-setting-turns`, the adult corpus
capped at half and reduced to its most child-like rows. Exported fp16 ONNX with KV cache: **270 MB, the same
download budget as the shipped model**.

**Fifteen hand-written kid taps** (neither model trained on them; each model in the prompt form that suits it
best — new with the `Setting:` line, shipped without, since that is what ships):

| | answer | polarity | cards covered | no invented word | first-person | words | ms (Mac CPU) |
|---|---|---|---|---|---|---|---|
| shipped (r1) | 1.00 | 0.93 | 0.87 | 1.00 | 0.33 | 3 | 182 |
| **realiser_v4** | **1.00** | **1.00** | **1.00** | **1.00** | **0.87** | 4 | 214 |

**150 held-out prompts** from the test split (whole triples held out, so no test prompt was trained on):

| | answer | polarity | cards covered | no invented word | first-person | words | ms |
|---|---|---|---|---|---|---|---|
| shipped (r1) | 0.973 | 0.960 | 0.880 | 0.980 | 0.653 | 6 | 240 |
| **realiser_v4** | **0.993** | **0.993** | **0.900** | **0.987** | **0.833** | 6 | 240 |

Read the held-out numbers with care: 562 of the 1,211 test rows are generated, so that split shares a
distribution with the new model's training data. The fifteen hand-written taps are the fair comparison, and the
margin there is much wider.

The individual fixes are what the tables are made of:

| cards | shipped said | realiser_v4 says |
|---|---|---|
| Story \| More | **No story, just more.** | I want a story, more. |
| Tired \| No | **Not tired. Just tired.** | No, I'm tired. |
| Music \| Sing \| Happy | Music. Sing happy. | I like singing in music. I'm happy. |
| Ipad \| Want | Ipad, please. I want to do it again. | I want my Ipad. |
| Scared | Too scared. | I'm scared. |
| Friend \| Play \| Outside | So friends played outside. | Friend played outside with me. |
| Science \| I like | Science, I like it. | I like science. |

Against the bar in §6: answer ✓, polarity ✓, first-person ✓ (0.87 / 0.83 vs a target of 0.80), no-invented ✓ on
the probes and 0.987 on the held-out set (target 0.99, two cases short). Latency is 214 ms on the probes against
a 200 ms target — the new model says a little more, and on the same 150-prompt set both models sit at 240 ms, so
it is not a regression. **The blind judge was not run: it calls `claude -p`, which is paused.**

Still wrong, and worth the next pass: "I want to ball outside." and "I have to spell it hard." — the vocabulary
mask leaves the model no verb for a noun-only tap, so it presses the noun into service.

## 10. Not yet deployed

Everything needed is built and staged:

- `realiser_v4` in the `irisspeak-train` Modal volume; fp16 ONNX exported, chunked as `r2/` with a manifest.
- Branch `realiser-v2` carries the client `Setting:` line for both apps (and the iOS build fix).
- `sh site/deploy_realiser.sh <hf_realiser> r2` uploads and is reversible (`--rollback r1`); it refuses to run
  unless `eval/prompt_parity.py` passes.

The one rule that must hold: the branch merges in the same step as the upload. The new model is trained for the
prompt with the `Setting:` line, and the shipped model is measurably worse with it — shipping either half alone
makes the app worse than it is today.
