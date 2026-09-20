---
name: ipad-check
description: Visual no-scroll check of every web-client screen at iPad (1180×820, 1180×720) and phone (390×844) viewports using the Claude in Chrome tools against the local dev servers; screenshots each screen and reports a pass/fail table.
disable-model-invocation: true
argument-hint: [viewport, e.g. 1180x820]
---

# iPad / phone no-scroll check

Hard project rule: **no scrolling on any screen** — everything zoom-to-fits the viewport (CLAUDE.md). This
skill checks that rule in a real browser. It is user-invoked only because it drives the user's Chrome and may
start dev servers.

## 0. Load the browser tools (one call)

```
ToolSearch "select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__resize_window,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__find,mcp__claude-in-chrome__form_input"
```

## 1. Dev servers

Both must be up (the web app calls `localhost:3000` in dev, so the app is unusable with only Vite running).
Check first, then start what is missing (per CLAUDE.md "Running locally"; run each in the background):

```bash
curl -sk -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/v1/ping   # backend  → 200
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:4200/             # web app  → 200 (http:// if web-client/.certs/ is absent)
# if missing:
npm run dev                          # repo root, :3000   (needs root .env.local with DATABASE_URL)
cd web-client && npm run dev         # :4200; HTTPS when web-client/.certs/{key,cert}.pem exist
```

## 2. Sign in once

1. `tabs_context_mcp` → `tabs_create_mcp` → `navigate` to `https://localhost:4200/` (self-signed cert: click
   through "Advanced → Proceed" if Chrome shows the warning; use `http://localhost:4200/` if there is no cert).
2. On the sign-in screen click **"Sign in with a username and password →"**, fill **Username** `guest`,
   **Password** `12345`, click **"Sign in →"** (seeded guest account; Google sign-in is not needed).
3. You land on `/#/home` (Welcome). **The on-device model downloads here** (~520 MB on first load in this
   Chrome profile, then served from Cache Storage `irisspeak-model-v31`). Wait for the progress text under the
   big button to disappear (it shows `Loading vocabulary…`, `Loading model…` etc. and goes away when
   `engine.ready` is true). Do not judge layout while the bar is still moving.
4. Click the big **"Start a conversation"** button once → URL becomes `/#/session/<id>`. Note that `<id>`; you
   will re-visit it directly at each viewport (the screen re-runs `startSession` on direct navigation).

## 3. For each viewport × screen

Viewports (or just `$ARGUMENTS` if given): **1180×820** (iPad landscape), **1180×720** (iPad with Safari
tabs — the "short landscape" side-column layout), **390×844** (iPhone → `CompactSession`, compact layout kicks
in under 900 wide or 600 tall).

`resize_window` sets the *window*, not the viewport; after each resize read the real viewport and correct by
the difference so `innerWidth×innerHeight` equals the target:

```js
JSON.stringify({vw: innerWidth, vh: innerHeight, outerW: outerWidth, outerH: outerHeight})
```

Screens: `/#/home`, `/#/session/<id>`, `/#/stars`, `/#/vocabulary`, `/#/profile`, `/#/credits`
(optional extras: `/` sign-in after signing out, `/#/session-end/<id>`, the ☰ SessionMenu and the
"View all" CardSearchOverlay open on the session screen).

For each: `navigate` to `https://localhost:4200/<route>`, wait ~1 s for the fit-scale to settle, run the
check with `javascript_tool`, then take a `computer` screenshot:

```js
(() => {
  const d = document.documentElement, r = document.querySelector('#root');
  const docOk  = d.scrollHeight <= innerHeight && d.scrollWidth <= innerWidth;
  const rootOk = !r || (r.scrollHeight <= innerHeight && r.scrollWidth <= innerWidth);
  // diagnostic only: internal scroll containers (overflow auto/scroll with hidden content)
  const inner = [...document.querySelectorAll('*')].filter(e => {
    const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY + s.overflowX) &&
      (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1); })
    .slice(0, 5).map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + [...e.classList].slice(0, 3).join('.'));
  return JSON.stringify({ route: location.hash, vw: innerWidth, vh: innerHeight,
    doc: [d.scrollWidth, d.scrollHeight], root: r ? [r.scrollWidth, r.scrollHeight] : null,
    pass: docOk && rootOk, inner });
})()
```

**Pass** = `pass: true`. `inner` (an element that scrolls internally) is not a failure by itself — the
transcript and the folder browser are allowed to scroll inside their own box — but list it so the user can
decide. Also eyeball the screenshot: clipped tiles, overlapping text, a Done/Refresh column pushed off-screen
count as failures even when the numbers pass.

## 4. Report

One table, one row per viewport × screen:

| viewport | screen | doc w×h | #root w×h | pass | notes (inner scrollers, visual issues) |

Then the failing rows with the screenshot and the most likely file (`screens/session/layout.ts` `CONTENT_W`/`DESIGN_H`
/ `--fit-scale`, `session/ChildTurn.tsx`, `CompactSession.tsx`, the settings screens). Propose the fix; do not change layout without
showing the before/after screenshots.

## Gotchas

- First model download in a fresh Chrome profile can take minutes; the Welcome progress text is the signal.
- `/#/credits` is the only screen reachable without signing in; every other route redirects to `/` when the
  JWT is missing or expired (30 days).
- Text size setting (normal/large/xl, `--ui-scale`) changes fit — check with the default unless asked.
- Do not resize below 390 wide; nothing is designed for it.
