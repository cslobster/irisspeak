# IrisSpeak: ground-up design

Date: 2026-09-02. Grounded in what was measured in this study: a fine-tuned 135M local model plus a
reranker beats a pure-LLM theme-locked prompt at predicting the next card (0.83 vs 0.33 grid hit on a small
question-answer sample, 113 ms vs 1.9 s), while the Gemini 2.5 Flash prototype has the product pieces the study
lacks (sentence generation, folders, parent guidance, hallucination guard, a deployed UI).

## 1. Principles

1. **Every tap answers locally in under 150 ms.** No network on the tap path, ever.
2. **The grid is stable.** Fixed cells never move; a card that stays keeps its cell; newcomers fill vacated cells.
3. **The child can always say no.** Yes, no, I don't know, help, and a refusal are one tap away on every turn.
4. **The cloud plans, it does not decide.** One call per parent message, asynchronous, blended as a boost.
5. **One vocabulary with stable ids** shared by the app, the model, the reranker, and the logs.
6. **Works offline.** Cloud loss degrades suggestion quality, not function.
7. **Nothing leaves the device without consent**, and names never do.

## 2. System at a glance

![IrisSpeak system diagram](/img/system.svg)

Reading the diagram:

- **Per tap (solid teal path).** Context assembler → local scorer → reranker → slate policy → grid. The scorer keeps a KV cache, so a tap costs one decoder step; the reranker is a 6,000-weight MLP; the slate policy is plain code. Budget under 150 ms on WebGPU, under 300 ms on WASM, with the MiniLM bi-encoder as the fallback on devices that cannot meet it.
- **Per partner turn (dashed amber path).** The planner agent receives the masked context and returns intent paths and category boosts as strict JSON. Those become one feature in the reranker, scaled by confidence, decaying every tap, dropped when the user diverges or deletes. If the planner never answers, the feature is zero and the grid is unchanged in structure.
- **Personal layer.** Decayed counts, recency, and deletion rates in IndexedDB are inputs to the reranker, not weights; the reranker's weights are global and fixed on the device. One exploration cell runs a bandit.
- **Speaking.** Tapped cards go through a local template realiser first (tense from the partner's question, phrase expansion, name slots); the Gemini 2.5 Flash prototype's LLM sentence prompt is an optional alternative when online.
- **Offline pipeline (grey band).** Corpora → mapper → states → fine-tune and DPO → ONNX export with a parity gate → reranker training on top-100 dumps and consented logs → replay evaluation. What ships to the device is the fp16 model, the reranker weights, and the vocabulary registry with its version hash.

## 3. Vocabulary

- Use the 3,094-card registry from this study (`vocab/vocab.csv`, `registry.json`) with append-only ids and a
  version hash embedded in every model export. Retire the 738-card Mulberry CSV as the source of truth; keep
  Mulberry and ARASAAC as the **image layer**, keyed by card id.
- Categories, intent classes, core and safety flags, composable phrases with component ids: all already
  present. Folder definitions (numbers, colours, family, time, weather, animals, food ...) become views over
  the same ids instead of a parallel word list.
- Per-child custom words (names, pets, shows) get ids in a reserved personal range (`p_0001` ...) and a
  `<name>` slot in the model; they never enter the shared vocabulary or any cloud prompt as raw text.

## 4. Local scorer

- **Model:** SmolLM2-135M-Instruct fine-tuned on card states (the recipe in PLAN-EXPERIMENTS.md), 3,096 card
  rows initialised from spoken forms, sliced 3,095-row head, input embedding pruned to ~25k tokens, q4f16
  ONNX for transformers.js v4 on WebGPU. Target: ≈80 MB download, <40 ms per tap, <200 ms prefill.
- **Fallback on devices without WebGPU:** MiniLM bi-encoder plus bigram counts (S2 in the study), 25 MB, CPU.
- **Inputs:** setting (8 values), profile header (age band, interests), last two turns, partner turn, tapped
  card tokens. Partner dropout in training so it works when the child initiates.
- **Outputs:** log-probability over cards + end-of-message, and the final hidden state for the reranker.
- **Training data:** the mapped corpora (AAC Conversations with the topic filter, Turk filtered, AACText) plus
  quota-driven synthetic parent–child dialogues so every card has ≥30 examples; DPO on reviewed pairs after.

## 5. Personal layer and reranker

- **Personal layer:** per-card decayed selection count, last-used recency, deletion rate, and setting-specific
  counts, stored in IndexedDB. Updated on tap, delete, speak. Never uploaded.
- **Reranker:** MLP over the top-100 with features: model log-prob and rank, frequency log-prob, MiniLM or
  hidden-state similarity to the partner turn, category, intent, core, safety, composable, personal features,
  planner boost, prefix length. Trained globally with personal-feature dropout so a new child works on day one;
  the personal weights are fixed, only the counts are personal. The study's first reranker added +8 points
  Recall@16 with four features; the hidden state and personal counts are the next two.
- **Bandit:** Thompson sampling on one exploration cell only; unselected cards get zero reward.

### As implemented in the live demo

The demo runs the trained reranker in the browser over the model's top 100 candidates. Its features are the
model's probability and rank, bigram frequency from the training states, MiniLM similarity between the
question and each card (MiniLM runs in the page), card metadata (category, intent, core, safety, composable,
multiword), prefix length, and whether a question was asked. On top of the reranker score the personal layer
adds a bonus for cards used in the user's earlier answers and for cards that match the description of the user.
Earlier questions, spoken answers, and the description are kept in the browser's local storage; the stored
conversation is fed to the model as context. The speak button shows the model's end-of-message probability,
reads the tapped cards aloud, and saves the turn to history. The reranked probability shown is a softmax over
the reranker's scores of the top 100.

## 6. Planner (the cloud LLM's new job)

- Called on: new partner utterance, sentence start with no fresh plan, setting change, "more ideas", high
  local entropy. Never on ordinary taps. Under 2 calls per utterance.
- Prompt: the Gemini 2.5 Flash prototype's card prompt is the right starting point (theme identification, 2-3 candidate
  sentences), but it returns **intent paths as card ids** and **category boosts** through a strict JSON
  schema, not 12 nouns and 12 verbs. The vocabulary is a cached prompt prefix. Profile facts stay in the
  prompt; names are replaced by `<name>` slots and restored locally.
