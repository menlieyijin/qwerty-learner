# Qwerty Learner Plus (v10, dsh fork)

> **Unofficial fork** of [Qwerty Learner](https://github.com/RealKai42/qwerty-learner) (GPL-3.0, base commit `1182426`).
> Maintained by **dsh** on branch `dsh-local-v8`. Not affiliated with, endorsed by, or maintained by the upstream authors.
> Upstream README (kept for attribution) is in [`docs/UPSTREAM-README.md`](docs/UPSTREAM-README.md).

## What this fork changes

| Area | Change |
| --- | --- |
| Memory model | Ebbinghaus ladder + SRS scheduling; due reviews mixed with new words by ratio |
| Learning path | 13 auto-advancing levels (primary → junior → senior → CET-4 → CET-6 → high-frequency); pick a starting level on first launch, then advance automatically |
| Practice flow | No chapter gating, dynamic word picking, wrong-word requeue, skip/pause, review mode |
| Local data | IndexedDB memory/error records, import/export and backups with version checks |
| Desktop shell | Electron wrapper: dictionary updates, clipboard lookup, enhancement panel (theme/font/shortcuts); telemetry off by default |
| De-marketing | Upstream donation/promo UI and remote QR assets removed; copyright and attribution kept |
| Engineering | Release/rollback/smoke/quality-gate scripts, 309 regression assertions, enforced dependency layering |

## Deploy

See [`docs/QUICKSTART.md`](docs/QUICKSTART.md): two commands for development, one for a production build, plus the desktop packaging script and the `QZ_*` environment variables it needs on machines that are not the author's.

```bash
npm ci
npm run dev          # http://localhost:5173
npm run build        # static output in build/
```

## Docs

| Doc | Content |
| --- | --- |
| [`FORK-NOTICE.md`](FORK-NOTICE.md) | Fork declaration, GPL compliance, known limitations |
| [`docs/DSH-FORK_EN.md`](docs/DSH-FORK_EN.md) | Technical details (English) |
| [`docs/RELEASE-NOTES-v9.15.md`](docs/RELEASE-NOTES-v9.15.md) | Latest release notes |
| [`docs/AUDIT-CLOSE.md`](docs/AUDIT-CLOSE.md) | Pre-publication audit, item by item |
| [`docs/QUICKSTART.md`](docs/QUICKSTART.md) | Minimal setup steps |

## License

GPL-3.0, same as upstream. `LICENSE` is kept byte-identical to upstream; see `FORK-NOTICE.md` for attribution details.
