# Progress

Updated at the end of Phase 0b. Score from `python3 replica-diff/parity.py replica/features.csv`.

## Parity

**10.6 / 100.** Must-haves done: **4 of 134.**

This is low on purpose. Phase 0b builds the foundation (database, pricing engine, sync, backups, shell), and almost none of the features a shop owner would recognise. The real till screen is Phase 3. The score is not a measure of how much work is behind us; it counts features that work end to end for a user.

| area | score | features |
| --- | --- | --- |
| auth | 0.0 | 7 |
| install | 0.0 | 5 |
| purchasing | 0.0 | 11 |
| reports | 0.0 | 19 |
| customers | 3.7 | 16 |
| accounting | 5.6 | 11 |
| catalogue | 5.8 | 30 |
| registers | 6.8 | 8 |
| orders | 7.9 | 15 |
| pos | 17.6 | 49 |
| admin | 25.9 | 30 |

(Rows set to `partial` in `features.csv` mean the foundation exists but no screen uses it yet; they score part credit.)

## Phase status

| phase | state |
| --- | --- |
| 0a Spike | done, `spike-report.md` |
| 0b Foundation | built, **waiting for your review** at `demo-phase-0b.md` |
| 1 onwards | not started |

## Phase 0b checks (last full run)

- 257 Node tests (real PostgreSQL 16 and PGlite); the pricing engine is held to 100% coverage and mutation-checked.
- Browser tests in real Chromium: app shell, three deployment modes, data safety (backup, restore, S3-compatible), hard-kill durability.
- Brand sweep clean; lint and type checks clean.

## Open items carried forward

| item | where it lands |
| --- | --- |
| Measurement on a real low-end Android tablet and an N100 mini PC | needs your hardware; run `/bench/` (see `perf/README.md`) |
| Server-side permission enforcement for modes 2 and 3 | Phase 1, design in `plan.md` 2.12 |
| OPFS storage spike | Phase 1, after the tablet baseline |
| Docker local-server stack run on real hardware | Phase 9 (never run; no Docker daemon in the build sandbox) |
| Google Drive backup (`drive.file` scope only) | Phase 9 |
| Tauri desktop wrapper | Phase 9b |
| Vite versus Next.js | your decision, see `framework-decision.md` |
