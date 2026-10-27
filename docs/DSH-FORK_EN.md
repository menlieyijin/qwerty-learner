# DSH Fork — Technical Notes (English)

> Concise English version of [`DSH-FORK.md`](DSH-FORK.md). For the authoritative fork statement, GPL compliance and disclaimer, see [`FORK-NOTICE.md`](../FORK-NOTICE.md).

## 1. What this is

An **unofficial fork** of [Qwerty Learner](https://github.com/RealKai42/qwerty-learner) (`RealKai42/qwerty-learner`), maintained by **dsh (DeepSeek Harness)** and published at [menlieyijin/qwerty-learner](https://github.com/menlieyijin/qwerty-learner), branch `dsh-local-v8`.

| Item | Value |
| --- | --- |
| Upstream baseline | `1182426f2bd0a28c95302c33f9e19136b1262a70` (upstream `master`) |
| Fork commits | 24 (`git rev-list --count 1182426..dsh-local-v8`) |
| License | GNU GPL v3.0 (same as upstream; `LICENSE` kept intact) |
| App version | `1.0.0-enhanced-v9.11` (single source: `local-fork/package.json`) |
| Author of fork changes | `dsh <dsh@dsh.local>`; 12 commits carry a `Signed-off-by` trailer (added from v9.3 onwards); earlier commits credit dsh in the commit message |
| Desktop runtime | Electron 43.8.3 / Chromium 150.0.7871.250 (Windows) |

It is a desktop-first study app: the upstream typing / pronunciation / dictation / error-book / statistics / dictionary-gallery features are kept, while the vocabulary workflow is replaced by an Ebbinghaus-style SRS scheduler, dynamic word picking and automatic level progression. An Electron shell is added on top of the web app.

It is **not** an official repository, not endorsed by upstream, and not tracking upstream updates. Upstream is frozen (no fetch/pull/rebase, no dependency upgrades).

## 2. Main differences from upstream

| Area | Upstream `1182426` | This fork |
| --- | --- | --- |
| Practice structure | pick dict → per-chapter practice | **automatic levels, no chapters**; word-by-word dynamic picking |
| Scheduling | no SRS (wrong words go to error book) | **12-stage Ebbinghaus ladder** with graded demotion, slow-word and clock-rollback handling |
| Word selection | precomputed chapter list | real-time decision: due-first, probabilistic review, dynamic new-word ratio, cross-dictionary dedupe, last 12 words excluded |
| Wrong words | error book only | reappear after 3 other words in the same session (max 2 times) + auto-suspend as "to conquer" |
| Level progression | none | **13 levels** (primary grade 1 → CET-6), persisted, only moves forward |
| Daily new-word cap | none | no hard cap; ratio adapts to due backlog |
| Data tables | `wordRecords` / `chapterRecords` / `reviewRecords` | adds `memoryRecords` (Dexie v4); old tables unchanged |
| DB import | direct `db.import` | atomic: temp DB + row-count validation + single main transaction; stale temp DBs cleaned on startup |
| Backup | official Dexie export | daily directory copy + logical `data.json` snapshot + full JSON export/import |
| Desktop shell | none | tray, shortcuts, mini mode, always-on-top, backup, logs, clipboard lookup, free dictionary lookup, pronunciation cache, dictionary updates, injected "tools" panel |
| Marketing UI | donate/promo/mobile landing/analytics/SEO links | removed from v9.8; share/export/dictionary-request kept |
| Telemetry | enabled on web | **desktop default off** (explicit opt-in); web build keeps upstream behavior |
| Build/release | upstream scripts | `dsh-release.ps1` (gates → build → asar → verify → install/rollback) + `quality-gate.ps1` |
| Tests | Playwright e2e | plus core-algorithm regression, CDP smoke, security probes (some scripts are not in the repo) |

## 3. Architecture

- **Electron main process** (`local-fork/electron/main.js`): windows, tray, global shortcuts, mini mode, backup, log rotation, dictionary updates, pronunciation cache, IPC whitelist, navigation guards, CSP, permission denial.
- **Preload** (`preload.js`, `preload-clipboard.js`): `contextBridge` whitelist only; sets `window.__QZ_ELECTRON__`; clipboard window gets a minimal 3-method preload.
- **Renderer** (Vite/React in `build/`): typing / gallery / analysis / error book; `memory.ts` (word picking + SRS write) → `autoLevel.ts` (level state) → Dexie `RecordDB`.
- **Injected enhancement UI** (`enhance.js`, Shadow DOM): does not modify `build/` output.
- Shell-private data (settings/logs/backups/caches) lives in `%APPDATA%\qwerty-learner-plus`; study records stay in the app's IndexedDB.

## 4. Core algorithms (source of truth)

### 4.1 Ladder

12 stages (days): 10 min → 30 min → 12 h → 1 d → 2 d → 4 d → 7 d → 15 d → 30 d → 60 d → 120 d → 240 d. First correct answer on a new word graduates to stage 3 (1 day). Mature = stage ≥ 3.

### 4.2 Wrong answer (`srsRules.evaluateWrong`)

- Immature / new word: stage = 0 (10 min), ease −0.2 (floor 1.3), no lapse.
- Mature word, 1 error in this attempt: `stage = max(1, stage − 2)`, lapse +1.
- Mature word, ≥2 errors: stage = 0, lapse +1.

Slow word = total attempt time **> 6000 ms** (strictly greater). `lapses >= 4` auto-suspends the word.

### 4.3 Due date (`srsRules.computeDue`)

- Interval < 1 day: exact milliseconds.
- Interval ≥ 1 day: local calendar day, due at 00:00 of (today + rounded interval).
- Clock rollback: only when `now < lastSeen`, clamp due to `min(due, now + interval)`; normal records are untouched.
- `effectiveDueOf` / `isRecordDue` are the single due-check basis for picking, due counts and review debt.

### 4.4 Mastery & level-up (`autoLevel.ts`)

- Mastered: `correct >= 2 && stage >= 2 && lastResult !== 'wrong'`.
- Level complete (graduation line **85%**, `MASTERY_RATIO = 0.85`, was 0.90 before v9.11): `required = total − suspended`; `required === 0`, or `seen === required && mastered / required >= 0.85`. Up to 15% of unmastered words move on with the level — they stay in `memoryRecords` and keep coming back as due words, they just no longer block graduation.
- State is persisted in `localStorage` key `qzAutoLevelState`; moves forward only. Explicit "re-evaluate level" is the only backward path.
- Skip 3 times → suspended ("to conquer"), does not block level-up; resuming resets `lapses`. Dictionary load failure → `error='load-failed'`, no completion, no level advance.

**Mixing in next-level words (v9.11).** Once the current level reaches 70% mastery, each pick may land on an unseen word of the **next** level. It is shown and recorded but does not change `levelId` and does not count towards the current level's completion.

| Constant | Value | Meaning |
| --- | --- | --- |
| `MASTERY_RATIO` | 0.85 | graduation line (0.90 before v9.11) |
| `MIX_START` | 0.70 | mastery at which mixing starts |
| `MIX_FULL` | 0.85 | mastery at which the mixing ratio caps (aligned with graduation) |
| `MIX_MIN` | 0.10 | mixing probability at 70% |
| `MIX_MAX` | 0.30 | mixing probability at ≥85% |
| `MIX_MIN_REQUIRED` | 20 | levels smaller than 20 words never mix |
| `MIX_WINDOW_CAP` / `MIX_WINDOW_SIZE` | 6 / 20 | at most 6 mixed words per rolling window of 20 picks |

```
m = mastered / required
m <  0.70                  -> 0
0.70 <= m < 0.85           -> 0.10 + 0.20 * (m - 0.70) / (0.85 - 0.70)
m >= 0.85                  -> 0.30
required < 20 or = 0       -> 0
last level (no next level) -> 0
```

Invariant: `MIX_MAX === MIX_WINDOW_CAP / MIX_WINDOW_SIZE` (0.30 === 6/20); the window cap is asserted by `B-19.capAligned`, because changing only one side makes the probability ceiling unreachable. Measured effect (3 seeds, `audit/mix70-sim.mjs`): S1 (100 words / 20 picks a day / 80% accuracy) graduation 38.00 → **40.33 days (+6.1%)**; S2 (392 words / 60 picks / 85%) 44.33 → **44.33 (flat)**; the share of next-level words in the last 200 picks of the dead zone goes 0.3% → **46.5% / 29.2%**.

### 4.5 Dynamic picking (`pickDynamicWord`)

1. Session wrong-word requeue (gap 3, max 2 per word).
2. Probabilistic review of not-yet-due words (correct review only refreshes, does not extend interval).
3. New word with dynamic ratio; new words are randomly chosen from the first 20 unseen words of the current level (file order preserved).
4. Next-level word when mixing is active (v9.11): only in `auto` mode with `dueCount > 0`, `previewBudget > 0` and `getMixRatio() > 0`; the dice are rolled with that probability and a word from the next level's unseen pool is returned with `preview=true`. **The injection point is fixed: after wrong-word requeue, before the due fallback.**
5. Due words (deduped by `memoryKey`, suspended and last-12 excluded).
6. Fallback: random review.

Mixing never returns `null` to the caller: no next level, next-level dictionary load failure, no unseen next-level word, or every candidate inside the recent window → `pickPreviewWord` returns `null` and `pickDynamicWord` **falls through to step 5**. When `previewBudget <= 0` or `mix <= 0` the dice are not rolled at all (no `Math.random()` call), so existing deterministic assertions keep the same random sequence. `useWordList.ts` keeps the rolling window and passes `previewBudget = max(0, 6 − mixed in window)`.

| due count | new-word ratio | review chance |
| --- | --- | --- |
| 0 | 1 | 0.12 |
| 1–20 | 0.4 | 0.12 |
| 21–100 | 0.2 | 0.03 |
| 101–299 | 0.1 | 0 |
| ≥300 | 0.02 | 0 |

"Learned" dedupe is case-insensitive by word; SRS keys preserve case (`March` ≠ `march`). No hard daily new-word cap.

### 4.6 Typing judgement — separator equivalence (v9.10)

- Single judgement point: the settle effect in `Word/index.tsx` compares `inputWord[i]` with `displayWord[i]` through `charsMatch(input, expected, isIgnoreCase)`.
- Equivalence class `SEPARATOR_CLASS = { ' ', '␣' (EXPLICIT_SPACE), '-', '/' }`: `t-shirt` typed as `t shirt`, `a/an` as `a an`, `ice cream` as `ice-cream` are all accepted.
- `_` `.` `'` `&` never take part (`a.m.` vs `a m`, `don't` vs `dont`, `AT&T` stay strict).
- Length and indexes stay 1:1 (`t shirt` and `t-shirt` are both 7 chars), so letter states, `letterMistake` indexes, exports and stored keys are unaffected; `isIgnoreCase` keeps its meaning.
- Enabled only for `language ∈ {en, de}` with `languageCategory !== 'code'` (romaji `-` is a long-vowel mark; in code lists `-` `/` `_` are syntax).
- Data: across 385 dictionaries / 457,031 head words, 3,301 contain `-`, 359 contain `/`, 73 contain `_` (all in code dictionaries).

## 5. Data & migration

Dexie `RecordDB` schema v4:

| Table | Key/index | Note |
| --- | --- | --- |
| `wordRecords` | `++id, word, timeStamp, dict, chapter, wrongCount, [dict+chapter]` | upstream, kept |
| `chapterRecords` | `++id, timeStamp, dict, chapter, time, [dict+chapter]` | upstream, kept |
| `reviewRecords` | `++id, dict, createTime, isFinished` | upstream, kept |
| `memoryRecords` | `key, word, dict, due, [dict+due]` | new SRS records |

`memoryRecords` fields: `key` (`${dict}::${word}`, case preserved since v9.5, legacy lower-case keys read-compatible), `word`/`dict`/`trans`/`phone`, `stage`/`interval`/`ease`, `due`/`lastSeen`/`createdAt`, `attempts`/`correct`/`wrong`/`slow`/`lapses`, `lastResult`, plus `shadowInterval`/`shadowDue`/`shadowAt` (shadow scheduling: recorded, not used for actual due).

Migration highlights: v7 adds the table; v9.3 one-time migration from `wordRecords` (stage by historical wrong count: 0 → 3, 1–2 → 2, ≥3 → 1); v9.4 atomic import; v9.5 case-preserving keys; v9.6 auto-level state key migration; v9.9 startup cleanup of `RecordDB-import-*` leftovers. Backup/restore details: [`Backup-Restore.md`](Backup-Restore.md).

## 6. Build & run

Requirements: Node.js ≥ 18 (author used 24.19.0), Yarn 1.x, Windows 10/11 + PowerShell 5.1+/7 for the desktop build. No `electron` npm dependency: only `app.asar` is built; the runtime is an official prebuilt Electron binary.

```bash
git clone https://github.com/menlieyijin/qwerty-learner.git
cd qwerty-learner
git checkout dsh-local-v8
yarn install
yarn start          # Vite dev server, http://localhost:5173/
yarn build          # production output in build/
```

```powershell
pwsh -File scripts/quality-gate.ps1                     # tsc + eslint --max-warnings 0
pwsh -File scripts/dsh-release.ps1                      # gates + build + asar + SHA256
pwsh -File scripts/dsh-release.ps1 -TestInstall -Smoke  # test install + isolated CDP smoke
pwsh -File scripts/dsh-release.ps1 -Install             # backup + atomic replace + verify + log
pwsh -File scripts/dsh-rollback.ps1 -List
pwsh -File scripts/dsh-rollback.ps1
```

- Release script stages `local-fork/package.json` + `electron/` + `build/` + `LICENSE` + `FORK-NOTICE.md`, packs with `npx @electron/asar`, and verifies SHA256 before/after install.
- Path parameters `-StageRoot`, `-BackupDir`, `-AuditRoot`, `-TestAppDir`, `-InstallDirs` **must be overridden** outside the author's machine; defaults reflect the author's local layout. The scripts are Windows-only.
- `yarn start` serves the web app only; tray/backup/enhancement panel require the Electron shell.
- Electron runtime upgrades are separate, manual steps (official zip + rcedit branding + verified replacement); see [`Electron-EOL.md`](Electron-EOL.md). Electron 43.x EOL: 2027-01-05.

## 7. Versioning

- App version single source: `local-fork/package.json` → `1.0.0-enhanced-v9.11` (read by main process, preload via `app:version-sync`, injected panel via `window.__QZ_VERSION__`).
- Root `package.json` stays at upstream `0.1.0` and is not the desktop version.
- Milestone tags: `vX.Y-dsh-local` (v7.1, v8.9, v9.0, v9.2, v9.3, v9.5, v9.6, v9.7, v9.8, v9.9; v9.10 and v9.11 are not tagged yet). v9.1/v9.2 and v9.4/v9.5 were released in shared commits, so no separate tags.
- Installer exe metadata is written by rcedit only during runtime upgrades and may lag the app version (currently FileVersion 9.8.0.0 while the app is v9.11).

## 8. Security design

- `contextIsolation` + sandboxed preload; whitelist-only IPC with sender validation; clipboard window uses a dedicated minimal preload (3 capabilities instead of 40+).
- Navigation restricted to `file://` inside `app.getAppPath()`; external `http(s)` links go to the system browser; all other protocols denied.
- All web permissions denied by default (`clipboard-sanitized-write` is the only exception).
- Main-window CSP injected via response headers, `script-src` uses sha256 of the build's inline scripts (fallback keeps `unsafe-inline` to avoid a blank window).
- Dictionary downloads restricted to trusted HTTPS `.json` sources with size/structure checks and redirect re-validation (SSRF protection); pronunciation cache (`qzcache:`) only for Youdao `dictvoice` audio.
- **Desktop telemetry off by default**: Mixpanel / Vercel Analytics stay uninitialized unless `localStorage['qzTelemetryOptIn'] = '1'` (or `qzTelemetry.optIn()`). When opted in, upstream third-party analytics config is reused. Web builds keep upstream behavior; `gtag`/GA script was removed from `index.html` in v9.8.
- Log redaction (absolute paths and URL query strings), daily log rotation with 14-day retention; test hooks only with `QZ_ALLOW_MULTI=1`.
- Test/multi-instance isolation via `QZ_USER_DATA` and `QZ_PLUS_DIR`.

## 9. Testing

- Static gates: `tsc --noEmit` 0 errors; `eslint --max-warnings 0` clean.
- Core-algorithm regression: real `src` bundled with esbuild, Node stubs, fixed seed and injected clock, `--strict`. Results: **248 assertions** in v9.3–v9.6; **253** in v9.7–v9.9; **309/309** (120 SRS + 189 auto-level) in v9.11, plus a determinism check (both sims run twice, byte-identical). Typing-judgement cases live outside that gate: `wordmatch-src` 29/29 (bundles the real source) and `word-judgment-sim` 42/42.
- Playwright (local mode): 12 passed / 5 skipped (skips are retired legacy flows).
- CDP smoke: 11/11; shell security probes: 19/19 (author-machine v9.9 record). For v9.10 / v9.11 the smoke was run **manually**: the in-script `-Smoke` hit a GPU crash in the build session (`NO_PAGE`), so the same `scripts/dsh-smoke.mjs` was executed with `--disable-gpu --no-sandbox` and an isolated profile — 11/11 for both test installs and for the **installed** v9.11 build (`logs\smoke-1.0.0-enhanced-v9.11-installed.txt`). `smoke=false` in the install logs only means the install step itself ran without `-Smoke`.
- The regression scripts and reports live in the author's separate audit directory and are **not shipped** in this repository. A clean clone will SKIP the `-WithSim` gate; the numbers above are local acceptance records, not public CI results.

## 10. Known limitations

1. Unofficial fork; upstream support does not apply; upstream updates are not merged.
2. Desktop shell tested only on Windows 11 (26100); macOS/Linux unverified.
3. Core regression not reproducible from the public repo (scripts/reports not included).
4. Electron 43.8.3 reaches EOL on 2027-01-05; runtime upgrades are manual (rcedit branding).
5. exe file metadata may lag the in-app version.
6. No code signing; SmartScreen warnings possible.
7. No hard daily new-word cap; the daily goal is informational only.
8. Telemetry: desktop default off; opt-in reuses upstream third-party analytics config; web build keeps upstream analytics.
9. Runtime directory backups may catch LevelDB mid-write; prefer JSON export / `data.json` for cross-device restore.
10. Online lookup/translation and pronunciation depend on third-party services.
11. Dictionary data copyright belongs to upstream/original sources; 5 legacy dictionaries restored from upstream old builds.
12. No guarantee of forward/backward data compatibility with upstream future versions; importer must be ≥ exporter version.
13. Release/quality-gate scripts have author-machine default paths and are Windows-only.
14. No telemetry UI switch yet (localStorage/console only).

## 11. License & credits

GPL-3.0; upstream `LICENSE` preserved untouched; redistributions must include full corresponding source, keep notices, and state modifications (this document / `FORK-NOTICE.md` serve as the modification notice). `app.asar` bundles `LICENSE` and `FORK-NOTICE.md`.

Credits: RealKai42 and all Qwerty Learner contributors; dictionary/data sources (kajweb and community contributors); Youdao/dictionaryapi.dev/MyMemory for lookup/pronunciation services; Electron/Chromium/React/Vite/Dexie/Tailwind CSS; **DeepSeek Harness (dsh)** for the toolchain used to develop, audit and document this fork (tooling attribution, not an endorsement).

*See also: [`FORK-NOTICE.md`](../FORK-NOTICE.md) · [`DSH-FORK.md`](DSH-FORK.md) · [`RELEASE-NOTES-v9.11.md`](RELEASE-NOTES-v9.11.md) · [`RELEASE-NOTES-v9.9.md`](RELEASE-NOTES-v9.9.md) · [`Backup-Restore.md`](Backup-Restore.md) · [`Electron-EOL.md`](Electron-EOL.md).*
