# v11 全栈审查（根因版）

范围：前端 `src/`、桌面壳 `local-fork/electron/`、数据库（Dexie / QwertyPlusDB）、IPC、构建与发布配置。
分组：P0 安全/数据 · P1 缺陷/性能 · P2 一致性/结构。每条只写「位置 / 影响 / 根因 / 处理」。

## 结论

| 级别 | 新发现 | 已修 | 接受风险 | 未修 |
| --- | --- | --- | --- | --- |
| P0 | 0 | 0 | 1（运行时暴露面） | 0 |
| P1 | 4 | 4 | 0 | 0 |
| P2 | 5 | 5 | 1（主题覆盖不完整） | 0 |

v10 已修的 6 个缺陷（CSV 公式注入、脏 payload 白屏、非 git 构建静默失败、二次暂停丢更新、空词表 NaN、日志 BOM）见
`REFACTOR-LOG.md` 批次 E/I，本轮未回归。

## P0

| # | 位置 | 问题 | 根因 | 处理 |
| --- | --- | --- | --- | --- |
| P0-1 | `window.qzRuntime`（`enhance/enhance.js`） | 页面脚本可调用 `importAll / exportAll / setCurrentDict` 等 | 运行时挂在主世界，与页面同权限 | **接受**：页面本身就是受信应用代码，改动前同样的能力已通过面板按钮暴露；未新增跨源入口。IPC 侧仍有 `isTrustedWebContents` 白名单 |

主进程复核（无新问题）：`handle()` 统一校验 sender；`dicts:read` 用 `basename + /^[A-Za-z0-9._-]+\.json$/`；
`dicts:downloadUpdate` 走 host 白名单 + 重定向后复检；`updateSettings` 按默认值类型校验并 clamp 透明度/缩放。

## P1

| # | 位置 | 问题 | 根因 | 处理 |
| --- | --- | --- | --- | --- |
| P1-1 | `enhance/enhance.js`（2605 行） | 增强工具是独立 Shadow DOM 面板：自带一套 CSS/状态/页签，与设置面板两套 UI；「在关于页加入口」只是跳板 | 历史上面板先于设置页存在，功能与视图写在一起（`renderXxx` 直接改 DOM），无法被 React 复用 | 删除整页 UI（净减 937 行），逻辑改为无头运行时 `window.qzRuntime`；功能在设置内用 React 重建（见 P2-1） |
| P1-2 | 同上 `collectStats` + `collectInsights` | 打开一次数据页把 `wordRecords` 全表读两遍 | 两个采集函数各自 `idbAll` | `readRecordInsights` 加 3s TTL；React 侧改为顺序调用，第二次命中缓存 |
| P1-3 | `Setting/ToolsSetting.tsx` 番茄钟 | 原实现在 `setRemain` 的 updater 里调用 `setMode/setCount/notify`，StrictMode 下会重复执行；窗口节流后计时变慢 | 用「每秒自减」建模 | 改为「结束时间戳 + 500ms 轮询」，副作用移出 updater |
| P1-4 | `Setting/desktop/DesktopSound.tsx` | 键音音量拖动时每个像素写一次 `enhanced-settings.json` | 滑块只有 `onChange` | `onChange` 只预览，`onValueCommit` 才落盘 |

## P2

| # | 位置 | 问题 | 根因 | 处理 |
| --- | --- | --- | --- | --- |
| P2-1 | `Setting/index.tsx` | 设置页签写死 5 个、无桌面能力 | 没有「按运行环境裁剪」的概念 | 页签表加 `desktopOnly`，网页版过滤；桌面版 7 个（音效/显示/数据/词库/工具/高级/关于） |
| P2-2 | `Setting/*` | 单个面板抛错会让整个设置对话框白屏 | 无错误边界 | 新增 `SettingBoundary`，按页签隔离并可重试 |
| P2-3 | 全局 `window.qwertyEnhance` | 组件直接摸全局对象，网页版无类型 | 无桥接层 | 新增 `src/utils/desktop.ts`：唯一访问点 + 完整类型 + `isDesktop()`；网页返回 `null`，不渲染假按钮 |
| P2-4 | `utils/desktop.ts` + `main.js` | `panelAppearance` 只写不读（面板删除后成死配置） | 面板专属设置未清理 | 两处默认值删除 |
| P2-5 | `Setting/DictSetting.tsx` | 自定义词库导入无体积上限 | 直接 `file.text()` | 32MB 上限 + 明确提示 |
| P2-6 | `enhance/enhance.css` | 强调色只重映射 `text/bg/border-indigo-*` 等工具类，`bg-indigo-400/70` 一类带透明度的不会变 | 用 CSS 覆盖 Tailwind 类，天然不完整 | **接受**：属视觉细节，不影响功能；彻底修需把颜色提成 CSS 变量（会动全站样式） |

## 结构与一致性（本轮同时收敛）

- 词库页的「设为当前」不再走官方画廊 DOM 自动化（原 160 行 `trySwitchViaOfficialUI/findAppTrigger/isUnsafeSwitch`），
  直接写 `currentDict/learningMode/currentChapter` 后重载；缺 `id` 的词库给出明确提示。
- 面板删除后清理死代码：`fmtNum`、`sleep`、`panelAppearance`、`#btn-*` 绑定、74 条面板 CSS 规则。
- `docs/` 中「顶栏工具 / 设置 → 关于 → 打开增强工具」的旧描述全部改为「设置 → 词库管理 / 桌面工具」。

## 仍未闭环（明确边界，不是待办）

| 项 | 说明 |
| --- | --- |
| 视觉覆盖 | 桌面面板（词库/工具）依赖 Electron 桥，Playwright 只覆盖网页版设置页；桌面侧靠冒烟 + `test:pages` 的 DOM 断言 |
| 词库在线更新 | 只做「检查 + 单个下载」，无断点续传/全量镜像；失败靠重试按钮 |
| 无 fuzz / 渗透 | 输入面（导入 JSON/CSV、脏 payload）有定向用例，但没有自动化模糊测试 |
| `enhance.css` 主题 | 见 P2-6 |

## 仓库正规化建议（按收益排序）

1. `scripts/` 拆 `release/ | verify/ | core-regression/`，`package.json` 只留入口。
2. CI 分级：PR 跑 `test:quality + test:stats + test:core`（纯 Node，约 1 分钟）；nightly 跑 Electron 冒烟与视觉。
3. Dependabot（grouped）+ 每月 `npm run deps:unused` 清理。
4. conventional commits → 自动 CHANGELOG；文档不再手写版本号（已改为读 `local-fork/package.json`）。
5. 分支保护 + PR 模板勾选「改了什么跑什么」。
6. 目录暂不动；Electron 侧继续增长再拆 `apps/desktop`。
