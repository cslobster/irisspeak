# Moving irisspeak.org into irisspeak.com

Written 15 Sep 2026. Goal: everything the on-device app at irisspeak.org does today should be served from
irisspeak.com, on one account system, one database, one deploy.

## 1. Where things stand (measured, not assumed)

| | irisspeak.org | irisspeak.com |
|---|---|---|
| Hosting | Cloudflare Pages project `irisspeak-research` | Vercel project `web-client` (git-deployed from `~/work3/ai_aactalk`) |
| Backend of its own | **none** | none in the frontend project; the API is the Vercel project `aac` at `aac-roan.vercel.app` |
| Server-side code | 2 Pages Functions: `_middleware.js` (basic auth for `/paper` only) and `api/sentence.js` (**dead** since the realiser went on-device) | n/a |
| Accounts, profile, history, vocabulary | irisspeak.com API, bearer JWT | same API |
| Database | Neon Postgres (shared) | same Neon Postgres |
| Card model | on device (ONNX fp16, 274 MB, from R2) | server LLM |
| Sentences | on device (realiser, 270 MB, from R2) | server LLM |
| API reachability | cross-origin to `aac-roan.vercel.app` (CORS `*`) | cross-origin too: `/api/v1/*` on irisspeak.com returns the SPA shell, the app calls the absolute `BACKEND_ADDRESS` |

So two of the things that sound like work are already done: **irisspeak.org has no backend to migrate, and both
sites already use the same database and user management.** What is left is frontend hosting, static assets, and a
product decision.

## 2. The one decision

Both apps own the same routes: `/`, `/home`, `/session/:id`, `/session-end/:id`, `/stars`, `/vocabulary`,
`/profile`, `/signup`, `/google`. irisspeak.com additionally has the topic picker (Today's plan, Today's day,
Free topic) and the server-LLM child turn; irisspeak.org has the on-device board, folders, quick row, More ideas,
the realiser, the two-step Ask panel, setup, credits, voice picker.

| Option | What happens | Cost | Risk |
|---|---|---|---|
| **A. Mount at a path** | on-device app served at `irisspeak.com/app`, old app untouched at the root | ~1 day | low |
| **B. Replace the root** | on-device app becomes irisspeak.com; cloud child turn retired | A + ~2 days | medium: loses topic picker and parent-guide examples unless ported |
| **C. Both, per account** | a profile flag decides which child turn a family gets | A + ~3 days | highest, two code paths to maintain |

**Recommendation: A now, B after a week of use.** A is reversible, needs no decision about the old flow, and
proves the assets and CORS work on the new origin. B is then a routing change plus deleting dead screens.

## 3. Frontend

Build `aac_next` into the web-client deployment instead of the Cloudflare one.

1. Move `aac_next/` into `~/work3/ai_aactalk/` (it is currently outside any git repo; this also puts it under
   version control, which is the other open item).
2. `vite.config.ts`: `base: '/app/'`, `build.outDir: '../web-client/public/app'`.
3. Make the absolute asset paths base-aware. Affected: `/folders.json`, `/questions.json`, `/card_images.json`,
   `/cboard_cards.json`, `/cboard_folders.json`, and ~30 `/symbols/mulberry/*.svg` and `/symbols/openmoji/*.svg`
   icon paths, plus `ort.env.wasm.wasmPaths = '/ort/'`. One helper (`const asset = (p) => import.meta.env.BASE_URL + p`)
   and a mechanical edit; ~40 call sites.
4. `web-client/vercel.json`: add the `/app` and `/app/` rewrites next to the existing `/aac` ones, and add the
   cache headers currently in `site/public/_headers` (`/app/` and `/app/index.html` no-cache, hashed assets immutable).
5. Build: change `buildCommand` to build both apps (`vite build && (cd ../aac_next && vite build)`), or check the
   built bundle into `web-client/public/app`. Prefer the former; the latter puts 22 MB of churn in git.
6. HashRouter stays, so `irisspeak.com/app/#/home` never collides with the outer app's routes.
7. Google sign-in needs nothing: the client sends `location.origin + location.pathname + '#/google'` and the API's
   allow-list in `src/lib/google.ts` already accepts `irisspeak.com` and `www.irisspeak.com`.

