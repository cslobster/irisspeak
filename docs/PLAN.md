# Next-Card AAC Plan (review of qwen_aac_rl_reranker_summary.md, 2026-09-01)

## Verdict
Keep the three-stage split (generalist candidate model -> supervised reranker -> on-device bandit), the closed
output space with logit masking, per-prefix training states, loss masking, conversation-level splits, and the
"no RL first" rule. Change: drop QLoRA, export only the 724 head rows, train with soft multi-answer targets,
hold card positions stable, make grid size a profile setting. Add: partner-input capture modes, a no-question
mode, a cheap non-LLM baseline, a simulated-user "selections per utterance" metric, position-stability metric.

## Critique
1. KEEP masked-logit single-position prediction. Exploit it: prefill partner turn once, append one card token
   per step, keep KV cache; delete = truncate cache.
2. CHANGE QLoRA -> full bf16 fine-tune. 0.5B + AdamW ~8 GB; fits one 24 GB GPU. 4-bit training adds noise
   before you quantize again. LoRA on attention does not train new card embeddings unless embed_tokens/lm_head
   are in modules_to_save. LR ~2e-5 backbone, ~1e-3 for new card rows early.
3. CHANGE ship a sliced 724-row head. Qwen2.5-0.5B ties embeddings; the 151,936x896 matrix is ~136M of 494M
   params. You mask all but 724 rows, so slice them into a separate head after training (identical logits).
   Full embedding table still needed on the input side for arbitrary partner text.
4. CHANGE decide input representation by ablation: atomic card tokens (1 token/step, KV-simple) vs plain-text
   prefix ("i want, pizza") + dedicated output head (keeps pretrained reading). Start atomic; switch if
   unseen-question Recall@100 is clearly worse.
5. CHANGE multiple acceptable answers -> soft target distribution per state (reference highest mass, reviewed
   alternatives share the rest). Build states from every acceptable sequence, not only the reference.
6. CHANGE be precise about "RL": DPO/ORPO on LLM = offline, low risk, small gain. GRPO = little expected;
   sequences are 2-4 cards and reward is mostly F1 which SFT already optimizes. Online learning = bandit on the
   reranker only, never LLM weights in-browser. "Unsafe content" reward is moot with a closed vocab; the real
   risk is making refusal/repair cards hard to reach -> hard slate rule instead.
7. ADD card position stability (largest omission). Core/safety cards fixed per user; a card that stays in the
   slate keeps its cell; new cards fill vacated cells. Report "cards moved per step".
8. ADD partner-input modes: typed, on-device ASR, or absent (user-initiated). Train on all three, plus
   mid-conversation with last two turns.
9. ADD a MiniLM-class bi-encoder baseline first. LLM must beat it on unseen-question Recall@16 by a pre-agreed
   margin or it is not the product.
10. CHANGE grid size (16/24/36) is a clinician profile setting; slot policy scales, reranker trained once.
11. CHANGE put profile header (age band, setting, interests) in the LLM prompt; sample it in synthetic data.
    Reranker handles only what the LLM cannot know (this user's frequency, recency, rejections).
12. KEEP reranker as personalization surface. Use the LLM's final hidden state as the context embedding for
    the question-card similarity feature (no second encoder). Core/personal slots draw from the full vocab, so
    Recall@100 constrains only contextual slots.
13. CHANGE vocab hygiene first: append-only ID registry with version hash embedded in the export; add missing
    core cards BEFORE mapping data; review alias matcher errors; every card gets label, aliases, category,
    intent class (request/refuse/affirm/question/repair/social/describe), core flag, safety flag.

## Architecture
partner input (typed | ASR | none) -> prompt: profile header + last 2 turns + card tokens (prefill once)
-> Qwen2.5-0.5B full FT, q4 WebGPU (1 token/step, KV kept) -> sliced 724-row head -> top 100 + features
(logprob, rank, hidden·card_emb, category, intent, personal stats) -> reranker MLP (global + bandit adjust)
-> slate policy (fixed-position core, stable contextual cells, grid from profile) -> user picks -> repeat

Slate policy         16   24   36   position
core+safety           4    5    6   fixed per user
contextual            8   13   22   keep cell while in slate
contrasting intent    2    3    4   fixed row
personal              1    2    3   fixed row
exploration/nav       1    1    1   fixed corner

Candidates to benchmark: bi-encoder 22M (~25 MB); Gemma 3 270M (~180 MB, tiny transformer, big embedding);
Qwen2.5-0.5B (~320 MB); Qwen3-0.6B (~380 MB) only if 0.5B leaves recall on the table.

## Budgets (targets, not measurements)
first slate after partner turn (WebGPU tablet) < 600 ms; each step < 120 ms; WASM fallback step < 800 ms;
download < 350 MB (Cache API); peak GPU mem < 1.2 GB (iPad Safari); cards moved per step <= 4 of 16.

## Data
Mostly synthetic; treat as known bias. Sources: crowdsourced AAC-style sentence sets, Cboard boards,
conversation transcripts for partner questions, LLM dialogues with personas. Generator sees the full card
list and outputs card sequences (not English), telegraphic style, 3-6 acceptable sequences per state covering
request/refusal/uncertainty/repair/social. Log unmapped concepts (vocab backlog); drop examples < ~85% mapped.
SLP reviews 300-500 stratified states; report agreement. Split by conversation and persona; hold out whole
partner questions.

## Phases and exit criteria
0 Vocab+data: registry, metadata, missing core cards, alias matcher, generator, soft targets.
  Exit: >=20k conversations, mapping rate reported, review sample scored, splits frozen.
1 Candidate models: baseline first; full FT Qwen with card tokens + soft targets; input-repr ablation; slice head.
  Exit: beats baseline by margin; Recall@100 > 97%; end-token acc > 90%; rollout repetition < 2%.
2 Browser runtime: ONNX q4 + sliced head, transformers.js WebGPU/WASM, persistent KV, hidden-state output,
  Cache API. Exit: post-quant Recall@100 within 1 pt; budget table met on primary device.
3 Reranker+slate: real top-100 hard negatives, graded labels 3/2/1/0, MLP listwise loss, personal-feature
  dropout, slate policy as plain code. Exit: NDCG@16 up; selections/utterance down; cards-moved in budget.
4 Preference tuning: DPO/ORPO from reviewed sets + hard negatives; skip GRPO unless a named metric is short.
  Exit: no Phase 1 regression; unwanted-suggestion rate falls.
5 On-device personalization: IndexedDB log (slate, pick, cell, deletions); decayed freq/recency/rejection
  features; Thompson sampling on the exploration slot only; clinician reset + log export.
  Exit: 2-week pilot, personal cards picked above global-only prediction, no rise in deletions.

## Metrics every run
Recall@1/16/100 + MRR split seen/unseen questions; end-token acc, seq F1, edit distance; Recall@100 after
quantization; NDCG@16 + intent diversity; simulated-user selections per utterance; cards moved per step;
refusal/repair reachable in one tap; deletion rate, manual search rate.

## Risks
synthetic fluency/adult bias; device floor (baseline may be the product on WASM-only fleets); rich-get-richer
(unselected = 0, one exploration slot, decay); privacy (nothing leaves device except consented aggregates);
vocab growth (one retrain per vocab version, append-only registry).

## Repo layout
vocab/ data/ train/{baseline,candidate,reranker} export/ web/ eval/ docs/
