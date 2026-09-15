# Folders for every card: does showing 1 or 2 folders on the board raise accuracy and coverage?

Date: 10 September 2026. Measured with `eval/board_eval.py` (the app's board logic replayed with the v3 model), on the 80-question child bank and on 371 held-out corpus questions from `test_qa` (target = the first card of the real reply).

## 1. What folders cover today

| | cards | share of the 3,238-card vocabulary |
|---|---|---|
| in one of the 35 Cboard folder word lists | 570 | 18% |
| in a folder through the category map (food, drinks, animals, places, time, numbers, colours, clothing, body, weather, technology, school, people, toys, furniture, plants, transport) | 1,424 | 44% |
| in no folder at all | 1,814 | 56% |

The uncovered cards are the big general categories: actions 415, describing 349, things 301, phrases 187, core 149, activities 142, feelings 92, ideas 88. Those are also where the real answers live: of the 371 corpus first answers, 108 are core words, 77 ideas, 49 describing, 32 actions, 29 phrases. Only 8% of real first answers sit inside a current folder word list, 11% through the category map. So today's 16 trained folders cannot move corpus-level accuracy much: the model already puts food and numbers on the board, and the words that go missing are not in any folder.

## 2. Simulation: a folder for every category

Variant `--all-folders`: every vocabulary category becomes a folder (members = its cards); the two folder slots are filled by the model's own folder rows first, then question routing, then the categories with three or more cards in the model's top 30.

| questions | current app (2 folder slots, 16 folders + routing) | folders for every category |
|---|---|---|
| child bank, 80 questions | 80/80 pass, 63 with a content card | 80/80, 68 with a content card |
| corpus, 371 questions, pass | 271 (73%) | 303 (82%) |
| corpus, pass with a content card | 165 (44%) | 197 (53%) |
| corpus, answered *only* through a folder | 7 | 84 |
| boards showing 2 folders / 1 / 0 | 46 / 95 / 230 | 298 / 70 / 3 |

Most shown folders in the all-category run: Describing 213 boards, Phrases 99, Actions 57, Things 53, Time 39, Food 37, Feelings 29, Questions 28, Numbers 24.

## 3. Reading

- **Yes, folders raise coverage, by about 9 points on real questions**, and they turn 84 misses into one-more-tap hits. The gain comes almost entirely from the categories that have no folder today: describing, phrases, actions, things.
- **But a 350-word "Describing" folder is not a folder, it is a list.** The simulation counts a card as reachable if it is anywhere inside the folder; a child would scroll three screens. The Cboard folders work because they hold 15 to 60 words, and Cboard splits the big ones (describe > colours, describe > shapes). The honest version of the gain is smaller until the big categories are split into sub-folders of 20 to 60 cards.
- The two-slot design is right. In the all-category run 298 of 371 boards use both slots, and the second folder is what catches the Phrases and Feelings answers. A third slot would cost a Topic cell for little return.
- Folder rows in the model already work for the 16 trained folders (folder in top 16 on 63% of test_qa states with a folder target). Trained rows beat the keyword and category heuristics because they see the whole question, so new folders should get rows too.

## 4. Recommendation

1. **Split the four big categories into sub-folders of 20 to 60 cards** using the vocabulary's existing structure (intent, pos, the Mulberry groupings): describing → size, colour, taste, how it feels, how much; actions → everyday, play, school, body; things → home, school, outdoors, toys; phrases → greetings, polite, refusals, asking. About 25 new sub-folders. This is a data task in `folders.json`, no retraining.
2. **Train folder rows for the new sub-folders** in the next model run (v3.1, together with the sentence realiser), same recipe as the 16 rows: soft target 0.4 of the members' mass at prefix 0 and 1. Until then the category heuristic and question routing fill the slots.
3. Keep the two slots, keep routing first, model rows second, category count third. Show a folder only when it would carry probability mass the board does not (the members' summed probability above 5%), so boards with a clear direct answer stay clean.
4. Report both numbers going forward: direct pass and pass-via-folder, since a folder hit is a second tap.

Expected effect after 1 and 2: corpus pass from 73% toward 80% with folders of usable size, and the child bank's content-card rate from 63 to about 70 of 80.

## 5. Done (10 September 2026, evening): folder taxonomy v2 and model v3.1

**Taxonomy.** Every one of the 3,238 cards now sits in one of 47 folders (`vocab/folders_v2.json`, built by `vocab/build_folders.py`): Mulberry's own categories for the 1,028 cards with a Mulberry symbol, the Cboard word lists, and Claude labels for the other 2,059 cards (eight labelling agents, `vocab/claude_folder_labels.json`). Folders above 60 cards are cut into k-means sub-folders named by Claude (`vocab/subfolder_names.json`): 26 parents, 79 sub-folders, no page above 59 cards. A parent page shows its 12 most frequent words plus the sub-folder tiles. The app files are regenerated by `vocab/apply_folders_v2.py` (folders.json with a per-card `card_folder` map, cboard_folders.json with 135 pages).

**Model v3.1** (Modal, 12 min): the same v3 recipe with 46 folder rows instead of 16. Card metrics level with v3 (test_qa Recall@16 0.610 vs 0.608, test 0.555 vs 0.547); dev reranker self-check 0.610 → 0.728 (v3: 0.570 → 0.688). Live on irisspeak.org as chunks `v31/`.

**Board rule.** Routing first (with the question type's own answer words ahead of the folder members), model folder rows only above 8%, keyword triggers, then the folders whose members carry the most model probability (3% or more, top 200 cards). Two slots.

| measure | before (v3, 16 folders) | after (v3.1, 47 folders + sub-folders) |
|---|---|---|
| child bank, answer on the first board | 76/80 = 95% | **80/80 = 100%** |
| child bank, with a content card | 63/80 | 69/80 |
| corpus first answers, 371 questions | 271 = 73% | **302 = 81%** |
| corpus, with a content card | 165 = 44% | 196 = 53% |
| corpus, only reachable through a folder | 7 | 84 |

What the retrain did not do: the 46 trained folder rows pick folders no better than the probability-mass rule (302 either way, 288 when rows below 8% are allowed to fire), so the rows are kept as a tie-breaker only. A third folder slot would reach 84% on the corpus; it was not taken, two slots being the agreed design.

**Where the remaining corpus misses come from** (70 of 371): in every case the target's folder is not among the two shown; the model ranks the target at median position 71. About a third are corpus artefacts (a reply mapped to *Jam* for the name James, *Party* for "reach them", *Furniture* for "What else?"), which no board rule fixes. The child bank, which is the designed measure of "possible question answers", is at 100%.

## 6. The "More ideas" page (10 September 2026, late evening): 90.8% on the corpus

Analysis of the 70 corpus misses showed the target at a median model rank of 71: not on the board, but close. Refresh reaches those cards only page by page. The fix is a permanent **More ideas** tile next to *View all words* (and a cell in the phone grids) that opens the next 60 suggested cards, in model order, as a folder page in the card browser. One tap, no Refresh, and it costs no Topic cell.

| measure | v3.1 + folders (section 5) | + More ideas page |
|---|---|---|
| corpus first answers, 371 questions, on the first board or one tap away | 302 = 81% | **337 = 90.8%** |
| corpus, with a content card | 196 | 233 = 63% |
| child bank | 80/80 | 80/80, content card on 74 |

`eval/board_eval.py` counts the More ideas page by default (`--more 60`, `--more 0` to switch it off). Implementation: `LocalApi.moreSuggestions()` (next 60 ranked cards not on the board), `CardSearchOverlay` `extraRows`, the 💡 tile in `SessionScreen` and `CompactSession`.
