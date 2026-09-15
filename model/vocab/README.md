# Study vocabulary

`vocab.csv` is the card inventory the candidate model, the reranker, and the mapper all share.
`registry.json` carries the same ids plus a `version` hash; the exported model must embed that hash so a
model/vocab mismatch fails at load time. Ids are append-only: rebuild with `--registry registry.json`
and new cards get new ids, existing cards keep theirs.

## How it was built (`build_vocab.py`)

This is a curated selection, not a union of lists.

1. **Always in:** CBoard Classic (cbc, 723 cards; 8 removed, see below), Project Core Universal Core 36,
   and a curated set of ~180 safety / refusal / repair / social / request / feeling / answer cards.
2. **Candidate pool:** every word that appears in at least 4 of the 25 vocabularies exposed by the
   openboardformat.org comparison tool (Quick Core 24-112, WordPower 20-108, LAMP WFL 84, Speak For
   Yourself, Super Core 12/30/50, Vocal Flair 24-112, Voco Chat, CBoard Universal Core, Sequoia 15), or
   in at least 2 lists with corpus frequency >= 25.
3. **Cleaning:** inflections folded into their lemma and kept as aliases (played -> play), proper-noun
   instances dropped (US states, countries, holidays), infinitive duplicates dropped (to eat when eat
   exists), a hand blocklist of political/junk entries, punctuation stripped from labels.
4. **Usefulness score** = 10 x (share of lists containing the word) + 1.5 x log(1 + AAC corpus frequency)
   + bonuses for CBC / curated / Project Core, penalty for phrases longer than 3 words.
5. **Per-category quotas** (actions 330, describing 240, phrases 300, things 280, food 190, ...) take the
   top-scored candidates per category. Mandatory and core cards bypass quotas.
6. **Multiword policy** (see below) prunes free compositions that single-word cards already express.

Corpus frequency comes from two AAC-like corpora in `data/raw/`: the aactext.org "imagine"
crowdsourced communications (6,141 sentences, CC BY 4.0) and Vertanen's Turk dialogues (1,419 six-turn
chains, CC BY-ND 3.0 per its readme; only word counts are used here).
The final vocabulary covers 94.6% of the tokens in those corpora (lemma or alias match).

## Columns

| column | meaning |
|---|---|
| id | `card_NNNN`, stable, append-only |
| label | lowercase canonical label, apostrophes only, no other punctuation |
| speak | spoken / displayed form with "I" capitalised ("I'm hungry") |
| aliases | `\|`-separated surface forms the mapper accepts (US spellings, inflections, "i'd like" -> "i want") |
| category | core, actions, describing, phrases, people, food, drink, body, health, feelings, places, things, home, clothes, animals, school, activities, play, transport, time, numbers, colours, weather, nature, ideas, music, quantity, questions, technology |
| pos | noun, verb, adj, adv, pron, aux, func, wh, num, phrase, interj, other |
| intent | content, request, refuse, affirm, question, repair, safety, social, feeling, answer, number, statement |
| core | 1 = Project Core, curated core, or in >= 20 of 25 lists and a function/verb/descriptor category |
| safety | 1 = refusal, repair, or safety intent; these cards get fixed grid positions |
| tier | core, cbc, curated, fringe |
| words | token count of the label |
| composable | 1 = every word of a multiword card is itself a single-word card |
| components | ids of those single-word cards, in order |
| sources | which mandatory sets and how many lists contributed |
| list_count, corpus_freq, score | evidence used for selection |

## Multiword cards and training

565 cards are multiword. They fall into two kinds, and training treats them differently:

- **Lexicalised or pragmatic (158, composable = 0):** ice cream, guinea pig, thank you, say it again.
  These are atomic. There is no alternative way to say them, so the mapper always emits the phrase
  card and the reward treats it as one unit.
- **Composable (407, composable = 1):** i want, police car, what time is it. The `components` column
  lists the single cards that spell the same thing. These are kept because AAC users select them as
  one tap, but the training data must not punish the model for producing the components instead.

Rules used by the mapper, the loss, and the reward:

1. **Mapping** an English answer to cards uses longest-phrase-first over label + aliases, but for a
   composable phrase it records both the phrase sequence and the expanded sequence as acceptable
   targets. "I want pizza" therefore yields `[i want, pizza]` and `[i, want, pizza]`.
2. **Soft targets** for next-card training put mass on both continuations at the branching state:
   after an empty prefix the acceptable next cards are `i want` and `i`.
3. **Reward and F1** compare sequences after expanding composable cards to their components
   (`expand(seq)`), so `[i want, pizza]` and `[i, want, pizza]` score identically. A brevity term then
   rewards the shorter tap count, which is what favours the phrase card in practice.
4. **Embeddings** for a card token are initialised from the mean of Qwen's embeddings of its
   `speak` form; composable cards additionally average their component card embeddings (50/50).
5. **Slate diversity** should not show a composable card and all of its components at once; the
   reranker's diversity penalty uses the `components` column.

## Removed from CBoard Classic

Six labels were dropped as broken or non-card entries: `chicken live`, `it assistant`, `no class`,
`to sleep male`, `pool snooker`, `usb stick`. Five spellings were corrected (deodorant, brussels
sprouts, mashed potato, jewellery, spring onions). Everything else in CBC is kept,
including every multiword card, with a US alias where the label is British English.

## Rebuild

```
python3 vocab/build_vocab.py \
  --lists vocab/sources/obf_lists --scratch <dir with aac_comm/ and turk-dialogues.txt> \
  --out vocab --registry vocab/registry.json
```

Source-list note: the word lists in `sources/obf_lists` were fetched from
`https://www.openboardformat.org/words?list=<code>` for comparison. Vendor vocabularies (WordPower,
LAMP, Vocal Flair, Speak For Yourself, Super Core) remain their owners' property; only the words were
used as evidence of consensus. CBoard Classic and Project Core are open licensed (CC BY / CC BY-SA).
