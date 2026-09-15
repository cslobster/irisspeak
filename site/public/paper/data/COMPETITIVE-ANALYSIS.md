# IrisSpeak competitive analysis and feature roadmap

Date: 9 September 2026. Prices, ratings and release dates were checked on the US App Store (iTunes lookup) on this date; vendor feature claims are marked as such where they could not be tested. Evidence citations are at the end.

## Bottom line

Your draft's conclusion is right and the research sharpens it in four ways.

1. "AI-powered AAC" is no longer a position. Twenty-plus apps now say it. Three actually listen to the partner (MaTalk AI, Rejoin, Vocable), one runs a generic on-device LLM (Prism), and the incumbents (PRC-Saltillo's LAMP and TouchChat, Grid, Avaz) added Apple-Intelligence or cloud "AI edit / translate / image" features in 2026. Drop the "world's first language model for AAC" line from the app and the site.
2. What IrisSpeak has that nobody ships is a **purpose-trained on-device next-card model with published accuracy**. Every competitor's prediction is either a generic LLM in the cloud, a generic small LLM on device, an n-gram autocomplete, or a heuristic glow. Nobody publishes recall numbers. That is the asset to build the positioning on.
3. IrisSpeak's board currently does the one thing the evidence and the newest competitors argue against: it re-ranks all 18 suggestion cards after every tap. Stable positions are the clinical baseline (Thistle 2018: consistent locations cut symbol-finding time from 6.0 s to 3.3 s; variable locations showed no learning). Lighthouse, Sayella, SpeakPad and Context AAC now market "buttons never move" explicitly. This is the first thing to change.
4. IrisSpeak is a strong prediction engine inside a thin AAC shell. It lacks most of what every established app treats as baseline: custom words and photos, multiple profiles, backup, switch scanning, grammar forms, label-versus-spoken text, caregiver editing. Those gaps, not the model, are what would stop a parent or SLP adopting it today.

Recommended positioning: *IrisSpeak helps symbol-based communicators join real conversations by offering a few personal, context-aware possibilities for answering, asking and repairing, from a model that runs on the device and whose accuracy we publish, without moving the core vocabulary they rely on.*

## 1. Market map

### Established apps (verified 9 Sep 2026)

| app | price | vocabulary and symbols | prediction / AI | caregiver tools | access | rating |
|---|---|---|---|---|---|---|
| Proloquo2Go | $249.99 one-time (vendor site $299.99) | Crescendo 4,750 direct + 7,250 stored words; 25k+ SymbolStix; 23 grid sizes | none; full morphology popups | iCloud auto-backup, manual transfer, no live sync | switch scanning, VoiceOver | 4.8, 12k ratings |
| LAMP Words for Life | $299.99 | fixed 84-cell Unity grid, 3,000+ words | Apple-Intelligence "AI Message Edit / Translate / Image" (2026, off by default) | Realize Language logging (subscription) | scanning, head tracking | 3.8, 93 |
| TD Snap | free + $9.99/mo for speech | 75k PCS; Core First, Motor Plan, Text, Aphasia, Scanning sets | none found | cloud sync, modeling counts, dashboards | eye gaze, switch, touch | 4.1, 825 |
| TouchChat WordPower | $299.99 | 40k SymbolStix; WordPower 25 to 140 | same Apple-Intelligence trio as LAMP | Realize Language, iShare, profiles | scanning, head and eye tracking | 3.9, 131 |
| Avaz | $9.99/mo, $99.99/yr, lifetime $199 to $299 | 40k SymbolStix; 60 to 117 pictures per screen | "Expressive Tones" (AI emotional TTS, online) | Avaz Live remote editing and modeling, partner dashboard | switch via OS, eye-tracker compatible | 4.1, 315 |
| Grid for iPad | $10.99/mo or $299.99 | SymbolStix, PCS, Widgit; Super Core sets | "Fix" grammar and "Smart Prompt" cell generation (cloud) | remote editing, message banking, print | switch via iOS; no eye gaze on iPad | 3.6, 18 |
| CoughDrop | $9/mo or $295 lifetime | 57k open symbols, custom sizes | none | free supporter accounts, remote editing and modeling, reports, OBF export | scanning, camera head and eye tracking | 3.7, 61 |
| Proloquo (subscription) | $9.99/mo | AssistiveWare vocabulary, 48+12 layout | none; Focus Mode highlights targets in place | free team sync | direct selection only | 3.9, 144 |
| Speak for Yourself | $299.99 | fixed 119-button core, any word in 2 taps, 14k words | none | profiles, backup, no data collection | direct selection only | 4.6, 404 |
| GoTalk NOW | $119.99 / $189.99 | user-built books, 1 to 49 cells, scenes | none | Dropbox backup, print to PDF | scanning | few ratings |

Baseline present in seven or more of the ten: fixed-position core words, a licensed symbol library, several grid sizes, switch scanning, cloud backup, multiple profiles, bilingual vocabularies, keyboard with prediction, neural and Personal Voice output, offline speech. One-time $250 to $300 is the dominant price; subscriptions cluster at $9 to $11 a month.

### AI and context apps (verified 9 Sep 2026)

| app | price | target | what the AI actually does | where it runs | ratings |
|---|---|---|---|---|---|
| MaTalk AI | $4.99/mo, $49.99/yr | nonspeaking children, pictures | listens to speech around the child and shows generated picture replies; "smart starters"; AI images | ASR cloud by default, on-device option added later; LLM provider undisclosed; collects audio data per privacy label | 4.4, 7 |
| Rejoin Voice | free core; $12.99/mo | literate adults with ALS, Parkinson's, stroke | listens on device; three replies in the user's style with a tone choice; learns phrases with approval; caregiver handoff notes | Apple on-device ASR, Anthropic cloud LLM, no training on data | 5.0, 1 |
| Prism AAC | free, open source | motor-impaired users, hospitals | on-device Qwen 2B/4B chat and phrase suggestions, camera "vision context", n-gram prediction; Apple Watch, bedside mode | on device with cloud fallback; safety filter still buggy per release notes | 5.0, 1 |
| Lighthouse AAC | free, non-profit | nonspeaking children | no LLM: a "golden glow" highlights likely words by time of day and recent taps; buttons never move | on device | 5.0, 1 |
| Context AAC (Weave Chat) | $14.99 one-time | phrase-based, literate-leaning | board adapts to manually entered place, time and activity; frequent phrases move up within fixed categories | small on-device models, no server | 5.0, 8 |
| Spoken | $12.99/mo, $249 lifetime | literate teens and adults | next-word chips that learn the user's style (premium) | unstated | 4.3, 160 |
| Fast AAC | free, $12.99 one-time | symbol users | next-tile suggestion from the user's own entries | on device | 4.3, 7 |
| Flexspeak | $9.99/mo, $299.99 lifetime | multilingual families | "AI prediction" completes partial phrases; translation; remote editing and sync | unspecified, needs Wi-Fi | 4.2, 5 |
| Tala | free; Plus $9.99/mo | gestalt language processors | AI only at setup: boards generated from the child's profile via Claude | cloud at setup | 4.9, 21 |
| Vocable | free | motor-impaired adults, head tracking | asks a question aloud, shows generated response options (since 2023) | Azure OpenAI | 4.5, 60 |
| CardSpeak AI | $4.99/mo | PECS-style children | sentence polishing, AI card images | cloud | 5.0, 1 |
| Sayella | £7.99/mo, £189 lifetime | first words to literate | AI symbol generation only; markets stable positions, scanning from day one, modeling mode | n/a | 0 |
| ChirpBot | $4.99 to $9.99/mo | children 1 to 12 | context-aware word engine; paid tier sends the current sentence to a cloud LLM | on device free, cloud paid | 0 |
| GoTalk About It (ex QuickPic) | $49.99 | children | topic boards generated from a photo; the only app here with a peer-reviewed study | cloud GPT | 4.0, 3 |
| Weave Chat | free | symbol users, all ages | none | n/a | 4.7, 512 |

Every app launched since mid-2025 has between 0 and 21 ratings. The claims are developer claims; none has published accuracy, latency or outcome data. Two patterns matter for IrisSpeak: the AI tier is almost always the paid tier at $5 to $13 a month, and several new entrants market the opposite of dynamic boards.

## 2. Where IrisSpeak stands today


Verified against the code in `aac_next/` (web, irisspeak.org) and `irisspeakapp/` (iPad).

| area | status | detail |
|---|---|---|
| core engine | done | IrisSpeak-135M next-card model + reranker + MiniLM similarity, all on device; every tap re-predicts in well under a second |
| vocabulary | done, fixed | 3,094 cards (+ name slot, end marker); 23 extra search-only words; no user-added words in the model |
| board layout | done | Topic 9 / Action 6 / Feeling 3 panels re-ranked on every tap; fixed core row (yes, no, I don't know, How about you?, I want, I'm <name>); Refresh pages deeper |
| stable positions | **no** | every suggestion panel is re-ranked after each tap; only the core row is stable |
| message bar | done | selection strip with tap-to-remove; Undo/Clear on web |
| speech | done | each tapped card spoken; whole sentence spoken on approval; mute toggle; no per-word repeat button, no backspace/delete-last on iPad |
| sentence generation | done | cloud endpoint (OpenAI) turns cards into a sentence when online; on-device rule (cards in order) offline; child approves before it is spoken/banked |
| partner input | done | parent types or dictates; question drives the prediction |
| context | done | setting (home, school, …), last 50 confirmed exchanges in the prompt, profile text → personal cards, per-card usage bonus |
| conversation history / transcript | done | per session, local only; previous conversations list with rating |
| profile | done | one profile: name, setting, age, communication style, notes; reranker toggle; clear history |
| multiple users | **no** | single profile per device |
| custom words / photos / recorded audio | **no** | vocabulary is closed; View all only searches the bundled Cboard list + 23 extras |
| label vs spoken text, pronunciation editor | **no** | |
| grammar / word endings | partial | cloud sentence step supplies grammar; no morphology buttons |
| grid size / spacing / hold time | partial | three text sizes; fixed 3/2/1 panel geometry; no dwell/hold time on touch |
| access methods | partial | touch; iPad app has an eye-gaze mode (ARKit) with dwell; no switch scanning; no head tracking on web |
| offline | done (web after first load; iPad fully) | model cached in the browser; cloud sentence degrades to the on-device rule |
| privacy | done, informal | no account, no server storage of conversations; the only network call is the optional sentence endpoint (cards + question sent to OpenAI via our server); no written policy, no microphone indicator beyond the OS one |
| caregiver tools | **no** | no remote editing, sync, roles, modeling mode, analytics dashboard |
| backup / export / import | **no** | local storage only |
| printable low-tech board | **no** | |
| bilingual | **no** | English only |
| symbols | done | 1,211 cards with Mulberry/ARASAAC pictures, 1,884 with emoji |
| instrumentation | partial | benchmark numbers on the research site; no in-app metrics (time to first tap, taps per message, suggestion acceptance) |
| platforms | done | web (any browser, phone/tablet/desktop layouts), native iPad/iPhone app |
| price | free | no monetisation |

### Gap matrix against the market baseline

| baseline feature (7+ of 10 established apps) | IrisSpeak |
|---|---|
| fixed-position core vocabulary | partial: only the 5-card core row is fixed |
| licensed symbol library | partial: Mulberry and ARASAAC on 1,211 of 3,094 cards, emoji elsewhere |
| several grid sizes | no |
| switch scanning | no |
| cloud or file backup | no |
| multiple user profiles | no |
| bilingual | no |
| keyboard with prediction | no |
| neural voices, Personal Voice | partial: system voice; Personal Voice possible on iPad, not wired |
| offline speech | yes |

| AI feature seen in the field | IrisSpeak |
|---|---|
| partner-aware suggestions (MaTalk, Rejoin, Vocable) | yes, and the only one with a purpose-trained on-device model |
| suggestions in a fixed area, grid untouched (Lighthouse, Context AAC, Rejoin) | no: panels re-rank on every tap |
| learns the user (Spoken, Rejoin, Context AAC) | yes: usage counts and profile words in the reranker |
| user can pin, block or correct suggestions (Rejoin approves each learned phrase) | no |
| explains why a word was suggested | no |
| published accuracy and latency | yes, research site |
| listening mode with visible indicator, off by default | partial: parent dictates deliberately; no always-on listening, which is a good default to keep |

## 3. What the evidence says about the draft's design principles

- **Stable core grid.** Supported. Thistle et al. 2018: preschoolers with consistent symbol locations went from 6.0 s to 3.3 s to find a symbol over five sessions; the variable-location group did not improve at all. ASHA's practice portal treats consistent locations as a motor-planning requirement. No study tests LLM-driven rearrangement directly, so the inference is from this and from the word-prediction literature, where scanning a changing prediction list costs time (Koester and Levine; Trnka 2008 found gains only when prediction quality was high). IrisSpeak's re-ranking panels are the wrong default for the primary user.
- **A small, fixed suggestion tray.** Supported by the same literature and by the only child deployments that exist: AACessTalk (11 dyads, two weeks) delivered LLM-recommended cards per turn and saw more turn-taking; Holyfield 2024 and 2025 (n = 3 each) saw more participation with partner-speech-driven options. All are small and short; none measured long-term learning.
- **Agency and authenticity.** Every adult study reports it: Valencia 2023 (12 AAC users wanted suggestions to sound like them), "I, Robot?" 2026 (personalised model raised typing from 31 to 42 WPM but partners misattributed AI text to the user, and stored history resurfaced private details), Griffiths 2025 (LLMs risk removing the co-construction children need). Suggestions must be optional, visibly distinct, never spoken automatically, and the user must always be able to build something the model did not predict.
- **Intent-level possibilities, not just replies.** Reasonable and not yet shipped by anyone. COMPA (CHI 2024) found that letting the AAC user pick an intent for a marked segment of conversation improved common ground. IrisSpeak already has intent labels on every card (affirm, refuse, request, question, repair, feeling...), which makes an intent row cheap to build.
- **Privacy.** The amended COPPA rule (effective June 2025, compliance April 2026) treats voice recordings and voiceprints as personal information; the audio exception applies only when audio is transcribed and deleted immediately and never retained. AssistiveWare's published principles (no language activity monitoring, aggregate counts only, with consent) are the industry reference. IrisSpeak's design already fits: no account, local history, the only upload is the optional sentence step. It needs to be written down and shown in the app.
- **Metrics.** Keystroke savings often fail to become speed gains (SpeakFaster: large keystroke savings, flat words per minute for mobile typists). Measure time to a usable message, selections per message, top-3 hit rate, repair rate and initiation, plus a validated participation measure (FOCUS for under-sixes, CPIB for older users) and a short authenticity rating.

## 4. Feature list, prioritised

Effort is relative to the current codebase (web app plus iPad port share the same engine).

### P0: make the board clinically defensible (before any wider release)

| feature | why | effort |
|---|---|---|
| **Stable personal grid**: a fixed layout of core and personal words whose positions never change, sized to the screen (start with the 60 highest-value cards from the vocabulary) | motor planning; the market baseline; the strongest objection to the current design | medium: new layout component, uses existing cards and images |
| **Suggestion tray**: 6 to 9 model suggestions in a reserved row, frozen while the child composes, refreshed only on a new partner turn or an explicit tap on "more" | keeps the prediction, removes the churn | small: the ranking exists; change when it re-renders |
| **Intent row**: fixed cells for Answer, Ask back, Add more, No / not that, Say it differently, Something else, using the existing intent labels to pick candidates | differentiates from reply-only competitors; protects agency | small to medium |
| Speech controls: repeat, delete last, clear, speak word versus speak message | every competitor has them; iPad lacks backspace | small |
| **Custom words with photo or camera image and recorded audio**, stored outside the model vocabulary, always reachable from the stable grid and search | the single most-requested customisation; the closed vocabulary blocks families today | medium: search-only cards already exist; add photo capture, audio recording, storage |
| Multiple profiles on one device, caregiver settings behind a simple gate | baseline; siblings and classrooms | small to medium |
| Backup and restore (file export and import, iCloud on iPad) | baseline; data loss is unacceptable for a communication device | small |
| Written privacy statement in the app and on the site; list exactly what the sentence endpoint sends; a one-tap "delete learned history" (exists in Profile, surface it) | trust; COPPA; every AI competitor makes this claim | small |
| In-app instrumentation: time to first tap, time to confirmed message, taps per message, suggestion acceptance rate, whether the chosen card was in the tray, repairs | needed for the evaluation in section 6 and for the published-evidence positioning | small |

### P1: reach parity where parents and SLPs compare apps

| feature | note | effort |
|---|---|---|
| Grid size and spacing options; button hold time; high-contrast and reduced-distraction modes | accessibility baseline | small |
| Grammar forms: tap-and-hold for plural, past, -ing, possessive on the stable grid; keep the cloud sentence step as the "polish" | Proloquo2Go and TD Snap set the bar; the cloud step already handles grammar but only online | medium |
| Separate label and spoken text; pronunciation override | baseline | small |
| Switch scanning (row-column, auto and step) on the iPad app; iOS Switch Control on web | TD Snap, TouchChat, CoughDrop, Sayella all have it; IrisSpeak already has eye gaze, which is rarer | medium |
| Personal Voice and neural voices on iPad; recorded familiar voice for cards | Lighthouse and Grid market recorded voices for children | small |
| Printable low-tech board of the stable grid | baseline in Grid and GoTalk; cheap | small |
| Pin, block and "why this?" on suggestions ("suggested because Dad asked about lunch") | visible control over personalisation; Rejoin approves each learned phrase | small: the reranker features already contain the reason |
| Opt-in listening mode with a visible microphone indicator, on-device ASR, audio discarded immediately | MaTalk and Rejoin already do this; IrisSpeak's dictation button is a safe default, but a hands-free mode is expected | medium |

### P2: caregiver and professional layer (the paid tier)

| feature | note |
|---|---|
| Shared profiles between home and school, remote editing, role-based permissions | CoughDrop, TD Snap, Grid, Avaz Live, Flexspeak, Proloquo all offer some form |
| Modeling mode for partners with "show me where this word is" path highlighting | Sayella and Proloquo Focus Mode; ASHA's aided language stimulation evidence is strong |
| Caregiver dashboard with the metrics above, aggregate only, no transcripts by default | keep AssistiveWare's line: no language activity monitoring |
| Bilingual vocabulary (Spanish first) | needs a second vocabulary mapping and retraining; the model is English-only today |
| School and clinic purchasing, funding paperwork | later |

### Do not build

- A second listening product for literate adults (Rejoin owns it and IrisSpeak's model is symbol-based).
- Whole-sentence AI replies as the primary interface. Keep the sentence step as it is: after the child's own cards, with approval.
- More vocabulary for its own sake. 3,094 cards already exceeds LAMP; the gap is personal words, not general ones.

## 5. Proposed board (maps onto the current code)

Top: partner's words (existing banner). Below it the message bar (existing selection strip) with repeat, delete last, clear, speak.

Middle, about 70 percent of the screen: the **stable grid**. Fixed positions, Fitzgerald colours, the 5 core cards where they are now plus roughly 55 more, chosen by the vocabulary's core and tier fields and the usage counts; personal words and photos live here in slots the caregiver chooses. Nothing here is ever re-ranked; "show and hide" grows it without moving learned buttons.

One reserved row: the **suggestion tray**, 6 cards from the current ranking (model plus reranker plus personal bonus), each visibly marked as a suggestion. It fills when the partner speaks and stays frozen while the child taps; "more" pages it. This is the current Topic/Action/Feeling ranking, just confined.

One fixed row: **intents**: Yes, No, I don't know, Not that, Ask back, Something else. Tapping Ask back or Something else refills the tray with question or new-topic candidates using the intent labels; the grid does not change.

Bottom: Generate sentence, Done, menu, as now. The phone layout keeps the same three layers with smaller tiles.

## 6. Evaluation before broad release

Run the same 20 conversational situations (lunch, school, feelings, play, bedtime, illness, a change of topic, a refusal, a repair) through MaTalk AI, Prism, Rejoin, Lighthouse, Flexspeak, Tala, Context AAC, and Proloquo2Go or LAMP as the fixed-board baseline, and through IrisSpeak with the new board. Record per situation:

- time until a usable response is on screen, and time to a confirmed message
- whether the wanted card is in the tray's first three, and in the whole first screen
- number of taps and number of repairs
- whether suggestions stayed put during composition
- behaviour offline
- caregiver setup time for a new child
- a one-question rating from the communicator or parent: "does this sound like me / my child?"

Then a small home deployment (aim for 10 parent-child pairs over two weeks, matching AACessTalk) with FOCUS or CPIB before and after, and publish the results on the research site alongside the model benchmarks. Honest reporting of where it fails is the part no competitor can copy quickly.

## 7. Pricing

Keep the communication board and speech free forever, including offline. Charge for the caregiver layer (sync, remote editing, dashboard, multiple devices) at $5 to $10 a month with a one-time option, free for verified SLPs and teachers, and never disable a child's voice when a subscription lapses. This matches Rejoin, Tala and CoughDrop and avoids competing with the free boards on price.

## Sources

Verified store data: iTunes lookup, US storefront, 9 Sep 2026, plus vendor pages: assistiveware.com/products/proloquo2go, lampwflapp.com/features, us.tobiidynavox.com/products/td-snap, touchchatapp.com, avazapp.com, thinksmartbox.com, coughdrop.com, speakforyourself.org, verbali.io, rejoinvoice.com and its privacy policy, github.com/dcostenco/prism-aac, kinderhorizon.org/lighthouse, weavechat.com/context-aac, spokenaac.com, fastaac.com, flexspeak.com, talaaac.com, vocable.app, sayella.com, chirpbot.ai, prc-saltillo.com/blog/2026-ai-apps.

Evidence: ASHA AAC Practice Portal; Thistle, Holmes, Horn and Reum 2018 (AJSLP); Trnka et al. 2008; Cai et al., SpeakFaster, Nature Communications 2024; Valencia et al., CHI 2023; COMPA, CHI 2024; Choi et al., AACessTalk, CHI 2025; Holyfield et al. 2024 (AJSLP) and 2025 (Folia Phoniatrica); Weinberg et al., "I, Robot?", CHI 2026; Griffiths et al. 2025 (J. Enabling Technologies); Frisch et al. 2026; FOCUS and CPIB instruments; amended COPPA Rule, Federal Register 22 Apr 2025; AssistiveWare, "AAC data collection and privacy".
