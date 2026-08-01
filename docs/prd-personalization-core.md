# PRD: Personalization Core — Profile Facts, Custom Vocabulary, Signup Wizard

> **Publishing note:** the `/to-prd` skill expects a configured issue tracker + triage label vocabulary (via `/setup-matt-pocock-skills`), which this repo doesn't have set up yet. This PRD is saved locally following the existing `docs/prd-corpus-expansion.md` convention instead of being published to a tracker. Re-run `/to-prd` after setup if you want it filed with a `needs-triage` label.

## Problem Statement

AACessTalk's card generation and parent guidance are the same for every child — a parent's stated goal for the project (see `CONTEXT.md`'s **Personalization** entry) is that they should adapt to the specific child instead. Concretely: a child's favorite color, a pet's name, a school, or a friend's name has no way to become an answerable card today, and the parent has no way to tell the app anything about their child beyond a name, gender, and locale set once at account creation by an admin. Going into a 5-day beta with real autistic kids, families will notice when the app can't represent things specific to their child (a friend's name, a favorite show) even though it's marketed as a "smart" AAC.

## Solution

Give every dyad a small, editable profile (age, communication style, freeform notes) and a per-child vocabulary of words that don't exist in the shared corpus (proper nouns like names, schools, shows). Both are always included in full in the LLM prompt on every card-generation call, so the model can connect them to the parent's message without needing literal keyword matches. Replace admin-only account creation with a self-serve signup wizard (still gated by admin approval, since the app isn't in production yet) that collects this profile information up front, grounded in the camp's real intake process but scoped to only what helps personalization — explicitly excluding medical/diagnosis data and camp-logistics fields that already have a home in the camp's separate intake form.

## User Stories

1. As a parent, I want to add a word that isn't in the app's vocabulary (like my child's friend's name), so that my child can use it in conversations.
2. As a parent, I want to pick an image for a word I add, so that my child can visually recognize it.
3. As a parent, I want a sensible default image (an emoji) if I don't upload one, so that the card isn't blank or broken.
4. As a parent, I want to remove a custom word I added by mistake, so that my child's card options stay accurate.
5. As a parent, I want to record my child's age, communication style, and general notes (interests, sensory preferences, what helps them stay calm), so that the app has enough context to personalize suggestions.
6. As a parent, I want the app to use that context automatically, without me having to repeat it in every conversation, so that personalization doesn't add friction.
7. As a parent, I want my child's favorite color/thing to be offered directly as a card when relevant, rather than buried in a generic picker, so my child can respond faster.
8. As a parent, I want a folder/full picker still available even when a direct card is shown, so my child isn't limited to only what the system guessed.
9. As a new parent, I want to sign up for an account myself through a guided wizard, so that I don't need an admin to manually create it for me.
10. As a new parent, I want my signup to require approval before I can log in, so that the platform (still in beta, not production) isn't open to anyone.
11. As an admin, I want to see and approve pending signups, so that I control who gets an account during the beta period.
12. As an admin, I want existing admin-created accounts to keep working exactly as before, so that the beta cohort isn't disrupted by this change.
13. As a parent, I want assurance that medical/diagnosis information isn't collected by the app, so that sensitive data about my child isn't stored somewhere designed to feed third-party LLM calls.
14. As a developer, I want a child's custom words to never leak into another child's card options, so that personalization is safely scoped per dyad.
15. As a developer, I want an automated test proving a custom word survives the existing "reject anything hallucinated outside the corpus" check, so that this specific, previously-identified failure mode can't silently regress.

## Implementation Decisions

- **Profile Fact** is not a separate storage mechanism. Every fact resolves to either (a) a preference-pointer to a word that already exists in the shared corpus, or (b) a new **Custom Vocabulary Word**. A small residual of genuinely non-word context (age, freeform notes) is stored as plain fields on the dyad and injected as prompt context, never as a card.
- **Custom Vocabulary Word**: scoped to exactly one dyad. This pass only implements the parent-direct source (typed into a Vocabulary settings page or the signup wizard) — auto-approved immediately, since deliberate parent input carries no invention risk. The AI-detects-recurring-mentions source (system infers a word from repeated parent messages across sessions) is out of scope — see Out of Scope.
- Card generation's corpus lookup, which currently rejects any word not found in the shared corpus as "hallucinated," gets a dyad-scoped fallback check before that rejection, so a custom word isn't silently dropped.
- Profile facts and custom vocabulary are always included in full in the card-generation prompt, every call — no retrieval/RAG (already tried and rejected for a structurally similar problem in this codebase) and no keyword-based gating (a missed fact still falls back to the existing full vocabulary search, so it doesn't need the same hardcoded-backstop reliability as folder-card triggers).
- Image sourcing: parent-uploaded image is the primary path (auto-approved, no new external storage — stored directly alongside the word, same lazy-schema pattern the rest of the database already uses); emoji is the fallback when no image is uploaded. This narrows, not reverses, an earlier project decision that rejected emoji as a broad/primary image source for the main corpus — this application is a last-resort fallback for rare, per-child words only.
- Signup wizard replaces admin-only account creation for new users, but existing admin-created/seeded accounts are unaffected — they default to already-approved. Wizard submissions land in a pending state; login is rejected until an admin approves it, at which point access credentials are issued the same way admin-created accounts already get them.
- Wizard field list is deliberately narrower than the camp's real (Google Form) intake process: it collects what feeds personalization (age, communication style preference, interests, general notes) and excludes what's pure camp logistics (attendance dates, buddy-matching preferences, 1:1 aide staffing) or medical/clinical (diagnosis level, allergies, medications) — the latter already has a home in the camp's separate intake process and shouldn't live in a database designed to feed LLM prompt context.
- Interests submitted through the wizard become custom vocabulary entries automatically at approval time, following the same parent-direct/auto-approved rule as words added later through settings.
- Admin gets a new pending-signups view alongside its existing dyad management, with a one-action approval step.

## Testing Decisions

- Good tests here assert externally-observable behavior — does a custom word actually show up as a usable card, does an unapproved signup actually fail to log in — not internal implementation details like specific SQL shapes.
- The highest-value test is a regression test proving a dyad's custom word survives end-to-end through card generation, specifically through the corpus lookup step that currently discards anything it doesn't recognize — this exact failure mode was identified during design as an easy way to silently ship a broken feature (a word gets suggested by the LLM but then silently dropped), so it needs automated coverage, not just manual spot-checking.
- Prior art: `src/__tests__/cardRegen.test.ts` already mocks `db`, `gemini`, `corpus`, and `staticData` to test card-generation logic in isolation — the new test should follow the same mocking pattern rather than hitting a real database.
- Signup → pending → approve → login is a good candidate for a manual end-to-end walkthrough given it spans three separate apps (backend, web-client, admin) — not worth the mocking complexity of a fully automated test in this pass.

## Out of Scope

- **AI-detects-recurring-names**: the system inferring a custom word from a name repeated across multiple parent messages/sessions, without the parent directly entering it. Excluded because it was never designed past the concept stage in the originating discussion — no extraction method, detection threshold, or approval-queue UI was specified to implementation-level detail.
- **Learned Preference**: ranking cards by a child's tap/selection history (`user_event`, `interim_card_selection` already capture this data but nothing aggregates it). Excluded for the same reason — no ranking approach was ever specified.
- Parent-guidance "model this new word" nudges tied to AI-detected words — depends on the AI-detection feature above, which is out of scope.
- Any blob/external image storage provider — this pass stores uploaded images directly rather than adding new infrastructure.
- Medical/diagnosis/allergy data collection anywhere in the app.

## Further Notes

This PRD covers the same scope as the approved implementation plan at `/Users/jeremysihan/.claude/plans/lively-seeking-pretzel.md`, written during the same design session. The full reasoning trail (why emoji was narrowed back in as an acceptable fallback despite an earlier rejection, why RAG/retrieval was rejected for profile facts, the AAC-vocabulary-acquisition research behind treating AI-detected words differently from parent-direct ones) lives in `CONTEXT.md`'s Personalization/Learned Preference/Vocabulary Coverage/Profile Fact/Custom Vocabulary Word entries — that's the canonical source if this PRD and the code ever seem to disagree on *why*, not just *what*.
