# Vite or Next.js? Recommendation and trade-off

You asked me to revisit this using the spike results, and to tell you the trade-off **before** switching. **I have not switched.** The app in `/app` is still Next.js. Nothing below changes until you say so.

## Short answer

**Recommend a Vite single-page app for the client, with the sync/API server as its own TypeScript Node service (as it already is).** Nothing the till does needs what Next.js is for, and the test below showed the same app running on Vite with no code changes to the app itself.

## What I tested

I built the **same source** (`app/src`, unchanged) under Vite 8 in a scratch folder outside the repo, with two small stand-ins for the only two Next features the code touches (`next/link` and `next/navigation`, 25 lines in total), and then ran the existing browser tests against it.

| | Next.js 16 (static export, today) | Vite 8 (scratch build) |
| --- | --- | --- |
| Build time (whole build, wall clock) | 23.6 s | 3.8 s |
| JavaScript shipped | 1.69 MB | 1.23 MB (27% less) |
| Database engine files (wasm and data) | same | same |
| Total download | 18 MB | 18 MB |
| Browser tests run against it | all 19 passing (shell 8, modes 4, data safety 5, hard-kill 2) | **all 19 pass**: shell 8/8, modes 4/4 (including **offline start and trading with no network**), data safety 5/5, hard-kill 2/2 |

Both share the same application code, the same database engine and the same service worker, so run-time speed of a sale is the same code path. I did **not** re-run the speed benchmark on the Vite build, so I make no speed claim; the gain is in build time and download size.

## Why the spike points at Vite

1. **The app is client-only by necessity.** The database lives in the browser, so there is nothing for a server framework to render. Under Next the app needs workarounds to stay client-only: `'use client'` on 15 files, `dynamic(..., { ssr: false })` wrappers, and a static export so it can be cached for offline use. Server components, route handlers, middleware and image optimisation are all unusable or switched off.
2. **We pay for what we cannot use.** Next ships fast-moving server features, and advisories against them still reach us. A Next security advisory blocked the build during this phase and had to be patched, for code paths the till never runs. A leaner build tool has a smaller surface.
3. **The server already lives elsewhere.** The sync service is a separate Node process (modes 2 and 3). Splitting "client app" from "TypeScript API" is how it is already built, so Vite does not add a split; it removes a pretend one.
4. **The tools line up.** Tests already use Vitest (a Vite tool). The Tauri desktop wrapper planned for shop PCs (Phase 9b) wraps any static front end, and Vite is one of its common starting points (I did not build a Tauri app, so this is general knowledge, not something tested here).
5. **Speed of work.** A build that takes 4 s instead of 24 s is felt every day, and in CI.

## What switching costs

Framework-specific code today is small, which is the point of checking now rather than later:

- `src/app/*` (layout, client root, four page files): replaced by one `index.html`, one `main.tsx` and a route table.
- `src/ui/shell.tsx`: two imports (`next/link`, `next/navigation`) swap for the router's equivalents.
- `next.config.mjs`, `next-env.d.ts`, the Next entries in `tsconfig.json`, `.gitignore`: removed.
- Build scripts and the offline-cache script: the existing `precache.mjs` already works on a Vite output folder (I ran it unchanged apart from the folder name).
- Test server: a single-page-app fallback (added behind an environment flag in `e2e/static-server.mjs`, off by default).

Rough effort: half a day to a day, mostly the router. **The real cost is a decision:** Vite has no routing of its own. The 25-line stand-in is fine for a spike and not for about 60 screens with permission-guarded routes, nested layouts and per-route code splitting. I would pick a mainstream router (React Router or TanStack Router) and wrap it in one thin `Link` and `useRoute` module so the choice stays swappable.

## What you lose by leaving Next.js

- **One opinionated tool.** With Vite we choose and maintain the router, and the offline cache step. Next gave us routing and conventions for free.
- **Familiarity and hiring.** More people know Next than a custom Vite setup. Less relevant for a project this size.
- **A server path we might want later.** If one day there is a public marketing site, or server-rendered customer pages (a loyalty portal, an online-ordering page), Next suits that. Those would be separate apps, not this one.
- **Young tooling on both sides.** Vite 8 uses a new bundler (Rolldown); Next 16 uses Turbopack. Neither is old. It built the database engine's files correctly and passed the tests, but its warnings about the engine's use of `eval` should be tracked.

## Options

| | what you get | cost |
| --- | --- | --- |
| **A. Switch to Vite now (recommended)** | smaller, faster build; no unused server framework; matches Tauri; cheapest moment to do it (15 screens' worth of code, zero real screens) | about a day, plus the router choice |
| B. Stay on Next.js | no change, nothing to learn | keep the workarounds; revisit if the build or the advisories keep costing time |
| C. Switch at the start of Phase 3 (the POS screen) | more information about routing needs | more code to move; I would not wait past Phase 1 |

If you pick A, I will do it as the first change of Phase 1, in its own commit, with the full test suite green on both sides of the change, and I will add the thin `Link` wrapper first so the app code never imports a router directly.

One thing I saw while testing: the restore-from-file test prints a page error (`Cannot read properties of undefined (reading 'FS')`) from the database engine's own save step. It appears identically on the Next.js build, so it is not a framework difference; the test passes and the data is correct. It looks like the engine saving to storage just after a scratch database was closed. Logged as a known minor issue (`progress.md`), not yet fixed.
