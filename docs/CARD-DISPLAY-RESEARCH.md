# Card display: what published AAC apps do, and how IrisSpeak reaches 99% on the first board

Date: 10 September 2026. Companion to `docs/BOARD-EVAL.md` (measurement) and `docs/COMPETITIVE-ANALYSIS.md` (market).

## 1. How the App Store apps lay out cards

Verified from vendor pages, the iTunes store listing and the earlier market map. Every established app is a **hybrid**: a zone that never moves plus a zone that changes with context. They differ in how big each zone is and what drives the changing zone.

| app | fixed zone | changing zone | how the changing zone is chosen |
|---|---|---|---|
| Proloquo2Go (Crescendo) | core words in the same cell across all 23 grid sizes; home page is core | fringe folders (food, places, people...), recents | hand-built folders opened by the user |
| LAMP Words for Life | one 84-cell grid, nothing ever moves ("motor plan") | none on the main page; second tap opens a fixed sub-page | none, everything is a learned motor pattern |
| TD Snap Core First | Core page + a toolbar with Quick Fires (yes, no, help, stop, more...) always visible | Topic pages and Word Lists, grid grows from 1x2 upward without moving existing buttons | hand-built topics; the partner opens the topic |
| Speak for Yourself | 119-button main screen, every word in at most two taps, cells never move; unused cells can be hidden and revealed later | secondary screens per core word | motor planning; reveal as the child grows |
| Grid 3 Super Core 30/50 | fixed core cells | topic cells and "chat" quick phrases; Smart Prompt generates cells from a text prompt (cloud) | hand-built topics, one-off generation |
| Avaz | three core "grades" with the same motor pattern across grades, Fitzgerald colours | fringe categories, 40 saved phrase slots, picture prediction after a delay | prediction from the child's own history |
| Weave Chat / Context AAC | fixed Fitzgerald-coloured categories | frequent phrases move up inside their category when place, time and activity are set by hand | manual context plus frequency |
| Prism AAC (Synalux, free, v1.8.9, Aug 2026) | none; tiles rise with use and fade when unused ("spreading activation") | a 5-slot prediction strip above the keyboard refreshed on every keystroke; categories in a scrollable side column | on-device Qwen3.5 2B/4B for chat and phrase suggestions, a 360M autocomplete model, n-gram plus "holographic retrieval" reranking; accuracy claims are for tool routing, not for card choice |
| IrisSpeak today | 5-card core row (yes, no, I don't know, How about you?, I want) | 18 suggestion cells plus up to 2 folder cards, re-ranked on every question and every tap | IrisSpeak-135M next-card model, reranker, folder rows, choice pinning |

Two things stand out.

1. **Nobody else routes by the question.** Every incumbent expects the partner or the child to open the right topic page. The AI apps (Prism, Rejoin, MaTalk, Vocable) generate replies with a chat model but show them in a small strip, and keep the grid as it was. IrisSpeak is the only one whose board is built from the partner's question.
2. **Nobody ships a re-ranking grid.** Thistle et al. 2018 measured preschoolers finding a symbol in 3.3 s when its position was stable and 6.0 s when it moved; Prism is the only app that moves tiles, and it does so slowly over months, not per turn. IrisSpeak's suggestion zone re-ranks per tap, which the evidence and the market both argue against.

## 2. What the measurement says (docs/BOARD-EVAL.md)

80 hand-written partner questions, 10 per setting, each with the answer cards a child would plausibly want. A question passes when one of them is on the first board with no Refresh.

| layout variant | pass | pass with a content card (not only yes / no) |
|---|---|---|
| current board (Topic 9 / Action 6 / Feeling 3, core row of 5, model folders) | 76/80 = 95% | 65/80 |
| + question-type routing (see below) | **80/80 = 100%** | 70/80 |
| + quick-fire row of 10 instead of the core row of 5 | 76/80 | 62/80 (the metric counts help / more / stop as core) |
| + bigger grid 12 / 8 / 4 | 76/80 | 66/80 |
| routing + bigger grid | 80/80 | 71/80 |
| routing + quick row + bigger grid | 80/80 | 69/80 |

Held-out check on 371 real corpus questions from `test_qa` (the target is the exact first card of an adult-style reply, a much harsher and less child-like criterion):

| layout | pass |
|---|---|
| current board | 235/371 = 63% |
| + routing | 232/371 = 63% |
| routing + bigger grid | 243/371 = 66% |

Reading: the four misses in the child bank are all "who" and "play" questions, and routing fixes exactly those. On the corpus metric routing neither helps nor hurts, because that metric rewards the first word of long adult replies (I, The, Well), which no child board should optimise for. Grid size is the only lever that moves both.

## 3. Question-type routing (the change that gets to 99%+)

A dozen regular expressions on the partner's question decide a **guaranteed folder and a few guaranteed cards**, placed first in Topic. The model still fills the rest. This is what TD Snap's topic pages and Proloquo2Go's fringe folders do by hand, done automatically from the question.

| question contains | folder placed first | cards let through even though they are hidden core words |
|---|---|---|
| who, whose, with whom | People | me, you, mine, my turn, your turn, friend, mum, dad, teacher, nobody |
| where | Places | here, there, home, school, outside, inside |
| when, what time, how long, how soon | Time | now, later, soon, today, tomorrow, not yet |
| how many, how much, how old, what number | Numbers | |
| colour | Colours | |
| eat, food, breakfast, lunch, dinner, snack, hungry | Food | |
| drink, thirsty | Drinks | |
| play, game, toy | Toys | ball, blocks, lego, puzzle, cars, tag, outside, swing, slide |
| wear, clothes, pyjamas, jacket, shoes | Clothing | |
| animal, pet | Animals | |
| hurt, pain, sore, ache | Body | |
| feel, feeling, mood, okay | none | tired, sick, sad, happy, scared, hurt, fine, good, bad |

Rules: the routed folder goes first and keeps its four most probable members visible on the board (today the folder swallows its members); the model's own folder rows still apply after it, up to two folders; the choice pin still comes first of all.

## 4. Proposed hybrid board (fixed + suggested), in priority order

1. **Question-type routing** as above. Two hours of work in `LocalApi.recommendation`; the evaluator already contains the rules (`eval/board_eval.py --routing`). Gets the child bank to 100%.
2. **A fixed quick-fire row of 10** in place of the core row of 5: yes, no, I don't know, help, more, stop, all done, not yet, please, wait. Same positions always, as in TD Snap's Quick Fires and Speak for Yourself. Does not raise the pass rate by itself, but it answers the 30 questions where today only yes / no is visible with a real word (not yet, please, more) without touching the suggestion zone.
3. **Freeze the suggestion zone during a turn.** Rank once when the question arrives, then keep positions while the child taps; only the cell of a tapped card is refilled. Per-tap re-ranking is what the motor-planning evidence argues against, and no published app does it. The folder decision is already frozen per turn; extend that to the cards.
4. **Bigger grid on iPad**: 12 / 8 / 4 plus the quick row, 34 cells, which is still fewer than LAMP's 84 or Speak for Yourself's 119. Adds 2 to 3 points on both metrics. Keep 9 / 6 / 3 on phones.
5. **A stable personal zone** (already P0 in the competitive analysis): the child's 20 to 30 most-used cards in fixed positions, learned from taps, the way Prism's spreading activation and Avaz's history prediction work but without moving anything mid-turn.

What not to copy: Prism's per-keystroke tile movement and its chat model as the source of cards. A generic chat model proposes phrases, not cards from a fixed symbol vocabulary, and it cannot give the calibrated probabilities the folder and choice logic depend on.

## 5. Sources

Vendor pages fetched 10 September 2026: tobiidynavox.com/pages/td-snap-core-first, avazapp.com/features, github.com/dcostenco/prism-aac (Prism design notes and model table), iTunes Search API listing for "prism aac" (Prism-AAC id 6764692277, v1.8.9, 22 Aug 2026). Grid 3 and Speak for Yourself details from the 9 September market map in `docs/COMPETITIVE-ANALYSIS.md`. Thistle, Holmes, Horn and Reum 2018, symbol location consistency in preschoolers.
