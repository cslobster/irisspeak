# How AAC apps let users choose context, and what IrisSpeak takes from it

Date: 9 September 2026. Companion to `docs/QUESTION-BANK.md` and `docs/COMPETITIVE-ANALYSIS.md`.

## Patterns found

| pattern | examples | who sets it | evidence |
|---|---|---|---|
| Folder or tile grid of topics | TD Snap Core First (79 topics, colour-coded by intent), Proloquo2Go activity folders, Avaz folders, WordPower activity pages | partner authors, user navigates | vendor claims, large user bases |
| Persistent core plus swapped fringe | Grid Super Core dynamic columns, Avaz Frozen Row, Proloquo2Go core kept in home positions | same | design consensus: core never moves |
| Context chips plus free text | Context AAC (Weave Chat, 2026): a chip row "Morning · Coffee shop · Coffee", "Add a context detail", Recent contexts, optional coarse location | the AAC user | 8 ratings, no study |
| Scene photo with hotspots | Snap Scene, GoTalk NOW scene pages, just-in-time visual scene displays, Click AAC / QuickPic | partner, in the moment (about 25 s to add a scene) | strongest evidence for beginning communicators: +13 to 26 communicative turns per 15 min in single-case studies (Holyfield 2019, Drager 2019 and 2025, Caron 2016) |
| Small fixed topic picker plus partner guide cards | AACessTalk (CHI 2025): three home tiles (Plan, Recall, Interest); after each parent turn three guide cards (ask for elaboration, suggest choices, provide clues, extend topic, wrap up) with an example phrase revealed on tap | parent and child together | two-week deployment, 11 dyads, guides used in 78% of parent turns |
| Highlight only, no re-layout | Lighthouse AAC "golden glow" on at most 4 buttons by time block and recent taps | automatic | design rationale, no study |
| Sensed context | CoughDrop geofence, Wi-Fi name, time window or place type promotes a board for about two minutes; Lighthouse hashed Wi-Fi plus clock; Prism camera scene types; Speak4Me GPS places | automatic after one-time setup | none published |
| Partner-speech driven | MaTalk AI, Converser (2008), Holyfield 2025, COMPA | automatic from the partner's speech | small single-case studies show faster, more accurate responses |
| Pragmatic starters | PODD branch starters ("I'm telling you something", "Something's wrong"), Talking Mats (topic, options, like / unsure / dislike) | user or partner | Talking Mats has controlled studies in dementia |

No shipping AAC app switches boards by NFC, QR or calendar; the only beacon work is academic.

## What IrisSpeak does now

- A bounded picker of eight places as large tiles, set by the parent, saved to the profile and written into the model prompt (pattern: small fixed picker, as in AACessTalk).
- Partner prompts on the same screen, grouped by purpose and revealed step by step (pattern: guide cards), with level dots and a Recent group.
- After the child answers, a Follow up group appears first (ask for more, suggest choices, extend, check, wrap up), the five guide types AACessTalk found parents used most.
- Options named in a choice question are pinned onto the child's board, so every prompt arrives with its answer set (pattern: Talking Mats topic plus options).
- The core row never moves; the suggestion panels still re-rank and are scheduled to become a fixed grid plus a frozen tray.

## Not adopted yet, and why

- Free-text context chips (Context AAC): assumes a literate user typing; our parent-first tiles cover the same ground with one tap. A "add this place with a photo" tile is the natural extension and borrows the scene-photo evidence.
- Automatic detection: worth doing as a one-tap suggestion banner ("Looks like you're at school, switch?") using coarse signals kept on the device, after the stable grid ships.
- Time of day: the model was trained without it; adding it to the prompt needs a retrain to mean anything.

Sources are listed in the research transcript summary; key ones: Context AAC App Store listing and privacy policy; Tobii Dynavox Core First page-set guide; Smartbox dynamic columns; AssistiveWare activity templates; Avaz Frozen Row; CoughDrop sidebar settings source; Lighthouse ADRs; Prism README; Holyfield et al. 2019 (PMC6123279); Caron, Light and Drager 2016; Choi et al., AACessTalk, CHI 2025; Valencia et al., COMPA, CHI 2024; Fontana de Vargas et al., ASSETS 2022 and CHI 2024; Kent-Walsh et al. 2015 meta-analysis; Murphy 2010 Talking Mats.
