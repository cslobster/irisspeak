# IrisSpeak-135M v3 retrain plan

Date: 10 September 2026. Covers the vocabulary expansion already applied, the folder design, and the training recipe. Backups of the pre-expansion files: `vocab/vocab.pre-expansion.csv`, `vocab/registry.pre-expansion.json`, `data/map.pre-expansion.py`, `data/mapped.pre-expansion/`, `data/states.pre-expansion/`.

## 1. Vocabulary expansion (done)

Source of the additions: a full, uncapped audit of every AAC-user utterance in the training material against the mapper (`vocab/corpus_missing_full.json`). Of 3,109 missing content words, only 301 appear five or more times; those were curated by hand for child relevance, dropping the LLM-generated corpus's adult register (importance, teamwork, strategy, insurance…).

| change | count |
|---|---|
| curated corpus words (5+ occurrences, child-relevant) | 121 |
| Mulberry-backed words (corpus-supported, plus yesterday's search-only set promoted) | 23 |
| new aliases onto existing cards (t shirt, wake up, fell, veggies, café…) | 12 |
| mapper: contractions added (how's, you'll, we've…) and possessive 's handling | |
| **vocabulary** | **3,094 → 3,238 cards**, registry version d52f971ad97d |

Effect, measured by re-running the mapper and the state builder:

| | before | after |
|---|---|---|
| accepted utterances (all four sources) | 16,647 | 17,468 (+821) |
| mean coverage, AAC Conversations | 0.876 | 0.902 |
| mean coverage, Turk dialogues | 0.919 | 0.932 |
| training states | 69,676 | 73,287 (+5.2%) |
| dev / test / test_qa states | 8,811 / 15,597 / 2,199 | 9,166 / 16,472 / 2,333 |

Not added, on purpose: the remaining 2,800 missing content words (fewer than five occurrences each, most would be dead rows), 112 lowercase names (the name slot covers them), 35 dataset-artefact words, and Mulberry's 1,400 flags, maps, professions and kitchenware (2% of corpus lines, mostly phrasal verbs that already compose from existing cards).

## 2. Folders in the model

### 2.1 How many folders

Measured on the new 73,287 training states: for each of the 35 Cboard folders the app knows, how many states have an acceptable target inside the folder, how many of those are the first card after the partner's question (the case where a folder card is useful), and how many partner questions hit the folder's keyword triggers.

| folder | cards | states with a target in it | as first card | trigger hits |
|---|---|---|---|---|
| time | 110 | 1,993 | 142 | 261 |
| food | 195 | 1,358 | 228 | 153 |
| people | 173 | 1,185 | 140 | 0 |
| people > family | 12 | 922 | 80 | 0 |
| technology | 54 | 897 | 101 | 0 |
| school | 60 | 605 | 90 | 0 |
| drinks | 37 | 596 | 99 | 0 |
| places | 80 | 567 | 94 | 196 |
| numbers | 38 | 514 | 77 | 53 |
| plants | 120 | 308 | 69 | 0 |
| furniture | 50 | 282 | 12 | 0 |
| body | 77 | 270 | 39 | 16 |
| animals (all sub-folders rolled up) | 168 | 247 | 38 | 0 |
| weather | 33 | 219 | 24 | 61 |
| clothing (with accessories) | 68 | 321 | 56 | 11 |
| describe > colours | 17 | 151 | 24 | 127 |
| snacks | 14 | 104 | 35 | 95 |
| food > fruit, food > vegetables | 41 | 178 | 39 | 9 |
| transport | 62 | 106 | 9 | 0 |
| toys, activities, hygiene, kitchen, shapes, sports, characters, countries | | under 50 each | under 8 | |

Only 10,137 of 73,287 states (14%) have any applicable folder at all, so folders are a minority signal; the model must not be pushed to emit them everywhere.

**Decision: 16 model folders.** Keep every folder with 150 or more states and at least 24 first-card cases, rolling sub-folders into their parent for the model while the app's browser keeps showing the sub-folders:

numbers, time, food, drinks, snacks, people, family, places, school, technology, body, animals, weather, clothing, colours, plants.

Furniture (12 first-card cases) and transport (9) stay post-process-only through their keyword triggers; toys, activities, hygiene, kitchen, shapes, sports, characters, countries stay browse-only.

### 2.2 Train the folder, or post-process it

Three options were considered.

1. Post-process only (what the web app does today): keyword triggers on the question, plus any vocabulary category that fills three or more of the model's top 30. Zero training cost. Weakness: it depends on the model already ranking the category's words high, which is exactly what fails on choice questions and rare words (the "Read, or draw?" case, where the model answered Yes at 88%).
2. Trained folder rows only: add one output row per folder to the card layer and let the model decide. Weakness: irisspeak.com's experience with Gemini showed even a strong model misses obvious cases ("How old are you?" without a numbers folder a meaningful fraction of the time), so it kept a regex backstop.
3. **Hybrid, chosen:** trained folder rows plus the keyword triggers as backstop, which is the v1 design with the LLM replaced by our own rows.

Training the folder rows:

- Card layer grows by 16 rows, `<folder:numbers>` … `<folder:plants>`, initialised from the mean embedding of the folder's member cards (same trick as the card rows).
- Soft targets: in every training state, for each folder F, if a share s of the state's target mass lies on F's member cards, add `<folder:F>` with weight 0.4 × s, then renormalise. Only at prefix length 0 and 1; a folder is a way into a category at the start of a reply, not a mid-sentence card. So the model learns "after *How old are you?* the numbers folder and the number cards are both good", without the folder swallowing the cards' own probability.
- Loss and everything else unchanged (soft-target cross-entropy, weighted tiers, two epochs).

Inference:

- Folder rows compete in the same softmax. After reranking, take folder rows in the top 16 or with probability above 0.05, at most 2, and render them as folder cards in the first Topic slots; then apply the existing keyword triggers as backstop; freeze the decision for the turn as now.
- The reranker gets one more feature, is_folder (54 dims), and is retrained; that takes under a minute.
- Recall@k is reported on cards only, with folder rows excluded, so v3 stays comparable with v2; folder quality gets its own metric.

Folder evaluation: from test and test_qa, take every state whose first target card belongs to one of the 16 folders (about 1,300 in train scale, roughly 300 in test). Report folder precision and recall at "top 2 folders", and separately the hit rate of the keyword backstop, so we can see what the trained rows add over the regex.

## 3. Other changes in the retrain

1. **Output mask for dead rows.** Rows with no training target in `train.jsonl` (about 1,300 of 3,238; the exact set is computed at training time) are masked out of the softmax at training and inference, and the mask is baked into the ONNX export as a bias. They stay reachable in the app through search, folders and custom words. This removes the untrained rows from the model's choice without changing the app vocabulary.
2. **Choice-question augmentation.** For every training state whose partner turn contains "A or B" and whose first target is A or B, add the other option as an acceptable target at weight 0.5. Add synthetic states from the question bank's choice prompts with both options as targets. Goal: the model stops answering "Yes" to "Read, or draw?".
3. **Drop the diversity-theme conversations.** Filter AAC Conversations rows whose scene, partner turn or target contains the artefact list (diversity, multicultural, cultural, unity, gratitude, backgrounds, …); report the number dropped. These are the generator's voice, not a child's.
4. Optional, not in this run: a time-of-day field in the prompt for the bedtime and morning settings.

## 4. Run recipe

```
# states already rebuilt on the 3,238-card vocabulary
python3 data/build_states.py --folders 16            # to add: folder soft targets, choice augmentation, artefact filter
python3 train/train_smollm.py --weighted --out train/out/smollm135_v3 --mask-dead --folders
python3 eval/reranker_e2e.py --ckpt train/out/smollm135_v3/card_model.pt --n-train 4000   # 54-dim reranker + folder metric
python3 export/export_onnx_optimum.py --ckpt train/out/smollm135_v3/card_model.pt --mask
python3 export/quantize_check.py --parity-only
python3 site/chunk_model.py ... ; upload chunks to the R2 bucket; update cards.json (3,238 + 16 folder rows + specials)
python3 site/build_results.py --v2 eval/e2e_v2_final.txt --v3 eval/e2e_v3.txt ; python3 site/gen_charts.py
```

App changes after export: `cards.json` gains the folder rows (the app already renders `is_folder` cards); `LocalApi.decideFolders()` reads the model's folder rows first and keeps the triggers as backstop; the reranker JSON gains the is_folder feature; the search list adds the 144 new words with Mulberry pictures where they exist.

Expected cost: about two and a quarter hours of training on the M2 Max (5% more states), plus the usual export and upload. Success criteria: test_qa Recall@16 with reranker above the current 0.701; choice questions answered with the options on the board without the app-side pin; folder recall at top-2 above the keyword backstop alone.

## 5. Status (9 September 2026, evening)

Done: state builder v3 (`--folders --choice --synth-choice 3000 --synth-folder 150`; train 77,578 states, 5,426 synthetic, 7,244 with a folder target; artefact rows dropped 401/18/108), trainer (16 `<folder:*>` rows initialised from member means, `--mask-dead` masks 1,330 of 3,256 rows, card-only recall plus folder precision/recall@2 and folder-in-top-16), exporter and `site/chunk_model.py` (`dead` list, folder rows with Cboard path and members in `cards.json`), reranker (54th feature is_folder, card-only metrics, folder-in-top-16), app (`engine.dead` mask applied before softmax, is_folder feature when the reranker has 54 dims, `decideFolders()` reads model folder rows first: reranked top 16 or p > 0.05, at most 2, triggers as backstop), pictures and search entries for the 144 new cards (37 Mulberry SVGs, the rest emoji).

Running: `train/train_smollm.py --weighted --mask-dead --epochs 2 --max-eval 2000 --out train/out/smollm135_v3` (4,850 steps).

Next: reranker retrain, ONNX export + parity, chunk + upload to R2, cards.json/reranker.json/freq.json/card_vecs.bin, deploy, results pages, iOS port.

Choice parsing note: "at", "in", "eating", "go" added to CHOICE_STOP so "at home or at a restaurant" yields both options.

## 6. Deployed (9 September 2026, 18:20 PDT)

v3 135M trained on Modal (A100, 11.8 min): test_qa Recall@16 0.608 model-only (v2 0.599), 0.697 with the 54-dim reranker (v2 0.701, level); test Recall@16 0.547; folder-in-top-16 on test_qa 0.629. fp16 ONNX parity 0.997 top-100 overlap, 231 ms/state CPU. Chunks live at `v3/` on the R2 CDN and under `site/public/model/v3/` (manifest lists versioned paths; app cache store renamed `irisspeak-model-v3`, metadata JSON fetched with no-cache). Upload script: `site/upload_model.sh v3`. Sanity: "How old are you?" -> Numbers folder p 0.19 first; "Where does it hurt?" -> Body folder p 0.19; "Do you want juice or milk?" -> Juice, Milk first two Topic cards; "What colour do you like?" -> colours fill Topic.

Backbone bake-off on Modal (same states, 2 epochs): SmolLM2-135M done; Qwen3-0.6B, LFM2.5-350M, Qwen3.5-0.8B running (see train/out/modal_bakeoff*.log; results in the `irisspeak-train` volume).

## 7. Backbone bake-off (Modal A100, identical v3 states, 2 epochs, --weighted --mask-dead), model only

| backbone | params | A100 min | test_qa R@1 | test_qa R@8 | test_qa R@16 | test R@16 | dev R@16 | folder-in-top16 (test_qa) |
|---|---|---|---|---|---|---|---|---|
| SmolLM2-135M (shipped v3) | 135M | 11.8 | 0.310 | 0.548 | 0.608 | 0.547 | 0.536 | 0.629 |
| LFM2.5-350M | 354M | 21.6 | 0.336 | 0.553 | 0.614 | 0.547 | 0.531 | 0.647 |
| Qwen3-0.6B | 596M | 35.9 | 0.341 | 0.562 | 0.624 | 0.557 | 0.543 | 0.638 |
| Qwen3.5-0.8B (text part, vision dropped) | 752M | 49.1 | 0.335 | 0.559 | 0.622 | 0.553 | 0.540 | 0.603 |

Reading: the task is data-limited; bigger backbones buy 1 to 1.6 points of Recall@16 and about 3 points of Recall@1. Qwen3-0.6B is the best of the four; Qwen3.5-0.8B does not beat it and cannot run in onnxruntime-web. Checkpoints are in the Modal volume `irisspeak-train` (<run>/card_model.pt). Notes: LFM2.5 needs transformers 5.x (tokenizer class TokenizersBackend); Qwen3.5 needs transformers 5.x, fla and causal-conv1d (first attempt without the compiled conv ran at 3.9 s/step, 0.8 s/step with it).

## 8. Qwen3-0.6B for the iPad app (10 Sep 2026)

Run `qwen3_06b_v31` on Modal (same v31 data/folders as the browser 135M model, `--model Qwen/Qwen3-0.6B`, A100,
4,840 steps at 0.42 s/step ≈ 34 min). test_qa: recall@1 0.330, recall@16 0.629, recall@100 0.812, mrr 0.415,
folder_in_top16 0.686 (135M v31: recall@16 0.608). Pipeline:

```
modal volume get irisspeak-train qwen3_06b_v31/{card_model.pt,results.json,backbone.json} train/out/qwen3_06b_v31/
python3 export/export_onnx_optimum.py --ckpt train/out/qwen3_06b_v31/card_model.pt --out export/out_qwen31   # V=151936 + 3287 rows
python3 export/quantize_nbits.py --ckpt train/out/qwen3_06b_v31/card_model.pt --onnx export/out_qwen31/onnx/model.onnx --out export/out_qwen31
python3 site/chunk_model.py --onnx export/out_qwen31/card_model_int8.onnx --cards export/out_qwen31/extended_vocab.json --out export/stage_qwen31 --version q31
python3 eval/export_reranker.py --ckpt train/out/qwen3_06b_v31/card_model.pt --out export/stage_qwen31
irisspeakapp/scripts/fetch_models.sh && irisspeakapp/scripts/deploy_ipad.sh
```

int8 (MatMul dynamic) is not usable for Qwen either (top-1 agreement 0.29); fp16 is the deployable format
(1.2 GB in the app bundle; parity vs torch: top-100 overlap 0.998, top-1 1.000, 137 ms/state on the Mac CPU;
reranker self-check on dev: R@16 0.602 -> 0.734). Gotchas: the fp32 export is >2 GB with external data, so
onnx.load needs load_external_data=True and convert_float_to_float16 needs disable_shape_infer=True (fixed in
export/quantize_nbits.py). The browser keeps the 135M model; only the iOS bundle uses Qwen.
Sentence realiser: still one model — the export keeps the full LM head (ids < V are words, ids ≥ V are cards),
so a cards→sentence objective can be added as a fine-tune of this checkpoint without a second model.

### 8.1 iOS runtime: Core ML, not ONNX Runtime (10 Sep 2026)

ONNX Runtime's CPU provider on iOS has no native fp16 GEMM for this graph: with weight pre-packing it copied the fp16
weights to fp32 (+4.5 GB on the Mac; Jetsam killed the app at 2.16 GB on the iPad), and with pre-packing off and the
weights memory-mapped (`export/ios_variant.py`, `session.disable_prepacking=1`) it still cast per run: 2.2 s per
prediction, 2.1 GB footprint. 4-bit MatMulNBits kept only 0.88 top-100 overlap / 0.89 top-1. The fix is Apple's own
runtime: `export/export_coreml.py` traces the extended HF model (card head only, 4D additive mask built with plain ops
because transformers' vmap mask builder cannot be traced) into `IrisSpeakCard.mlpackage` (fp16 mlprogram, iOS 18,
fixed 256-token right-padded window, 1.2 GB). Parity vs torch on 48 states: top-100 overlap 0.995, top-1 1.000.
iPad (A16): load 6.5 s, first prediction 1.2 s (warm-up), then 250–270 ms; footprint 1.4 GB, stable. The app loads
`IrisSpeakCard.mlmodelc` when present (`Engine/CoreMLCardModel.swift`) and falls back to ONNX otherwise; MiniLM stays
on ONNX Runtime. Alternative if needed: llama.cpp Metal with a Qwen3-0.6B GGUF (Q8_0 0.64 GB) and the card head as
one Accelerate matmul on the last hidden state — also the natural path for the sentence realiser (token generation).

| iPad (A16) | 135M, ONNX CPU | Qwen3-0.6B, ONNX CPU | Qwen3-0.6B, Core ML |
|---|---|---|---|
| prediction | 165–190 ms | 2,200 ms | 250–270 ms |
| footprint after run | ~0.5 GB | 2.1 GB (crash before the fix) | 1.4 GB |
| app size | 0.4 GB | 1.3 GB | 1.4 GB |

## 9. On-device sentence realiser (10 Sep 2026)

Replaces the cloud `/api/sentence` call in both apps. A dedicated SmolLM2-135M-Instruct fine-tune (`train/train_realiser.py`,
Modal run `realiser_135m_v2e2`, 2 epochs, lr 8e-5, ~10 min on an A100): prompt `Partner: <question>\nCards: a | b | c\nSentence:`,
loss on the sentence only. Data (`data/build_realiser.py`): 41,328 train / 6,536 dev / 9,286 test pairs from the mapped
utterances (aactext, Turk, AAC conversations) and their alternative card sequences, plus "telegraphic" copies with
function-word cards dropped; pairs whose sentence has a content word no card spells are removed (the first run without
that filter learned to invent words: card coverage 0.67). 4 epochs overfit slightly (dev exact 0.35 → 0.31).

Decoding (`aac_next/src/engine/realiser.ts`, `irisspeakapp/.../Engine/Realiser.swift`, mirrored by `eval/realiser_eval.py`):
KV cache (optimum `text-generation-with-past`, fp16 weights, 270 MB), greedy, hard vocabulary constraint = card words +
inflections (grammar.ts / Inflect) + a function-word list + punctuation; stop at newline/EOS, 20 tokens, or a token
repeated 3×; then capitalise and add final punctuation. Web: chunks `r1/realiser_fp16.part*` + `realiser_manifest.json`
on the model CDN, loaded in the background after the card model (`export/export_realiser.py`, `site/upload_model.sh r1`).
iOS: `realiser_fp16.onnx` + `realiser_tokenizer.json` in the bundle (ONNX Runtime, prepacking off), loaded after the card model.

| test (400), constrained decode | exact | all cards used | no invented content word | Mac CPU |
|---|---|---|---|---|
| v1 (unfiltered data, 4 ep) | 0.293 | 0.870 | 0.973 | 81 ms |
| v2 (filtered, 4 ep) | 0.300 | 0.892 | 0.988 | 136 ms |
| **v2e2 (filtered, 2 ep) — shipped** | 0.290 | 0.905 | 0.993 | 135 ms |

"Exact" is against one reference wording; the samples show most non-exact outputs are acceptable paraphrases
("You're welcome! Do you want another one?"). The rule-based joiner remains the fallback until the model has loaded.

### 8.2 iPad back on IrisSpeak-135M (10 Sep 2026, evening)

User decision: the iPad/iPhone app uses the same IrisSpeak-135M v31 as the web app instead of Qwen3-0.6B. Core ML
export via the same `export/export_coreml.py` (278 MB fp16, parity vs torch top-100 0.974 / top-1 1.000, 13 ms on
the Mac). Bundle: `IrisSpeakCard.mlpackage` (135M) + the web's `site/public/model/{cards,reranker,freq}.json`,
`card_vecs.bin` and the SmolLM2 tokenizer.json; the 135M realiser stays. `irisspeakapp/scripts/fetch_models.sh`
defaults to these (CARD_COREML / CARD_TOKENIZER switch back to Qwen). App size drops from 1.6 GB to about 0.7 GB.

### 8.3 Everything on Core ML, fp32 (10 Sep 2026, late)

User: "both irisspeak and smol for realizer should be converted to core ML … do not lose precision". Card model
IrisSpeak-135M v31 re-exported at fp32 compute (`export/export_coreml.py --precision fp32`, 554 MB): parity vs torch
top-100 1.000 / top-1 1.000 (fp16 was 0.974 / 1.000). Realiser converted with `export/export_coreml_realiser.py`
(fixed 64-token right-padded window re-run per generated token, no KV cache; `Engine/Realiser.swift` Core ML backend):
fp32 (539 MB) gives the identical sentence to the ONNX reference decoder on 100% of 120 test pairs, fp16 (270 MB) on
99.2%. Shipped: both fp32; app ≈1.2 GB (fp16 pair would be ≈0.65 GB). ONNX Runtime now only serves MiniLM.
iPad (135M fp16 build, before the fp32 swap): card prediction 14–24 ms after warm-up, sentence 262 ms, footprint ~0.5 GB.
