<div align=center>
  <img src="src/assets/logo.svg" width="96" alt="Qwerty Learner Plus" />
</div>

<h1 align="center">Qwerty Learner Plus</h1>

<p align="center">
  Typing-based vocabulary trainer for people who work on keyboards — an <b>unofficial fork maintained by dsh</b>
</p>

<p align="center">
  <a href="./README.md">中文</a> ·
  <a href="./docs/QUICKSTART.md">Quickstart</a> ·
  <a href="./FORK-NOTICE.md">Fork notice</a> ·
  <a href="./docs/DSH-FORK_EN.md">Technical docs</a>
</p>

> [!IMPORTANT]
> This repository is an **unofficial fork** of [Qwerty Learner](https://github.com/RealKai42/qwerty-learner) (GPL-3.0),
> maintained by dsh. It is **not affiliated with, endorsed by, or commissioned by** the upstream authors.
> Upstream baseline commit `1182426`; local branch `dsh-local-v8`. Upstream is **frozen** — this fork does not track
> upstream releases. Read [FORK-NOTICE.md](./FORK-NOTICE.md) before using it.

## What this is

Turn vocabulary review into typing practice: you see the definition, type the spelling, get immediate feedback, and
every keystroke-level mistake, accuracy figure and WPM is recorded. A spaced-repetition scheduler then decides when
each word comes back. This fork rebuilds the **word selection and review scheduling** on top of upstream, and adds a
desktop shell (Electron) for things a browser cannot do (local backups, offline pronunciation cache, clipboard lookup).

## How it differs from upstream

| Area | Upstream | This fork |
| --- | --- | --- |
| Word selection | Chapter order inside a chosen dictionary | **Dynamic picking**: next word is chosen from the memory model after each answer, de-duplicated across dictionaries |
| Scheduling | Fixed intervals | **SRS / Ebbinghaus**: `memoryLadder.ts` + `srsRules.ts`, demote on wrong, promote on fast+correct, clock-rollback guard |
| Progress | Manual dictionary + chapters | **Auto-advance**: 13-level path (primary → junior → senior → CET-4 → CET-6), advances at 85% mastery |
| Starting point | Chapter one | **First-run level picker**: never learned / junior / senior / CET-4 / CET-6; applies immediately, editable later from the dictionary page |
| Main flow | Chapter selection screen | No chapter screen — open and practise; review and error-book are their own routes |
| Reliability | — | Local memory tables, backup/restore, clock-rollback correction, dirty-data migration, visible write failures |
| Shell | Web only | **Electron shell**: tray, hotkeys, local backup, offline pronunciation cache, clipboard lookup (off by default) |
| UI | Donation / promo / friend links | **Marketing UI removed**: no donation entries, community QR codes or analytics snippets; share/export/dictionary-request kept |
| Tooling | yarn, no gates | **npm + lockfile**, `engines`, quality gates, release/rollback scripts, CDP smoke + behavioural verification |
| Docs | One README | Fork notice, technical docs (zh/en), quickstart, third-party licences, audit closure, release notes |

Full list: [docs/DSH-FORK_EN.md](./docs/DSH-FORK_EN.md).

## Quickstart

Requires Node 18–22 and npm ≥ 9:

```bash
npm ci          # installs exactly what package-lock.json pins
npm run dev     # http://localhost:5173
```

Production build: `npm run build` (output in `build/`). Desktop packaging, dual-directory install, rollback — and the
fact that **the PowerShell scripts default to the author's local layout** — are documented in
[docs/QUICKSTART.md](./docs/QUICKSTART.md).

## Layout

```
src/                     web app (React 18 + TS + Vite 4)
  utils/                 memory model / SRS / auto-advance / level picker (pure logic)
  pages/Typing/          practice screen (word picking, judging, stats, settings)
  pages/Analysis/        statistics (heatmap, accuracy, WPM)
  pages/ErrorBook/       error book (grouping, paging, detail, export)
  pages/Gallery-N/       dictionary + learning-start entry
local-fork/              desktop shell (Electron main / preload / injected enhancement UI)
public/dicts/            385 dictionaries (~79 MB, the bulk of the repo)
docs/                    fork notice, technical docs, quickstart, third-party licences, audit closure
scripts/                 release / rollback / quality gate / CDP smoke / level-picker verification
```

## Develop & verify

| Command | What it does |
| --- | --- |
| `npm run test:quality` | `tsc --noEmit` + `eslint src --max-warnings 0` (same as CI) |
| `npm run test:local` | 11-check CDP smoke (needs an instance started with `--remote-debugging-port=9472`) |
| `npm run test:start-level` | 21-check behavioural test for the level picker (first-run dialog → pick → correct dictionary → persists across restart → edit from dictionary page → existing users are not interrupted) |
| `npm run test:pages` | 17-check page regression (error book sort/detail/Esc/delete-cancel, settings panel, malformed payload does not white-screen) |
| `npm run test:typing` | 15-check typing pipeline (input state, wrong letter marked, word advance, persistence, pause writes session, sound switches/sliders, dictation) |
| `npm run test:csv` | 14 assertions for CSV-export formula-injection hardening |
| `npm run test:core` | **309 core-algorithm assertions** (120 SRS + 189 auto-advance) + determinism gate, simulated from real source |
| `npm run quality` | PowerShell quality gate (tsc + eslint + core regression) |
| `scripts/dsh-release.ps1` | Pack asar / test install / isolated smoke / dual-directory install |
| `scripts/dsh-rollback.ps1` | Roll back to the previous build (saves a redo point first) |

## Data, privacy, network

- Learning records, memory model and backups stay on your machine (`%APPDATA%\qwerty-learner-plus`); nothing is uploaded.
- **Telemetry is off by default** in the desktop build; on in the web build (same as upstream).
- **Online definitions / sentence translation are on by default** and send the queried word or sentence to
  `dict.youdao.com`, `api.dictionaryapi.dev`, `api.mymemory.translated.net` and `translate.googleapis.com`;
  pronunciation audio comes from `dict.youdao.com`. Turn `onlineLookup` off in settings if you don't want that.
  Full disclosure: [FORK-NOTICE.md §6.9](./FORK-NOTICE.md).

## Licence & attribution

- Code: **GPL-3.0**, see [LICENSE](./LICENSE). Copyright of upstream code belongs to RealKai42 and contributors;
  modifications in this fork are made and signed by **dsh**.
- Dictionaries and icons: see [docs/THIRD-PARTY.md](./docs/THIRD-PARTY.md); copyright belongs to the original sources.
- Upstream README archived verbatim: [docs/UPSTREAM-README.md](./docs/UPSTREAM-README.md) (English/Japanese versions
  in the same directory).

## Docs

| Document | Contents |
| --- | --- |
| [docs/QUICKSTART.md](./docs/QUICKSTART.md) | Requirements, minimal commands, desktop, FAQ |
| [FORK-NOTICE.md](./FORK-NOTICE.md) | Fork statement, GPL obligations, privacy/network disclosure, known limits |
| [docs/DSH-FORK_EN.md](./docs/DSH-FORK_EN.md) | Technical details (auto-advance, SRS, desktop shell, security baseline) |
| [docs/AUDIT-CLOSE.md](./docs/AUDIT-CLOSE.md) | Pre-release audit closure (fixed / accepted risk / not actionable) |
| [docs/REFACTOR-LOG.md](./docs/REFACTOR-LOG.md) | v10 refactor log: issue / root cause / fix / verification / risk + backlog |
| [docs/RELEASE-NOTES-v10.md](./docs/RELEASE-NOTES-v10.md) | v10.0.0 release notes |
| [docs/UPSTREAM-PR-DRAFT.md](./docs/UPSTREAM-PR-DRAFT.md) | Ready-to-submit upstream issue / PR drafts (signed dsh) |
| [docs/REFACTOR-LOG.md](./docs/REFACTOR-LOG.md) | v10 refactor log: issue / root cause / fix / verification / risk + backlog |
| [docs/RELEASE-NOTES-v10.md](./docs/RELEASE-NOTES-v10.md) | v10.0.0 release notes |
| [docs/UPSTREAM-PR-DRAFT.md](./docs/UPSTREAM-PR-DRAFT.md) | Ready-to-submit upstream issue / PR drafts (signed dsh) |
| [docs/THIRD-PARTY.md](./docs/THIRD-PARTY.md) | Third-party dictionaries and icons: sources and licences |
| [docs/Electron-EOL.md](./docs/Electron-EOL.md) | Electron runtime version and EOL record |
| [docs/Backup-Restore.md](./docs/Backup-Restore.md) | Backup and restore |

## Known limitations

- The dictionary set is large (~79 MB), so clones are heavy — inherent to upstream data.
- The 309-assertion core regression now ships with the repo (`scripts/core-regression`), but it is a **pure
  algorithm-level simulation**: browser dependencies are stubbed and real `src/utils/*` is bundled with esbuild —
  it is not a real browser/Electron run.
- `scripts/*.ps1` default to the author's local layout; override with `QZ_*` environment variables (see QUICKSTART).
- The clone is shallow, so upstream history cannot be verified locally (affects dictionary provenance, see THIRD-PARTY).
- `WordPanel/Word/index.tsx` is still ~500 lines (input + settlement state machine); only the display layer and the
  letter-visibility rule were extracted. Further splitting needs finer-grained instrumentation — see
  `docs/REFACTOR-LOG.md` backlog.