- Backend choice per profile: gpt-5.6-luna (effort none, ~3 s measured with a 20k-token prefix, ~1.5 s
  expected with a compact listing), gemini-2.5-flash-lite, or a local Qwen2.5-0.5B for a fully on-device
  mode. Same JSON contract for all three.
- Blend: path boosts scaled by confidence and decayed per tap; dropped when the child diverges or deletes.

## 7. Slate policy and grid

16 / 24 / 36 cells set by the clinician. For 16:

| cells | content | rule |
|---|---|---|
| 4 | yes, no, help, I don't know (or the child's chosen safety set) | fixed for life |
| 2 | contrasting intent: one refusal, one uncertain, when not already present | fixed row |
| 8 | contextual, from the reranker | keep cell while still ranked; fill vacated cells only |
| 1 | personal favourite | fixed row |
| 1 | folder or exploration | fixed corner: a folder card when a trigger fires, else exploration |

Speak, undo, and "all words" are buttons, not cells. End-of-message is the speak button lighting up when
the model's end probability crosses a threshold.

## 8. Sentence realiser

Keep the Gemini 2.5 Flash prototype's strength, but make it local-first:
1. **Template realiser** on device: tapped cards in order, inflection from the partner's tense and the time
   cards, composable phrases expanded, `<name>` filled. "I play football Sam" → "I played football with Sam"
   covers most utterances.
2. **LLM realiser** (the prototype's `buildSentenceInferencePrompt`) only when enabled, online, and the template
   confidence is low. Rules from the prototype stay: every card represented, no invented content, first person.
3. The child hears the template version immediately; the LLM version, if it arrives, is offered as an
   alternative, never substituted silently.

## 9. Parent side

Keep the parent guide turn (the Gemini 2.5 Flash prototype's prompt) as an async cloud feature. Add: the parent sees which cards were
shown and which were tapped, can pin a card to the personal cell, and can add custom words with images.
Nothing else from the camp intake enters the system.

## 10. Data, privacy, logging

- On device: slate shown, cell positions, tap, delete, speak, planner used or not. This is the training
  signal for the reranker and the evaluation log.
- Export only with consent, names and free text stripped; aggregate reranker features only.
- Cloud calls: zero-retention configuration, `<name>` slots, opt-in per family; local-only mode is default.

## 11. Evaluation, built in from day one

- Offline replay on T1/T2/T3 (PLAN-EXPERIMENTS.md), simulated-user taps per utterance, cards moved per step,
  refusal reachable in one tap.
- The app itself computes the same numbers from its logs, per child, so a model or prompt change can be
  judged in the admin dashboard instead of by feel.
- Frontier model as ceiling and as blind judge of grids, calibrated against a human reviewer.

## 12. Migration from the Gemini 2.5 Flash prototype (what to keep, change, drop)

| prototype component | IrisSpeak |
|---|---|
| `corpus_vocabulary.csv` 738 rows | replaced by the 3,094-card registry; Mulberry/ARASAAC as image layer |
| `buildChildCardPrompt` per tap | becomes the planner prompt, once per parent message, JSON contract |
| `generateChildCards` pool + refresh | replaced by local scorer + reranker + slate; "refresh" pages the reranked list |
| folder cards + keyword triggers | keep; folders become views over card ids |
| small-talk backstop | keep as slate rules (greeting → hi/bye cells) |
| `buildSentenceInferencePrompt` | keep as the optional LLM realiser behind the local template |
| parent guides | keep, async |
| profile facts, custom words | keep; custom words get personal ids and `<name>` slots |
| Neon + JWT backend | keep for accounts, sessions, transcripts; add model/vocab version endpoints |
| web-client React/Vite | keep; add the ONNX runtime, IndexedDB personal store, stable-grid component |

## 13. Phases

1. **Engine** (weeks 1–4): registry adoption, state builder, full fine-tune with topic filter, reranker with
   hidden-state feature, ONNX export, parity test, device latency table.
2. **App integration** (weeks 4–6): stable grid component, local scorer in the web client, personal store,
   template realiser, planner contract with the existing Gemini/OpenAI client.
3. **Evaluation** (weeks 6–8): replay harness in CI, admin dashboard metrics, scripted sessions.
4. **Users** (weeks 8–11): AAC user sessions and the two-week pilot as in PLAN-EXPERIMENTS.md.

## 14. Decision rules carried over

- Local model must beat the bi-encoder by ≥8 points unseen-question Recall@16 to justify its download.
- Planner must lower taps per utterance on unseen questions by a measurable margin or it is switched off.
- Any change that lowers "refusal reachable in one tap" below 100 percent is rejected outright.
