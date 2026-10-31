# v11.0.0 发布说明（dsh）

> 版本号：`1.0.0-enhanced-v11.0.1`（唯一来源 `local-fork/package.json`，构建期注入 `APP_VERSION`）

## 一句话

删掉注入式「增强面板」，把它的全部功能重建为设置对话框里的两个页签（词库管理 / 桌面工具），
其余设置并入已有的显示、音效、数据页；UI 只有一套（Headless UI + Radix + Tailwind）。

## 用户可见变化

| 之前 | 现在 |
| --- | --- |
| 顶栏「工具」→ 设置 → 关于 → 打开增强工具 → 一整页独立面板（自带配色/页签/滚动条） | 设置 → 词库管理 / 桌面工具（与其它设置同一套控件与配色） |
| 窗口置顶、迷你模式、托盘、自启、透明度、缩放 | 设置 → 显示设置 → 窗口与系统 |
| 强调色、单词字体、深色模式 | 设置 → 显示设置 → 主题与字体 |
| 键音、发音缓存 | 设置 → 音效设置 |
| 每日目标、统计、14 天、记忆曲线、到期复习、自动进阶、备份、全量导入导出、错词/慢词/错误键 | 设置 → 数据设置 |
| 内置词库搜索/切换/收藏、在线更新、自定义词库 | 设置 → 词库管理 |
| 番茄钟、查词、发音预缓存、文件位置 | 设置 → 桌面工具 |

快捷键 `Ctrl+Alt+Q`、托盘「打开设置」现在直接打开设置对话框（不再有单独的面板）。

## 结构

| 文件 | 变化 |
| --- | --- |
| `local-fork/electron/enhance/enhance.js` | 2605 → 1235 行；删除面板 DOM/CSS/页签与 74 条面板规则；保留词卡、悬停提示、toast、键音、主题、统计与备份；新增无头 `window.qzRuntime`（13 个方法） |
| `src/utils/desktop.ts` | 新增：`window.qwertyEnhance` / `window.qzRuntime` 的唯一定义与访问点，网页返回 `null` |
| `src/pages/Typing/components/Setting/` | 新增 `controls.tsx`（Section/Row/Toggle/Range/Select/Btn/Stats/Bar）、`SettingBoundary.tsx`、`DictSetting.tsx`、`ToolsSetting.tsx`、`desktop/*`（窗口/外观/音效/数据）；`index.tsx` 页签表加 `desktopOnly` |
| `main.js` | 托盘入口改 `openSettings`；移除 `panelAppearance` 默认值 |
| `scripts/dsh-smoke.mjs` | 改为打开设置、断言 7 页签 + `qzRuntime` + `collectStats()` 返回结构 |
| `scripts/verify-pages.mjs` | 17 → 20 项：7 页签、数据页渲染、顶栏无「工具」 |

## 修复

| 编号 | 问题 | 证据 |
| --- | --- | --- |
| P1-2 | 打开数据页把 `wordRecords` 全表读两遍 | `readRecordInsights` 加 3s TTL，React 顺序调用；只扫一次 |
| P1-3 | 番茄钟在 `setState` updater 里做副作用；窗口节流后计时变慢 | 改为结束时间戳 + 500ms 轮询 |
| P1-4 | 键音音量拖动时每个像素写一次设置文件 | `onChange` 预览、`onValueCommit` 落盘 |
| P2-2 | 单个面板抛错会让整个设置白屏 | `SettingBoundary` 按页签隔离，可重试 |
| P2-5 | 自定义词库导入无体积上限 | 32MB 上限 + 提示 |

## 验证

| 检查 | 结果 |
| --- | --- |
| tsc + eslint | 通过 |
| build | 11.2s |
| `test:core` | 309/309 + determinism |
| `test:stats` | 15/15 |
| `test:start-level` / `test:pages` / `test:typing` / `test:csv` | 21 / **20** / 18 / 14 |
| 隔离冒烟 | **13/13**（新增 settingsTabs / runtimeReady / statsRuntime） |
| `test:visual` | 2/2（基线按新设置页重建，连跑 3 次稳定） |
| 双目录安装 | asar `1169D76C…` 一致 |

## 已知限制

- 词库在线更新仍是「检查 + 单个下载」，无断点续传。
- 强调色只重映射常见 indigo 工具类，带透明度的组合色不跟随（视觉细节，见 `AUDIT-V11.md` P2-6）。
- 桌面面板（词库/工具）依赖 Electron 桥，浏览器版不显示；视觉基线只覆盖网页版。


---

# v11.0.1（补丁）

- 设置对话框外层是 `text-center`，桌面面板的行标签/词库列表继承了居中 → `Section` 显式 `text-left`；
- 词库页两个筛选下拉固定宽度（`w-24`）并把文案区分为「全部词库 / 全部分类」，避免两个「全部」无法分辨；
- 版本号 → `1.0.0-enhanced-v11.0.1`；asar `A1F9A90A…`。

验证：tsc + eslint 通过；`test:all` 88 条 + `test:core` 309/309；`test:pages` 20/20；
`test:visual` 2/2；隔离冒烟 13/13；双目录安装哈希一致。桌面四页（显示/数据/词库/工具）用 CDP 截图逐页复核，
无「读取失败 / 未就绪」。
