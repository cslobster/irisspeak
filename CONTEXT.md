# IrisSpeak — Domain glossary

Vocabulary for the **current on-device design** (since 2026-09-15). `CLAUDE.md` is the orientation
document (architecture, routes, file map, workflow); this file only defines terms so conversations
and code use the same words. Add an entry when a new domain concept gets its first real design
discussion; delete or correct entries that go stale.

The pre-2026-09 glossary (Corpus, Corpus Enrichment, Folder Card triggers via `folder_cards.yml`,
Card Pool, Small-Talk Card, Multi-Digit Number Tap, Vocabulary Slot taxonomy, ARASAAC expansion plan)
described the deleted cloud-LLM path. It is preserved in git at `git show 4014939:CONTEXT.md` and
is **not** a description of the shipped product. The reasoning that still matters is folded into the
entries below.

## People and accounts

**Dyad** — a parent–child pair; the unit of account (`dyad` table). Holds child name/gender/age,
free-text notes, `communication_style`, `setting`, the parent's email, Google identity, and
`status` (`pending` after self-serve signup until an admin approves; `active` otherwise). One dyad
is shared by the web app, iOS app and admin site.

**Partner** — whoever is talking with the child (parent, teacher, clinician). The partner asks;
the child answers with cards. "Parent turn" and "partner turn" are the same thing in code.

**Login code** — the password for alias+code sign-in (`dyad_login_code`). Chosen by the parent at
signup, stored inactive, activated on admin approval. Google sign-in bypasses it.

**Guest** — the hardcoded `guest`/`12345` dyad behind "Continue as Guest".

## The conversation

**Session** — one conversation (`session` table): `initial → started → conversation → terminated`;
gets an optional 1–5 rating and a title (first partner message, or a best-effort Gemini caption at end).

**Turn** — one side of the exchange: a partner turn (text) or a child turn (cards + the realised
sentence). The app mirrors each turn to `POST …/device/turn`. A child may bank several sentences
before pressing Done; each is its own turn.

**Setting / Place** — where the conversation happens: `home, school, restaurant, doctor, play,
transport, selfcare, unknown` (`engine/settings.ts`). Saved on the profile, written into the model
prompt ("Setting: school."), picks the question bank, and biases the personal row. The v7 model was
distilled specifically so it *uses* this token (earlier data had random setting labels).

**Question bank** — `public/questions.json`: the top partner questions per setting, ranked by real
frequency in the AAC training corpora (see `docs/QUESTION-BANK.md`). Shown in `AskPanel`.

## Cards and the board

**Card** — one tappable vocabulary item. Identity = a stable id from `model/vocab/vocab.csv`
(`card_0000`…); display word = `speak`; picture from `card_images.json` (Mulberry SVG, OpenMoji SVG,
or an emoji fallback). Vocabulary categories (food, actions, feelings, core, phrases, …) collapse to
four UI categories: **topic** (things), **action**, **emotion/feeling**, **core** (function words).
Colours follow the Fitzgerald Key.

**Vocabulary** — the 3,238-card inventory (`model/vocab/vocab.csv`, append-only ids, curated from
Cboard Classic, Project Core, and 25 published AAC vocabularies; see `model/vocab/README.md`). Custom
words and folder browsing extend it per child; the model itself only ever ranks these rows.

**Board** — everything shown for one child turn: the Topic/Action/Feeling **panels** (15/3/3 on
iPad, 12/3/3 on phones), at most one **folder card** in the last Topic cell, and the **quick row**.

**Quick row** — fixed-position cards that never re-rank: `yes`, `no`, `please`, then five
**personal cards**, then "More ideas" and "View all". Modelled on TD Snap's Quick Fires.

**Personal card** — one of the child's own words for the current question: cards from their
history (weighted by same setting and recency), words in the profile notes, and custom words, scored
by the model's probability for *this* state (`engine.personalRow`). A brand-new child gets the
model's next-best content cards instead.

