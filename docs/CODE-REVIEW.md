# 代码审查报告

范围：`src/`（React 前端）、`local-fork/electron/`（主进程 / preload / 注入面板）、`src/utils/db/`（Dexie 数据层）、
`scripts/`（构建 / 验证 / 发布）、CI 与配置。版本：v10.7.0（2026-10-31）。
方法：静态扫描（未引用符号 / 未用依赖 / 未用样式 / `JSON.parse` 与 `catch` 盘点）+ 行为脚本 + 视觉基线 + 发布链实测。

## P0 安全与数据正确性

| # | 位置 | 问题 | 影响 | 状态 |
| --- | --- | --- | --- | --- |
| P0-1 | `ErrorBook/DropdownExport` → `utils/csvSafe` | 导出 CSV 未中和 `= + - @` 前缀，Excel 会当公式执行 | 分享文件可被公式注入 | 已修 v10.2（14 条断言） |
| P0-2 | `pages/Typing/index.tsx` | `qzDueReviewWords` 脏数据未校验元素形状 → 整页 ErrorBoundary | 备份恢复/手改配置即白屏 | 已修 v10.2（前后对照 + 正控） |
| P0-3 | `vite.config.ts` | `getLastCommit` 的 Promise 在非 git 环境永不 resolve | Docker/源码包构建静默失败（退出码 0 无产物） | 已修 v10.1 |
| P0-4 | `pages/Typing/index.tsx` | 暂停保存只比 `wordCount`，二次暂停丢正确数/用时 | 会话记录不准 | 已修 v10.2（含反证） |
| P0-5 | `local-fork/electron/main.js` | CSP 解析失败时回退 `script-src 'self' 'unsafe-inline'` | 极端情况下放宽脚本来源 | **接受风险**（改 fail-closed 会白屏） |
| P0-6 | `main.js` / `preload.js` | IPC 来源白名单、导航/外链守卫、权限默认拒绝 | — | 审查通过（v8.9 起） |

## P1 缺陷与边界

| # | 位置 | 问题 | 影响 | 状态 |
| --- | --- | --- | --- | --- |
| P1-1 | `ResultScreen/index.tsx` | 空词表 `0/0 = NaN` | 界面出现 `NaN%`，分级落到 else | 已修 v10.4（`test:stats` 15 条） |
| P1-2 | `scripts/dsh-release.ps1` | `release-info.json` / 安装日志带 UTF-8 BOM | `JSON.parse` 直接抛错 | 已修 v10.2 |
| P1-3 | 8 处 `trans` 归一化 | 实现与语义各不相同（过滤/不过滤、是否回退标量） | 数据形态不一致 | 已修 v10.3（统一 `normalizeTrans`） |
| P1-4 | `public/dicts/*.json` | 个别词库 `metadata.length` 与实际词数不符（上游数据） | 画廊词数/分页显示异常 | **未修**，已出上游 issue 稿（`docs/UPSTREAM-PR-DRAFT.md` #6） |
| P1-5 | `src/**` 共 52 处空 `catch` | 多数带 `/* ignore */` 注释，属有意降级 | 少数静默吞错难以定位 | 审查后**保留**（逐处看过，均为可降级路径） |
| P1-6 | `src/**` 5 处 `JSON.parse` | — | — | 全部在 `try/catch` 内，通过 |

## P2 一致性与可维护性

| # | 位置 | 问题 | 状态 |
| --- | --- | --- | --- |
| P2-1 | `scripts/core-regression/` | 11 个文件仍用 `_v93-` 历史前缀 | 已修 v10.5 |
| P2-2 | `docs/DSH-FORK*.md`、`THIRD-PARTY.md` | 硬编码「当前版本 / 提交数」，发布即过期 | 已修 v10.5（改为指向唯一来源） |
| P2-3 | `src/utils/index.ts` | 168 行杂物桶（键盘/平台/时间/数值/章节/音频混放） | 已修 v10.6（拆 6 文件 + 14 行 barrel） |
| P2-4 | `src/index.css` | 3 个死类 + 4 段死 keyframes | 已修 v10.6（视觉基线证明未变） |
| P2-5 | `package.json` | 13 个未被引用的依赖 | 已修 v10.6（lock -1334 行） |
| P2-6 | `src/**` | 7 处 `React.FC` 与 30 处函数声明并存 | 已修 v10.6（`React.FC` 归零） |
| P2-7 | 仓库 | 无成文代码约定 | 已修 v10.6（`docs/CONVENTIONS.md`） |
| P2-8 | 增强面板「关于」+ 顶栏「工具」按钮 | 同一信息两处、About 一屏 3456 字符文字 | 已修 v10.7（合并进 设置 → 关于） |
| P2-9 | `Setting/index.tsx` | 4 段重复页签 JSX、图标两套 | 已修 v10.7（150 → 131 行，统一 tabler） |
| P2-10 | 前端 | 拿不到版本号，只能硬编码 | 已修 v10.7（构建期注入 `APP_VERSION`） |

## 未闭环（需后续批次）

| # | 项 | 原因 | 建议 |
| --- | --- | --- | --- |
| O-1 | `enhance.js` 2605 行未模块化 | 面板无组件级用例，拆分无法验证 | 先补面板级 CDP 用例，再按「常规/数据/词库/工具」拆 4 个模块 |
| O-2 | 壳层（托盘 / 全局快捷键 / 每日备份）无自动化 | 需真实桌面会话，CI 难以复现 | 用 Playwright Electron 或 AutoHotkey 做冒烟 |
| O-3 | CI 只跑 `test:quality` + build | 行为脚本需 Electron，未接入 | 加 Windows runner 跑 `test:core` + `test:stats`（纯 node，可先接） |
| O-4 | 无依赖自动更新 / CHANGELOG | — | 接 Dependabot + 从 conventional commits 生成 CHANGELOG |
| O-5 | 无动态模糊测试 / 渗透测试 | 工具与时间成本 | 数据导入路径优先做 fuzz（`importDatabase`） |

## 仓库正规化建议

1. **scripts 分层**：`scripts/{release,verify,core-regression}/` 三类分开，根目录只留跨类入口（现状已接近，缺 `verify/` 子目录）。
2. **CI 分级**：PR 跑 `test:quality` + `test:core` + `test:stats`（约 1 分钟，纯 node）；nightly 跑 Electron 行为脚本与视觉基线。
3. **依赖治理**：把本次用到的「未引用依赖扫描」脚本化（`npm run deps:unused`），配合 Dependabot 月度清理。
4. **变更记录**：已有 conventional commit + tag 习惯，可直接接 `standard-version` 生成 CHANGELOG；避免文档再手写版本号。
5. **分支保护 + PR 模板**：模板里放 `CONVENTIONS.md §6` 的验证矩阵勾选，避免"只跑 build 就算验证"。
6. **目录**：当前 `src/{pages,components,hooks,utils,store,resources,typings}` 分层清晰，暂不建议动；Electron 侧若继续长大，再考虑 `apps/web` + `apps/desktop` 拆分。

## 本次同批修正（v10.7.0）

- 增强工具入口：顶栏「工具」按钮 → **设置 → 关于 → 打开增强工具**（删除 `EnhanceButton`）。
- 删除增强面板「关于」页（3456 字符）与其三处长说明；前端新增 80 行紧凑「关于」页。
- 设置页签去重（150 → 131 行），图标统一 tabler；版本号改构建期注入。
- 冒烟断言修正：面板页签从「≥5」改为「必须含 常规/数据/词库/工具」。
- `test:pages` 19 项（新增 7d 版本一致、7e 顶栏无「工具」）。
