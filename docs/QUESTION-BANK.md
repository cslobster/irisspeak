# Partner question bank: research notes and design

Date: 9 September 2026. The bank the app ships is `aac_next/public/questions.json` (8 places, 285 prompts). This file records where it comes from and the rules it follows.

## How partners should ask (guidance summary)

1. **Fewer questions, more comments.** PrAACtical AAC ("Don't Ask"), AssistiveWare and the EITA partner booklet all say questions put the AAC user in a passive role and elicit one-word answers; leading comments ("You look hungry.", "I had a terrible day!") followed by a pause invite fuller replies. Every place in the bank therefore has a **Comments** group.
2. **Ask what you don't already know.** No test questions ("What colour is this?"), no rituals with one right answer (AssistiveWare Do's and Don'ts: Questions).
3. **Choices bridge yes/no and open questions.** Two named options, then wait, then honour the choice (Expressable, SabiKo). Do not stall at requesting; model other functions too (AssistiveWare).
4. **Wait.** An expectant pause of at least 5 s, 10 s by default, up to 45 s produces more turns and more words (AssistiveWare wait-time post citing Mathis; PrAACtical "On Not Talking"). The app should not re-prompt.
5. **Model without expectation, then expand by one word** (PRC-Saltillo home implementation ladders: More → More that → I want more).
6. **Follow the child's lead; attribute meaning** to gestures and protests (Project Core, EITA).
7. **Target all functions**: request, protest, comment, direct, ask, opinion, share news, greet (AssistiveWare Communication Functions).
8. **Feelings**: label in the moment, offer more than happy/sad, and follow-ups like "Something happened?" and "I need a hug" (PrAACtical Dealing with Feelings).
9. **Repair**: repeat what you understood ("I heard you say…"), narrow by person/place/thing, yes/no ladder from general to specific (George Jeffrey clarification strategies; PrAACtical repair). Every place has a **Check** group.
10. **Specific beats general** for "about your day": "What did you eat for lunch?" not "How was school?" (Autism Classroom Resources).
11. **Clinic**: establish yes first, pain location and intensity, protest words, partner-assisted scanning row by row (SabiKo doctor post; UNC hospital boards; Boston Children's IACP).

## Levels

Following Dowden's continuum as used by the Dynamic AAC Goals Grid, NWACS and the Bridge School:

| mark | level | what the child does | phrasing rule |
|---|---|---|---|
| ● | emerging | one card, or one of two shown | "X or Y?", one-word targets, model first, long pause; yes/no only with a reliable yes |
| ●● | context builder | two or three cards | wh-question inside a routine with a visible answer set, model 2 to 3 words |
| ●●● | independent | open, novel message | genuine open and opinion questions, repair by narrowing, wait up to 45 s |

## UI design (revised 2026-09-09)

Replaced the three-step wizard (place -> category -> question) with a single flat screen: small place tiles
at the top, the five real top questions for that place as big buttons directly below, a large centred mic,
and type/speak underneath. No categories, no drill-down, no level dots.

## Original three-step design (superseded)

Three steps with big tiles, because a parent holding a tablet in a kitchen or a clinic needs one obvious tap at a time: 1 where are you (8 places), 2 what kind of prompt (Choices, Comments, Feelings, What happened, Plans, Needs and help, Social, Check, plus Pain check at the clinic and Recent), 3 the prompt itself, with level dots. Typing or dictating stays at the bottom of every step so a parent is never stuck. The chosen place is saved to the profile and written into the model prompt, so the child's suggested cards match the place as well as the question.

## Provenance

Roughly a third of the prompts are verbatim from the sources below, a third adapted from a source phrase, and a third written to follow the rules above (marked in the research transcript). "Did I get that right?" is our phrasing of the confirm-and-repeat step; no source uses those exact words.

## Sources

PrAACtical AAC (Don't Ask; 9 Tips; 5 Ways to Elicit Language; On Not Talking; Meaningful Communication Opportunities; Dealing with Feelings; Repairing Breakdowns; Holiday Talk; Teaching Interrogatives); AssistiveWare (Do's and Don'ts: Questions; Wait time; Communication partner skills; Communication Functions; Beyond requesting; Choice and control; Emotions; Just Ask); PRC-Saltillo / AAC Language Lab (Home Implementation Activities; Wait Time sheet; Playground core boards); Tobii Dynavox Pathways for Core First; Dynamic AAC Goals Grid; Project Core; ASHA (AAC in Early Intervention; back-to-school AAC tips 2026); Rachel Madel (communication boards; prompting); EITA-PA Communication Partners booklet; George Jeffrey Children's Centre clarification strategies; Expressable (offering choices); SabiKo AAC (mealtimes; doctor's office); UNC / Patient-Provider Communication hospital boards; Boston Children's IACP; Autism Classroom Resources; Communication Community; NWACS communication ability levels; Bridge School communicator profiles; Avaz repair strategies; Lingraphica ordering food.

## Corpus-frequency top 5 (2026-09-09, replaces the earlier hand-curated bank)

Mined directly from the AAC training material: the AAC Conversations dataset's `partner_utterance` field
(12,829 rows, both scene text and question mined) plus every question turn in the aactext.org Turk AAC
dialogues (6,521 turns) -- about 26,000 conversation turns combined. Every question below is a real,
counted occurrence; the number is how many times that exact question (case-folded, punctuation-normalised)
appeared.

**Data limitation, stated plainly**: the corpus is 84% home-scene conversation. School, restaurant, doctor,
play, transport and bedtime each had under 250 tagged turns, and almost every question in those small
samples occurred only once -- not enough to rank with confidence. Home and "Somewhere else" (1,723 tagged
turns) are the two settings with real frequency signal. For the other six, the setting's own repeats (where
any existed, e.g. "Anything to drink?" for restaurant, "Want me to come with you?" for doctor) were kept,
and the rest of the five were filled from the single most frequent questions across the whole combined
corpus that fit that setting, rather than invented.

| setting | top 5 (count) |
|---|---|
| home | How was your day? (70) · How are you feeling today? (40) · How did you sleep? (32) · What happened? (41) · What do you want to eat? (24) |
| school | How's it going today? (1, school-tagged) · What did you learn? (9) · What do you need help with? (19) · What did you do? (13) · Ready for the day? (12) |
| restaurant | What do you want to eat? (24) · Anything to drink? (2, restaurant-tagged) · Any favorites? (23) · Anything else? (62) · What do you like most? (10) |
| doctor | How are you feeling today? (40) · What do you need? (24) · Anything else? (62) · How do you feel about that? (9) · Want me to come with you? (2, doctor-tagged) |
| play | What do you want to do? (8) · Did you enjoy it? (9) · Any plans for today? (22) · What do you like most about it? (13) · Ready for today? (8) |
| transport | Where are you going? (7, Turk) · Are you sure? (14) · What time is it? (8, Turk) · How long will that take? (2, Turk) · What did you do? (13) |
| selfcare | Ready for sleep? (1, selfcare-tagged) · Want a story before bed? (1) · Do you want a blanket? (1) · Any dreams? (1) · How was your day? (70) |
| unknown | What happened? (41) · How are you feeling today? (40) · What do you mean by that? (12) · Any favorites? (23) · What do you need? (24) |

Bank file: `aac_next/public/questions.json` (`settings.<id>` = 5 `{q, n}` entries).
