# Making the card model adapt to the child, on the device

Written 25 Sep 2026, after reading *Infinite-Parameter LLMs: Generating and Adapting Weights from Live Data*
(Hu, Clarke, Zhang, Hernández-Lobato, arXiv 2609.18842v2, 21 Sep 2026).

## 1. What the paper actually does

Strip the framing and it is four moves:

1. **Frozen base, FFN-only low-rank delta.** Attention is untouched. In chosen layers the feed-forward weight
   becomes `W(z) = W0 + B(z)A(z)ᵀ`, rank r = 8, driven by a latent code z (d_z = 128). Applied in factored form,
   so per-token cost is O(r·(in+out)) — negligible next to the FFN itself.
2. **Data → code.** A "data-to-weight" encoder reads live data (a document, a turn) into z in one forward pass,
   using memory tokens appended to the sequence. The encoder is SHINE's, reused frozen; the only thing trained in
   this paper is a small selector.
3. **A belief over the code, not a point.** Rather than reading context once and freezing the adapter, they carry
   a distribution over z and update it as the interaction proceeds by recursive Bayes,
   `P_t(z) ∝ P_{t-1}(z) · p(obs_t | z)`. Three cadences: none (in-context), per turn, per token.
4. **What was evaluated is the categorical case.** The belief is `Cat(π)` over a *pool of K pre-compiled codes*
   (one per passage), updated as `π_t ∝ π_{t-1}^γ · softmax(ℓ_t)` where ℓ_t comes from a trained selector
   (query = the base's own layer activation, key = a learned per-code vector). Top-1 code is applied. The
   continuous Gaussian / Kalman belief — the interesting one — is explicitly **left to future work**.

What was shown, on QA over passages with a Qwen3-8B base:

| claim | evidence |
|---|---|
| compiling evidence into weights beats putting it in the prompt | only when evidence is long and noisy (MS MARCO 48.0 vs 33.6 F1); the prompt wins when it is short and clean (SQuAD 85.3 vs 51.8) |
| a trained belief routes to the right code | beats dense retrieval by 8–12 points (Table 5) |
| the belief **accumulates** across a conversation | routing accuracy on context-dependent turns climbs from ~53% (turn 1) to ~85% (turn 6); concatenating history into the prompt rises then *sags* as the query dilutes; per-turn cost stays flat (Figure 6) |

Their own limitations, which matter for us: a code cannot add knowledge the base does not have; weight generators
risk memorising their training distribution; the selector can over-concentrate on a few codes; the continuous
belief is unvalidated; the conversations were authored, not natural.

## 2. Where IrisSpeak stands on their axes

| their cell | what we have |
|---|---|
| **Design A — in-context** (their baseline) | the `Earlier:` block: the last two turns in the prompt (`model.ts:198`; six turns was worse — "past answers outweigh the question", which is exactly their dilution finding) |
| **adapt the usage of a fixed bank** (Rewiring / MoBE row) | the personal quick row (`personalRow`, count-based over the last 50 turns, weighted by same-setting and recency) and the personal bigrams |
| **generated weights, belief over the code** (their contribution) | nothing |

So we already sit on the two baseline rows of their Table 2, and our own history says the same thing their
Figure 6 says: putting more history into the prompt stops helping. That is the argument for a state that
accumulates *outside* the prompt.

## 3. What transfers, ranked by fit

### A. A persistent, forgetting belief over cards — no model change (days)

The cheapest reading of Figure 6. Keep, per child, a vector of card log-odds `u` updated after every turn:

    u ← γ·u + (1−γ)·onehot(cards tapped)        γ ≈ 0.95   (their forgetting control)

and fold it into the ranking the way the global prior already is:

    score(card) = log p(card) − 0.5·prior_global(card) + β·u(card)

Compared with `personalRow` this is (i) applied to the *whole* board, not a five-card strip, (ii) exponentially
forgetting instead of a 50-turn window, and (iii) gated: β scales with how much history there is, so a new child
gets the plain model. State is 3,287 floats in localStorage; "reset" is a button. This is the "adapt the usage of
a fixed bank" cell, not the generated-weights cell — but it captures accumulation, forgetting and reversibility
with zero risk to the model.

### B. A pool of persona codes with a categorical belief on the device (weeks)

The faithful port of what the paper *evaluated*, sized for a 135M model in a browser.

- **Codes.** K archetype deltas (K ≈ 16–32) trained offline: rank-4 LoRA on gate/up/down of the last four FFN
  layers of the card model = 25,344 parameters per layer, ≈ 100k per code, **≈ 6.5 MB fp16 for K = 32**. No
  generator network; the deltas are stored directly, which is smaller and simpler to export than their shared
  linear map (d_z × per-layer LoRA size ≈ 6.5M parameters per layer).
- **Export.** The deltas are ONNX *inputs* (two small tensors per adapted projection) rather than baked weights,
  applied as `B(Aᵀx)`; onnxruntime-web and Core ML both take that. The base stays one immutable download.
- **Belief.** π ∈ Δ^{K−1} per child, in localStorage. Their update needs a per-code likelihood; a forward pass
  per code is K× too expensive, and their trained selector needs activations we do not want to export. The
  AAC-specific shortcut: every code k has a cached **card-shift vector** s_k ∈ ℝ^{3287} (the mean change in
  card log-odds it induces, measured offline). Then from the one base forward pass we already run,
  `p(tapped card c | k) ≈ softmax(logits + s_k)[c]`, so the update is K vector adds over 3,287 entries —
  microseconds — and `π_t ∝ π_{t-1}^γ · ∏_c p(c | k)`.
- **Apply.** Top-1 code (as they do), or the π-weighted mean of the deltas, which is cheap because the deltas
  are additive.
- **Uncertainty gating**, their stability–plasticity point: the entropy of π decides how much to trust the
  adaptation — a flat π applies no delta at all, so a child with three turns of history is not stereotyped.
  The same number can drive the personal row's length (0 → 5 cards as confidence grows).
- **Training the codes.** We have no longitudinal per-child data, so personas are *synthetic*: cluster the
  9,264 generated turns plus the corpus by topic/setting/register profile into K groups, train one delta per
  group with the existing soft-target loss, hold out later turns within a persona to measure whether the code
  helps predict them. This is precisely the memorisation risk the paper flags, and it is the thing to test.

Why this fits AAC better than their setting: bounded (K codes), reversible (reset π), interpretable (a parent
can be shown "the app currently thinks your child is mostly like profile 7 — food and feelings"), no gradient on
the device, and the state is a few dozen floats that can sync through the existing shared account.

### C. A generated code from the child's own history (research)

Their full mechanism: an encoder reads the child's history into z and a generator produces the delta. Strictly
more expressive (their Figure 4: the reachable set is a manifold, not a convex hull), but needs (i) an encoder
trained on histories we do not have, (ii) a generator export, and (iii) the continuous belief they have not
validated. Not until B has shown that persona deltas beat the global model on held-out turns.

## 4. The experiment that has to come first

None of A–C is worth building unless a child's past taps predict their future taps *beyond* the global model.
That is measurable now, with data we already hold: per-dyad history and `board_feedback` on the shared account.

For every dyad with ≥ 20 turns: split by time; score the model on the later turns as hit@8 / hit@16, once plain
and once with variant A (β·u from the earlier turns). The lift, and how many turns it takes to appear, is the
whole business case — and it also tells us γ. If the lift is under a couple of points, stop at A; if it is
large and turn-dependent, B is justified. This is a one-day offline job against `eval/board_eval.py`.

## 5. What not to take from the paper

- The continuous / Kalman belief. They did not validate it; the categorical one is the safe port.
- Any expectation that adaptation adds *vocabulary*. A code re-weights what the model already reaches; the
  342 dead rows stay dead. That is a data problem, and it is separate.
- Their encoder. It reads documents; our "live data" is a handful of card taps per turn, and a card-shift
  likelihood is a better fit than a memory-token read.

## 6. The realiser too

The same belief could carry the child's *wording* preferences ("I want…" vs bare noun, contractions, length)
as a code on the realiser's FFN — the persona signal KWickChat showed matters. Later; the card board is where
personalisation is felt first.
