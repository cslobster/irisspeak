# IrisSpeak

Context-aware AAC. A child answers with picture cards; the card suggestions and the sentence they turn into are
produced **on the device**, not by a cloud model.

| Piece | Lives in | Deployed as |
|---|---|---|
| Web app (the product) | `web-client/` | irisspeak.com — Vercel project `web-client`, root dir `web-client` |
| API and database access | `src/` (Next.js app router) | aac-roan.vercel.app — Vercel project `aac`, root dir `.` |
| Admin site | `admin/` | admin.irisspeak.com |
| iPhone and iPad app | `ios/` | Xcode project `ios/irisspeak/irisspeak.xcodeproj` |
| Model pipeline | `model/` | run on Modal or locally; nothing is served from here |
| Research site and model publishing | `site/` | irisspeak.org — Cloudflare Pages, paper behind basic auth |
| Notes and plans | `docs/` | — |

Everything deploys on a push to `main`.

## Where the bytes come from

The app shell is about 1.2 MB from Vercel. The models are about 520 MB and are served from **Cloudflare R2**
(`model.irisspeak.org`), which has no egress fee, along with the onnxruntime wasm (`ort/`) and the copy
transformers.js uses (`ort-hf/`). A browser downloads them once and keeps them in Cache Storage.

R2 CORS is set from `site/r2_cors.json`:

```bash
wrangler r2 bucket cors set irisspeak-model --file site/r2_cors.json
```

## Model pipeline (`model/`)

```
model/data/    build the training states from the mapped corpora
model/train/   fine-tune the card model and the sentence realiser (Modal: model/train/modal_train.py)
model/export/  ONNX and Core ML exports, quantisation and parity checks
model/eval/    board evaluation, reranker export, question inspection
model/vocab/   the card vocabulary and the folder taxonomy
```

The scripts read the app's card data from `web-client/public/`. Model weights, training output and the corpora
derived from licence-restricted sources are **not** in this repository: rebuild them with the scripts, or fetch
the published chunks from R2. See `docs/PLAN-RETRAIN.md`.

## Web app (`web-client/`)

```bash
cd web-client && npm install && npm run dev
```

`web-client/legacy/` is the previous cloud-LLM client, kept for reference; it is not built.

## Sign-in

Google is the primary path (the API runs the OAuth flow server-side; see `src/lib/google.ts`). A username and
password issued by an admin also works. Accounts, profiles, custom words and conversation history are shared by the
web app, the iOS app and the admin site through one Neon database.

## Other docs

- `docs/API-BACKEND.md` — the API routes and how the backend is put together
- `docs/PLAN-RETRAIN.md` — model training, export and the on-device runtimes
- `docs/PLAN-MERGE.md` — how irisspeak.org became irisspeak.com
- `CLAUDE.md`, `CONTEXT.md` — working notes and design history