**Folder card** — a card that opens a Cboard folder (Numbers, Food, People…) instead of adding a
word. Decided once per question and frozen: question-type routes → the model's own `<folder:*>`
output rows (≥ 8 % probability) → keyword triggers (`public/folders.json`) → the folder whose members
carry the most ranking mass. Exists because open-set answers ("How old are you?") need a picker, and
because both an LLM and a small model miss the obvious case often enough to want a regex backstop.

**Route (question-type routing)** — regexes in `local.ts` (`ROUTES`, `SETTING_ROUTES`) that map the
*shape* of a question (who / where / when / how many / colour / "A or B" …) to a folder and to
normally-hidden core words that answer it (me, here, now…). Steers, never pins answer words (pins
were removed when the distilled model stopped needing them).

**Choice cards** — options named in the question ("juice or milk?") are looked up by label and pinned
to the front of their panels, because offering a choice only works if both options are on the board.

**Dead rows** — the ~340 vocabulary rows with no training target; masked out of the softmax at train
and inference time. Still reachable through search, folders and custom words.

**Prior debiasing** — model-only ranking uses `log p − 0.5·prior` so cards the data names everywhere
(Tired, Wait, Need) stop crowding every panel.

**Reranker** — a 3-layer MLP over the model's top-K with MiniLM question similarity and personal
features. Retained for A/B (`profile.reranker_ab`) but **off by default** since the distilled model.

**Free card** — a card not in the vocabulary: a long-press word form (`grammar.ts`), a searched
Cboard word, or a custom word. Goes into the sentence like any other card.

**Custom Vocabulary Word** — a per-dyad word (`dyad_custom_word`): parent-typed, category topic or
action, with an uploaded image (base64) or an emoji, optionally an `is_preference_pointer` marking
an existing vocabulary word as a favourite. Synced to the device and used by search and the personal
row. The "AI-detected from transcripts" source from the old PRD is not built.

## Sentence

**Realiser** — the on-device sentence model (SmolLM2-135M fine-tune): tapped cards + the partner's
question → one sentence, decoded under a hard constraint (only card words, their inflections, a
fixed list of function words, and punctuation; negation words unlock only when a negation card was
tapped). Until it has loaded, the **rule realiser** (`engine.realise`: cards in order, capitalised,
punctuated) is used. "Another" re-samples avoiding earlier candidates.

**Banked sentence** — a sentence the child approved and the app spoke; several can be banked in one
child turn before Done hands the turn back.

## Feedback and learning

**Board feedback** — the partner's verdict on one board (`board_feedback`): "I don't like these
cards" with the crossed-out ids, or "the child wanted to say …" with the partner's own answer, plus
the board as shown, the prefix, setting, question and model version. Training material for the next
card model (`/admin/feedback?format=jsonl` → `model/data/build_states.py`).

**History** — the child's last 50 confirmed turns, kept on the device and pulled from
`/dyad/history` on sign-in so other devices' turns count too. Feeds the personal row and the
"Earlier:" line of the model prompt (only the last two turns — more let old answers outweigh the
question).

**Personalisation** — the standing goal that boards adapt to the child. Implemented today as: the
personal row (behaviour), profile notes and custom words (parent-stated), setting (context), and
board feedback (partner-corrected, offline via retraining). No per-child model weights.

## Model pipeline terms

**Card model** — the next-card ranker (SmolLM2-135M + a card output layer over the vocabulary +
folder rows). Shipped version **v7**. **Distillation** — training the card model on a large
teacher's next-card *distribution* rather than sampled replies (`docs/DISTILLATION.md`).
**States** — (setting, question, tapped prefix) → target distribution rows built by
`build_states.py`. **Blind judge** — an LLM asked "could a child answer this question with these
cards?" per board, used as the acceptance gate for a new model (`model/eval/judge_boards.py`).
**Manifest** — `manifest.json`/`realiser_manifest.json` on R2 listing the weight chunks; the
version directory (`v7/…`) is recorded with every feedback row.

## Admin analytics

**Daily Active Users** — distinct dyads with ≥ 1 `user_event` per calendar day
(`/admin/analytics?view=dau`). Neon returns the `::date` column as a full ISO timestamp — slice to
10 characters before parsing.