For option B later: swap the root `index.html` to the on-device app, keep `/stars`, `/vocabulary`, `/profile` from
whichever implementation you prefer (they are near-identical), and delete `FreeTopicScreen`, `HomeScreen`'s topic
tiles and the server card-recommendation calls.

## 4. Backend and data

Nothing migrates. The API already serves both apps from one database. Four small items:

- **Delete `site/functions/api/sentence.js`** and remove `OPENAI_API_KEY` from the Pages project. The realiser has
  replaced it on both clients; leaving a live OpenAI-billing endpoint on the internet is the only real hazard here.
- **Optional `/api/v1/*` rewrite** on irisspeak.com pointing at `aac-roan.vercel.app`, so the app can use
  same-origin API calls. Not required (bearer tokens in localStorage, CORS `*`), but it removes a cross-origin hop
  and makes future cookie auth possible. Must be inserted **before** the SPA catch-all rewrite.
- **`DELETE /dyad/account`** (hard-deletes dyad, sessions, turns, custom words, login codes). Needed for the App
  Store anyway (guideline 5.1.1 v), and it belongs in this pass because both frontends will link to it.
- Session list and transcripts: the on-device app now reads `/dyad/session/list` and
  `/dyad/session/[id]/message/all` and merges them with local sessions, so history from irisspeak.com, the iPad and
  the browser all appear in one list. Already implemented on both clients today.

## 5. Model files and static assets

This is the only hard blocker.

| Asset | Size | Where it must live |
|---|---|---|
| Card model chunks + realiser chunks | 523 MB | **stays on R2** (`model.irisspeak.org`); never in the Vercel deployment |
| `ort/` (onnxruntime-web wasm) | 32 MB | ships with the Vercel deployment |
| `symbols/` (Mulberry + OpenMoji) | 12 MB | ships with the Vercel deployment |
| app bundle (`assets/`) | 22 MB | ships with the Vercel deployment |

- **R2 CORS is currently `https://irisspeak.org` only.** Verified with a preflight: a request from
  `https://www.irisspeak.com` gets no `access-control-allow-origin` header. Add `https://irisspeak.com`,
  `https://www.irisspeak.com` (and `https://*.vercel.app` if previews should work) to the bucket CORS policy before
  anything else, or the app will load and then fail to fetch the model.
- Drop the same-origin `/model/*` fallback, or keep a copy of the metadata JSONs only (a few hundred KB) so the app
  can still start if R2 is unreachable.
- Do **not** enable COOP/COEP on irisspeak.com. onnxruntime-web would gain threads but the cross-origin R2 fetches
  would need `crossorigin` handling, and today's app is single-threaded on both origins anyway.

## 6. iOS app

Unaffected. It talks to the same API, bundles its own Core ML models, and has no irisspeak.org URLs left in the
Swift source (the old `/api/sentence` endpoint was removed with the on-device realiser). Only the marketing links
in the Credits screen point at irisspeak.com, which is where they should point.

## 7. irisspeak.org after the move

Keep it as the research site: the paper stays behind the `research` / `paper` basic-auth gate, which is a
Cloudflare Function with no Vercel equivalent worth rebuilding. Once irisspeak.com/app is verified, replace the app
at the .org root with a redirect to it, so existing bookmarks keep working. The R2 bucket and the
`model.irisspeak.org` domain stay where they are; only the CORS list changes.

## 8. Order of work

1. R2 CORS: add the irisspeak.com origins (5 min, unblocks everything else).
2. Delete the dead `api/sentence.js` Function and its OpenAI key (10 min).
3. Move `aac_next` into the irisspeak repo, base-aware assets, build into `web-client/public/app`, rewrites and
   cache headers, deploy (half a day). Verify on irisspeak.com/app: model loads from R2, sign-in, Google sign-in,
   history from the shared account, realiser, voice.
4. `DELETE /dyad/account` plus a Delete account button on both frontends (half a day; also an App Store item).
5. Watch for a week, then option B: promote the on-device app to the root and retire the cloud child turn
   (~2 days including porting the topic picker if it is worth keeping).
6. Point irisspeak.org at the new URL, leave the paper where it is.
