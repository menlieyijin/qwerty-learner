# v11.6 全栈审查（根因版）

审查范围：`src/`（React 前端）、`local-fork/electron/`（主进程 / preload / 注入浮层）、Dexie/IndexedDB 数据层、IPC 与配置、构建与发布脚本、CI。
方法：逐目录读代码 + 运行现有 221 条自动化检查 + 针对高风险路径做反证（读失败、脏备份、并发备份、异常窗口状态）。
原则：先判断**为什么会出错**，再决定改哪一层；能下沉到数据层/接口层解决的不在 UI 打补丁。

严重度：**P0** 必现不可用/数据丢失；**P1** 高概率数据错误或明显卡顿；**P2** 特定条件下错误/安全边界收窄；**P3** 可维护性/体验。

## 0. 结论与修复总览

本轮确认并处理了 1 个必现的构建阻断（Node 版本与 `@electron/asar` 不匹配）和 2 个数据可靠性根因（备份重入、导入非原子），以及统计 O(n²)、结算竞态、读失败伪装空库等一批高概率问题。仍有 4 项属于架构级改造（FSRS、复习进度拆存储、错题聚合表、主进程同步 IO），已在 §10 给出分阶段方案，不在本轮强行替换。

| ID | 模块 | 问题 | 级别 | 状态 |
| --- | --- | --- | --- | --- |
| B-1 | 构建 | `@electron/asar@4` 要求 Node ≥22.12，仓库 engines/CI/Docker 仍是 18~20，`npm run release` 必挂 | P0 | 已修 |
| B-2 | CI | `desktop.yml` 用 Node 20，三个桌面 job 必然失败；Actions v3 已停用 | P0 | 已修 |
| B-3 | 构建 | `playwright.config.ts` 的本机 baseURL 守卫被注释符写坏，恒为真 | P1 | 已修 |
| B-4 | 构建 | Electron 发行包下载零校验，坏包会被永久复用 | P1 | 已修 |
| B-5 | 构建 | 首屏静态引入 xlsx（429KB），分包只拆文件不拆加载时机 | P1 | 已修 |
| B-6 | 构建 | 生产构建 `drop:['console']` 把 `console.error` 也删了，错误分支彻底静默 | P1 | 已修 |
| B-7 | 构建 | tsconfig `target: es5` + polyfill + Vite es2020 三套基线互相矛盾 | P2 | 已修 |
| B-8 | 构建 | Docker `COPY . .` 无 `.dockerignore`，把 node_modules/release/.git 带进镜像 | P2 | 已修 |
| B-9 | 依赖 | classnames + clsx + tailwind-merge 三套并存；7 个死依赖；TS 放在 dependencies | P2 | 已修 |
| B-10 | 发布 | 多目录安装只备份第一份，回滚失败仅警告，可能留下版本混用 | P1 | 已修 |
| B-11 | 发布 | asar 输出到被扫描的 staging 目录内，重跑可能自我包含 | P2 | 已修 |
| F-1 | 前端/统计 | 日桶用 `[...arr, x]` 累加，全年数据 O(n²) | P1 | 已修 |
| F-2 | 前端/出词 | 每次换词 4~6 次全表遍历；派生视图无缓存 | P1 | 已修（去重/best map 缓存） |
| F-3 | 前端/结算 | 重置章节先清状态、后结算上一词，旧增量污染新章节 | P1 | 已修（sessionEpoch） |
| F-4 | 前端/落库 | 词记录失败被吞、SRS 仍推进；`persisted` 在写成功前置位 | P1 | 已修（回滚 + 可重试） |
| F-5 | 前端/数据 | IndexedDB 读失败返回空数组，UI 显示「已全部学完」 | P1 | 已修（抛错 + 错误态） |
| F-6 | 前端/DB | `reviewRecords` 死表、`[dict+chapter]` 死索引、缺 `[word+dict]` | P2 | 已修（version 5） |
| F-7 | 前端/复习 | 每次翻词重写整份复习词表到 localStorage | P2 | 已修（会话/下标两个键 + 旧键迁移，30 项回归） |
| F-8 | 前端/错题 | 自动进阶下按 `currentDictId` 过滤错题，永远为空 | P1 | 已修（按实际词库分组 + 记忆记录兜底） |
| F-9 | 前端/输入 | code 词库「开始/继续」重放合成 keydown，textarea 收不到首字符 | P2 | 已修（焦点在 textarea 时写值并派发 input） |
| F-10 | 前端/导入 | 全量导入逐表 clear+put，无预校验、无事务 | P1 | 已修 |
| E-1 | 主进程/备份 | 备份无重入锁、同秒同名、修剪误删正在写的目录 | P1 | 已修 |
| E-2 | 主进程/退出 | `app.exit(0)` 硬退，不等备份/缓存落盘 | P1 | 已修 |
| E-3 | 主进程/安全 | 剪贴板小窗与主窗口共享 43 个 IPC 通道 | P2 | 已修（角色白名单） |
| E-4 | 主进程/安全 | 导航放行 app 目录内任意 HTML；CSP 只覆盖一个路径 | P2 | 已修（入口白名单 + 子框架守卫） |
| E-5 | 主进程/安全 | 查词缓存用普通对象 + 用户输入做键，`__proto__` 可污染 | P2 | 已修 |
| E-6 | 主进程/稳定 | 窗口状态缺字段 → `NaN` → BrowserWindow 抛错，进程无窗口 | P1 | 已修 |
| E-7 | 主进程/稳定 | 设置文件损坏静默回落默认值并被覆写 | P2 | 已修（留档 + .bak） |
| E-8 | 主进程/性能 | 备份 `copyTreeSync`、词库 `JSON.parse(readFileSync)` 阻塞 UI 线程 | P1 | 备份已修（异步 + `.partial` 原子改名）；词库解析仍待下沉（§7.1） |
| E-9 | 主进程/隐私 | 剪贴板每 1.2s 全量 readText；下载无并发去重 | P2 | 已修（格式探测 + 1.5s 轮询 + 同文件下载去重） |
| E-10 | 接口 | `app:openPath` / 字典 id 用对象下标，命中原型属性 | P2 | 已修 |
| E-11 | 接口 | `stats:update` 不取整/不夹取，Infinity 进设置与托盘 | P2 | 已修 |
| E-12 | 主进程 | 快捷键先全注销再注册，新键失败两个都失效 | P2 | 已修（先注册后注销） |

## 1. 前端

### 1.1 练习主链路（`src/pages/Typing`）

**F-1 统计聚合 O(n²)** — `src/pages/Analysis/hooks/useWordStats.ts:141-206`
每天 bucket 用 `bucket.words = [...bucket.words, word]`、`wrongKeys = [...a, ...b]`；5 万条记录时是十亿级元素搬运。根因是把不可变写法用在 O(n) 循环内。已改为单次遍历 + `Set`/`Map` 就地累加，字数、词数、WPM、正确率口径不变。

**F-2 每次换词重复全表聚合** — `src/utils/memory.ts:226`、`src/utils/autoLevel.ts:733`
`canonicalizeMemoryRecords` 和 `buildBestRecordMap` 每次调用都新建 Map/数组；一次换词会触发 4~6 次。已给 `memoryCache` 增加 revision，并把两个派生结果按「源数组 + revision」缓存；`upsert/remove/set/clear` 都会失效。这是**缓存层修复**，不是把循环写快一点。

**F-3 重置章节的结算竞态** — `src/pages/Typing/store/index.ts:105-230`、`Word/useAttemptSettlement.ts`
`REPEAT_CHAPTER/NEXT_CHAPTER/SETUP_CHAPTER` 先把统计清零，Word 的 `[word]` effect 才用旧 meta 结算，旧增量会落到新章节同下标的另一个词上。根因是「生产者先重置、消费者后结算」。已加 `sessionEpoch`：重置 +1，`REPORT_WORD_RESULT` 携带创建时的 epoch，reducer 丢弃过期增量；正常会话行为不变。

**F-4 落库失败静默且 SRS 照常推进** — `Word/useAttemptSettlement.ts:109`、`hooks/useSaveRecord.ts:91`
`persisted=true` 写在 `await` 之前，失败只 `console.error`（生产还被剥离）；`wordRecords` 失败但 `updateMemoryProgress` 继续。已改为：词记录失败直接抛；记忆曲线失败回滚词记录；`persisted` 仅成功后保持，失败复位并允许下次 settle 重试。根因是「发起写」被当成「写成」，以及两个写操作没有一致性约束。

**F-5 读失败伪装成空库** — `src/utils/memory.ts:482`、`useWordList.ts:58,137`
DB 打不开时返回 `[]`，UI 落到「词库已全部学完」。已改为抛错，`useWordList` 维护 `error` 状态，练习页显示「本地学习数据读取失败（数据仍在，不代表清空）」而不是空态。根因是数据层用空数组表达错误。

**F-8 自动进阶错题过滤** — `src/pages/ErrorBook/index.tsx:100-155`
`wordRecords.dict` 在自动进阶下是级别词库 id，`currentDictId` 仍是 cet4，过滤必空。已修：先按错题实际所属词库分组，优先当前词典，否则取错题最多的词典，并在按钮下方说明「当前词典没有错题，将从 X 的 N 个错题开始」；词库读不到时用 `memoryRecords` 的 trans/phone 构造 Word，断网也能复习。根因是「用当前选择推断历史数据归属」，不是默认值写错。

**F-9 code 词库首字符丢失** — `Typing/index.tsx:142-192`、`TextAreaHandler.tsx:21-60`
开始/继续时缓存按键并用合成 `KeyboardEvent` 重放；code 模式走 textarea 的 `input` 事件，合成 keydown 不会产生默认输入。已修：焦点在 textarea 时直接写入值并派发 `InputEvent('input', {data})`，其余通道仍走 keydown。彻底的方案仍是把两种输入收敛到 `applyInputAction`（§6.1-4）。

### 1.2 数据层

**F-6 Dexie schema 残留** — `src/utils/db/index.ts:22-45`
`reviewRecords` 自 v9.9 起零读写；`[dict+chapter]` 从未被查询；`where({word,dict})` 缺复合索引。已加 `version(5)`：删除死表/死索引，新增 `[word+dict]`。Dexie 会在升级时迁移并保留其余数据。

**F-10 全量导入非原子** — `local-fork/electron/enhance/enhance.js:1260`
逐 store 独立事务、先 clear 再 put、非法行静默丢弃，失败会留下部分覆盖。已改为：先对全部表做类型/主键预校验 → 单跨 store 事务 clear+put → 任一失败整体回滚；旧备份缺少的表不再清空；自定义词库同样预校验。跨 IndexedDB（RecordDB / QwertyPlusDB）仍无法一个事务覆盖，见 §7.4。

**F-7 复习进度存储膨胀** — `src/store/reviewInfoAtom.ts`、`src/store/reviewPersistence.ts`
`reviewRecord.words` 是完整词对象数组，每次翻词 `JSON.stringify` 全量写 localStorage。根因是把「大词表」和「小下标」放在同一个持久化 atom。已改为 `reviewModeInfo:session`（只在开始/结束复习时写）+ `reviewModeInfo:index`（每次翻词 ≈30B）；拆分/合并/旧键迁移做成纯函数，`npm run test:review-persist` 30 项断言覆盖（含「仅下标变化必须判为同一会话」这条热路径不变式）。旧键 `reviewModeInfo` 在模块加载时迁移一次后删除，升级用户不丢进度。

## 2. Electron 主进程 / IPC / 安全

**E-1 备份重入与修剪误删** — `main.js:489-594`
定时器、托盘、面板、导入前备份可并发；目录名只到秒；修剪按 mtime 排序后 `slice(7)` 会删掉另一路正在写的目录。已加 `backupRunning` 复用同一次执行、目录名加随机后缀、修剪跳过本次与 60 秒内新目录。根因是把定时任务当成一次性同步过程。

**E-2 退出截断** — `main.js:2400`、`2608`
`app:relaunch` 用 `app.exit(0)`，不触发 `will-quit`；备份最多等 8 秒快照，缓存 1.5 秒去抖。已改为正常 `app.quit()`，`will-quit` 在备份未完成时 `preventDefault` 并最多等 8 秒；退出前 `saveCachesNow()`。

**E-3 IPC 角色白名单** — `main.js:297-320`
`preload-clipboard.js` 只暴露 3 个能力，但主进程 `handle` 对两个窗口一视同仁。已按 `roleOf(sender)` 收敛：剪贴板窗只允许 `free:lookup` / `clipboard:close`，其余 40+ 通道拒绝并记 `ipc-deny`。这是「锁」而不是「门」的修复。

**E-4 导航与 CSP** — `main.js:1907-2030`
旧守卫允许 app 目录内任意 `file://` 文档，等于 asar 内任意 HTML 都带 preload；`connect-src` 还留着 mixpanel/vercel。已改为只允许 `build/index.html`（剪贴板窗额外允许自己的 `clipboard.html`），补 `will-frame-navigate`；移除营销域名；CSP hash 解析失败从 `logRenderer` 升为 `logError('csp-hash-degraded')`。仍保留 `unsafe-inline` 兜底以避免白屏，这是明确接受的残余风险。

**E-5 缓存原型污染** — `main.js:1430`
`wordCache[userInput]` 可写 `__proto__`，且 `Object.keys` 看不到，落盘后跨会话污染。已改为 `cacheGet/cacheSet` + 保留键拒绝；`constructor`/`prototype` 同样覆盖。

**E-6 窗口状态** — `main.js:340-360`
`{x,y}` 缺 width/height 时 `Math.max(900, undefined)=NaN`，BrowserWindow 抛错，托盘还没创建 → 进程无窗口。已对四个字段做 `Number.isFinite` 校验、宽高 clamp 到 900~10000 / 600~10000，任一缺失整体丢弃。

**E-7 设置损坏** — `main.js:150-185`
解析失败直接回落默认值，第一次保存就覆盖原文件。已改为先把损坏文件重命名为 `.corrupt-<ts>` 并记日志；保存前保留一份 `.bak`。

**E-10/E-11/E-12** — 对象下标改 `hasOwnProperty`；stats 取整并夹取（words 0~1e6、goal 1~10000、streak 0~1e5）；快捷键改为「先注册新键，成功再注销旧键」，失败返回 `shortcutError` 且旧键继续可用。

**E-8 同步 IO（备份已修，词库待下沉）** — `main.js:496-590`、`1160-1210`
备份整目录 `copyTreeSync`、词库 32MB `JSON.parse(readFileSync)` 都在主进程事件循环上。备份已改为 `copyTreeAsync`：全 `fs.promises`、每 64 个条目 `setImmediate` 让出事件循环、先写 `*.partial` 完成后原子改名，修剪只认完整目录（孤儿 `.partial` 超过一天清理）。词库解析仍待按 §7.1 移到 `utilityProcess`。

## 3. 构建 / 依赖 / 配置 / CI

**B-1/B-2（P0）**：`@electron/asar@4.3.1` 的 `engines.node` 是 `>=22.12.0`，`asar.mjs` 顶部硬校验；仓库 `engines` 是 `>=18 <23`、`.nvmrc=20`、Docker `node:20`、CI Node 20。结果是 `npm run release` 在 asar 步骤必失败，桌面 CI 两个 job 也必失败。已统一到 Node 22（engines `>=22.12 <23`、`.nvmrc=22`、Docker `node:22-bookworm-slim`、全部 workflow `node-version: 22`），预检脚本与安装脚本同步。

**B-3**：`playwright.config.ts:13` 的正则被 `//` 注释吞掉，守卫恒真。已改为 `new URL()` 解析 + 环回主机判断；`playwright.config.ts` 纳入 `tsconfig.node.json`，新增 `typecheck:node` 并进 `test:quality`。

**B-4**：`shell.mjs` 的 Electron zip 只校验 content-length。已改为下载/复用前读官方 `SHASUMS256.txt`（缓存）、校验 SHA256，失败删除并重下；离线可用 `QZ_ELECTRON_SHA256`，显式 `QZ_SKIP_ELECTRON_VERIFY=1` 才跳过。

**B-5**：`ErrorBook/DropdownExport.tsx` 静态 `import * as XLSX`，所有用户首屏付 429KB。已改为点击导出时 `await import('xlsx')`；`chunkSizeWarningLimit` 从 1024 回落到 600，避免继续掩盖体积回归。

**B-6**：`vite.config.ts:75` 的 `drop:['console','debugger']` 会连 `console.error` 一起删。已改为 `drop:['debugger']` + `pure:['console.log','console.debug','console.info']`，保留 warn/error。根因是「用 console 作为唯一错误出口，又在构建时把它删掉」。

**B-7**：`tsconfig target es5` + `react-app-polyfill` + Vite 默认 es2020。已统一 es2020，移除 polyfill import 与依赖，显式 `build.target:'es2020'`。桌面 Electron 43 与近两年浏览器均满足。

**B-8**：新增 `.dockerignore`；Docker `npm ci --ignore-scripts` + `HUSKY=0`，不再依赖 `.git` 恰好被复制。

**B-9**：`classnames` 8 处全部迁移到 `cn()`，删除该依赖；删除 `@types/gtag.js`、`@types/echarts`、`@types/react-router-dom`、`react-app-polyfill`；`typescript` 从 dependencies 移到 devDependencies。
`@svgr/core`/`@svgr/plugin-jsx` 曾按「零引用」删除，但 `unplugin-icons` 的 JSX 编译在构建期会 `require` 它们，删掉后 `npm run build` 直接失败——已恢复并在注释里说明「不是运行时依赖，但不能删」。这是一次**静态引用扫描的假阴性**，也说明依赖清理必须以真实构建为准。

**B-12 依赖安全公告**（`npm audit --omit=dev`）：react-router 6.11 的开放重定向（high）已升到 6.30.6；echarts 5.x 仍有 moderate XSS 公告（6.x 修复但属大版本，需图表回归后再升）；xlsx 0.18.5 的 prototype pollution/ReDoS 在 npm 上无修复版（SheetJS 已转 CDN 分发），当前仅用于**导出**、不解析用户文件，风险收敛为「导出数据可控时无影响」，后续用 `exceljs` 或官方 CDN 包替换；braces/minimatch/picomatch 等 high 均在构建链（dev），不进运行时产物。

**B-10**：`release.mjs` 每个安装目录各备份一份（带 index 后缀），回滚逐个写回并复核哈希；回滚失败写 `logs/partial-rollback-*.json` 并置退出码 3。

**B-11**：asar 先打到 staging 外的临时文件再移入，避免把上一次的 `app.asar` 打进新包。

**仍未处理**：根 `package.json` 的 `version: 0.1.0` 是上游网页版版本，不参与发布；Electron 版本仍是 `shell.mjs` 常量。建议写入 `local-fork/package.json` 的 `config.electronVersion` 并由 `package.mjs` 断言 shell-info 一致（§7.5）。

## 4. 代码风格与规范

- 图标统一：58 处 `~icons/*` 全部改为 tabler；`✨/★/☆/🔊/✕` 全部替换为 SVG（词卡、剪贴板窗、通知标题）。`classnames` 全部并入 `cn()`。
- 格式：`prettier --check` 覆盖 `src`、`scripts`、workflow、`package.json`；NSIS 模板因必须带 BOM 单独忽略并说明原因。
- 命名：新增 `sessionEpoch`、`backupRunning`、`roleOf`、`cacheGet/cacheSet` 等语义化命名；注释只写「为什么」，不写「做了什么」。
- 需要继续收敛：`main.js` 2638 行仍是单文件，`enhance.js` 1677 行；建议按 `ipc/`、`window/`、`services/` 拆分（§7.6），本轮不做大搬迁以免引入回归。

## 5. 验证记录

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` / `test:quality` | 通过（含新增 `typecheck:node`） |
| `npm run test:core` | 309/309 |
| `npm run test:stats` / `test:fuzz` / `test:dict` | 通过（17 / 3×800 / 45） |
| `npm run test:all`（含浮层 42 项 + 复习持久化 30 项） | 通过（221 项） |
| 桌面冒烟（自建外壳） | 13/13 |
| 桌面视觉（Windows） | 5/5（基线已随图标/文案更新并复跑 0 差异） |
| 安装器 | 静默安装 → 体检 477 条目 → 冒烟 13/13 → 卸载清理 |
| 图标 | ICO 7 档 / ICNS 7 档 / 11 档 PNG，逐字节校验 |
| 依赖安全 | react-router 升 6.30.6（修 open redirect）；echarts 5.6 仍有 moderate 公告（升 6 需图表回归）；xlsx 仅导出用途并列入替换计划 |

> Windows 桌面视觉基线已重建并复跑（差异 0.000%）；Linux 基线由 CI 首次运行生成后，用 `test:desktop-visual:apply` 落地。

## 6. TypeWords 借鉴（全盘源码，非 README 摘要）

参考仓库：`zyronon/TypeWords`（Nuxt 3 + Vue 3 + Pinia + UnoCSS + ts-fsrs）。读了 `app/core/{stores,composables,hooks,utils}`、`app/components/{word,list,import,setting}`、`app/pages`，不是只看功能列表。

### 6.1 值得直接借鉴（按收益/成本排序）

1. **FSRS 调度器（`app/core/hooks/fsrs.ts`）**
   用 `ts-fsrs` 的 `Card/Grade/Rating` 替代手写艾宾浩斯阶梯；`getGradeByWrongTimes` 把错误次数映射到 Again/Hard/Good/Easy，`fsrs.next(card, now, grade)` 统一处理间隔、难度、遗忘。收益：调度可解释、可调参、有成熟边界处理；成本：需要一次 `memoryRecords` 迁移（stage/interval/ease → Card），并保留旧字段只读兼容。建议先做「影子模式」：FSRS 只计算 `shadowDue`，不影响实际 due，跑一周对比再切换（我们的 `shadowInterval` 已有影子字段，可复用）。

2. **紧凑持久化（`usePracticePersistence.ts:serializePracticeWordCache`）**
   只存 `taskWordsStr` / `wordsStr` / `wrongWordsStr`（单词名），读取时用当前词库 Map 还原完整对象；同时把 `statStoreData` 与练习数据分开。直接解决我们 F-7「每次翻词序列化整份词表」。落地：`reviewInfoAtom` 拆成 `reviewSessionAtom`（词表，写入一次） + `reviewIndexAtom`（小对象，每次翻词只写 index），或照它存 `{words: string[], index}` 并在读取时从当前词库补全。

3. **计时片段 + 暂停原因（`app/core/stores/practice.ts`）**
   `segments: [start,end][]` + `pauseTimer(reason: manual|auto_visibility|auto_idle)`，切标签/空闲自动暂停，跨天时长能正确拆分。我们的计时是 `setInterval +1s`，切后台仍计时，统计会虚高。落地：在 `timerData` 增加 `segments` 与 `pauseReason`，统计页按片段汇总；这是数据口径修复，不是 UI 功能。

4. **输入动作抽象（`usePracticeWordTyping.ts` + `visible-word-typing.ts`）**
   把键盘/DOM input 统一成 `{key, code}` 动作（Backspace/Space/字符），状态机只处理动作；`inputLock`、重复练习、错误清空、自动下一词都在同一层。可直接修 F-9（code 首字符）与 IME 边界；我们的 `KeyEventHandler` / `TextAreaHandler` 两套事件模型应收敛到 `applyInputAction(action)`。

5. **虚拟列表（`app/components/list/BaseList.vue`）**
   `list.length > 200` 时用 `DynamicScroller`，否则普通滚动；`scrollToItem` 统一两种模式。适合我们的错题本（数万条）、词库画廊（385 本）、词卡例句列表。落地：React 侧用 `@tanstack/react-virtual`（已在 vendor-ui 分组里，需显式加依赖）或轻量自写窗口化；先用在错题本。

6. **版本化备份信封（`BackupData` + `useDataSyncPersistence`）**
   每个 section 带 `version`，读取时 `checkAndUpgradeSaveSetting/SaveDict` 迁移；远端同步按 `updated_at` 比较后 pull/push，冲突有明确策略。我们已有 `release-info` 与导入校验，但备份没有 section 版本。落地：`data.json` 增加 `schemaVersion` 与每表 `version`，导入时按版本迁移，未知高版本拒绝而不是「尽力导入」。

7. **学习任务生成与「认识/不认识/已掌握」标记（`study-task.ts`、`WordMarkPickList.vue`）**
   `createStudyTask` 先取到期复习，没有到期时按 `wordReviewRatio` 从已学词里随机补复习；`addRandomReviewWhenNoDue` 用排除集避免与新词重复。`WordMarkPickList` 支持批量标记「我认识/不认识/已掌握」，已掌握词进入忽略集合，后续跳过。我们的 `MIX_WINDOW` 只做「掺入上级词」，没有「用户主动标记已掌握」；可借鉴为轻量「标记已掌握」入口，直接减少无效复习。

8. **练习阶段流水线（`WordPracticeModeStageMap`）**
   跟写→听写→默写→识别，按模式组合成阶段；每阶段有明确完成条件。我们目前是「模式开关 + 随机出词」，可借鉴为可选的「智能模式」：新词跟写 → 当日听写 → 次日默写，阶段状态存 memoryRecords，不改变现有自由练习。

9. **单词元信息面板（`WordMetaPanel.vue` / `TranslationList.vue`）**
   音标、英美音、例句、短语、同义词、词根、词源分区展示，信息架构清晰。我们的词卡已有中文/英文释义、例句、同义词，可补「短语/词根」区块，但需要数据源；先做 UI 分区与空态，不引入新 API。

### 6.2 不建议照搬

- **Nuxt/Vue/Pinia 技术栈**：重写成本远大于收益；我们只借模式，不借框架。
- **Supabase 云同步默认开启**：与「本地优先、遥测默认关闭」的定位冲突；可保留「可选自建 Supabase」方案，但不作为默认。
- **结果页 emoji 鼓励文案**：与本次「去 emoji、统一线性图标」的方向相反。
- **14 种语言的 i18n**：维护成本高；先把中英文案与术语统一，再按需扩展。
- **vxe-table / UnoCSS / 多套 iconify 集合**：我们已统一 Tailwind + tabler，引入会增加体积与风格分裂。

### 6.3 落地顺序（建议）

1. 修 F-7（复习进度拆存储）+ F-9（输入动作层）——直接消除卡顿与首字符丢失，风险低。
2. 错题本窗口化 + 聚合表（F-8 的根因）——解决数万条记录的白屏。
3. FSRS 影子模式运行两周，再决定是否切换主调度。
4. 计时片段与统计口径统一（会改变历史统计的解释，需要发布说明）。
5. 备份 section 版本 + 可选云同步（默认关闭）。

## 7. 架构级方案（从根源解决，不逐处打补丁）

### 7.1 主进程同步 IO 下沉

**根因**：备份/词库/日志都直接跑在 Electron 主进程事件循环上；`copyTreeSync` 与 `JSON.parse(readFileSync(32MB))` 会阻塞窗口消息泵。
**方案**：
1. 备份复制改为 `fs.promises` 版 `copyTree`，每个目录/每 N 个文件 `await new Promise(setImmediate)`；先写到 `backup-*.partial`，完成后原子改名，修剪只认完整目录。
2. 词库解析移到 `utilityProcess`（Electron 43 支持）或 `worker_threads`；主进程只保留「请求-响应 + LRU 缓存」，`readDictContent` 不再同步 parse。
3. 日志改内存队列 + 2 秒批量 `fs.promises.appendFile`；`injectEnhance` 的 CSS/JS 在启动时读一次缓存。
**验收**：备份 300MB 用户数据期间，主窗口 `requestAnimationFrame` 间隔 <50ms；查询 8MB 词库时 IPC 往返 <100ms。

### 7.2 复习进度存储拆分

**根因**：`reviewInfoAtom` 把词表与大对象放进同一个 `atomWithStorage`，每次翻词都全量序列化。
**方案**（v11.6 已落地，见 F-7）：`reviewModeInfo:session` 存会话（词表/词库/创建时间/结束标记，开始与结束时各写一次）+ `reviewModeInfo:index` 存下标（每次翻词 ≈30B）；旧键在模块加载时迁移一次后删除。拆分/合并/迁移是纯函数（`src/store/reviewPersistence.ts`），由 `npm run test:review-persist` 30 项断言守护。
**验收**：1000 词复习会话，翻词时 localStorage 写入 <1KB；配额满时只丢 index（可重来），不丢词表。已达成（翻词只写 `index`）。

### 7.3 错题本聚合与自动进阶

**根因**：错题本每次全量读 `wordRecords` 再内存分组；自动进阶用 `currentDictId` 过滤级别词库 id。
**方案**：
1. 新增物化表 `wrongWordAggregate: 'word,dict,[dict+word]'`，字段 `wrongCount,lastAt,recordIds`；`saveWordRecord` 在同一事务里增量维护，删除/导入时重建。
2. 错题本按 `wrongCount` 倒序分页查询聚合表，详情再按 `[word+dict]` 取原始记录；列表用窗口化渲染。
3. 错题复习不再依赖 `currentDictId`：按聚合表里实际出现的 dict 分组，逐组加载词库；缺失时用 `memoryRecords` 的 trans/phone 构造 Word。
**验收**：5 万条记录打开错题本 <500ms；自动进阶用户点「错题回顾」能进入复习而不是弹「当前词典没有错题」。
**进度**：第 3 条已落地（F-8，按实际 dict 分组 + 记忆记录兜底）；第 1、2 条（聚合表 + 虚拟列表）仍是计划——当前只查 `wrongCount > 0` 且 `[word+dict]` 已有索引，几万条以内可用，再往上需要物化表。

### 7.4 跨 IndexedDB 导入

**根因**：RecordDB 与 QwertyPlusDB 是两个数据库，浏览器不提供跨库事务。
**方案**：导入前把两份数据都写到 `*.importing` 临时库并校验行数/主键；校验通过后按「QwertyPlusDB → RecordDB」顺序切换（先写小库，失败可重试），并写 `importJournal` 记录阶段；下次启动若发现未完成 journal，提示「上次导入未完成，是否继续/回滚」。这是「可恢复」而不是「假装原子」。
**验收**：构造第二段写入失败，重启后能明确提示并回到旧数据或继续完成，不出现半新半旧。

### 7.5 版本单一来源

**根因**：根 `package.json` 0.1.0、`local-fork/package.json` 应用版本、`shell.mjs` Electron 常量、安装器 DisplayVersion 四处各自为政。
**方案**：`local-fork/package.json` 增加 `config.electronVersion` 与 `config.appVersion`；`shell.mjs`/`package.mjs` 只读它；`shell-info.json` 记录后由 `package.mjs` 断言一致；根 `package.json` 的 version 改为 `0.0.0-private` 并注明「上游网页版占位，不参与发布」。
**验收**：`npm run shell && npm run package` 后，`shell-info.json`、exe FileVersion、安装器 DisplayVersion、界面版本四处一致。

### 7.6 main.js 拆分

**根因**：2638 行单文件，IPC、窗口、备份、词库、缓存混在一起，任何改动都可能碰全局状态。
**方案**：按依赖方向拆 `electron/ipc/{settings,dict,backup,window}.js`、`electron/services/{backup,dict-cache,log}.js`、`electron/windows/{main,clipboard}.js`；共享状态收敛到 `electron/state.js`（显式 getter/setter），禁止模块间互相 require 具体实现。
**验收**：`main.js` <300 行；每个 service 可在 Node 里单独 import 测试；现有 13 项冒烟与 221 条检查不变。

## 8. 剩余风险（明确边界）

| 风险 | 说明 | 建议 |
| --- | --- | --- |
| 主进程同步 IO | 备份已异步化；词库 `JSON.parse(readFileSync)` 仍可能卡 UI 数百毫秒（大词库） | 按 §7.1 把词库解析移到 `utilityProcess` |
| 错题本全量内存 | 数万条记录一次 `toArray` + 内存分页（已按 `wrongCount` 过滤并有 `[word+dict]` 索引） | §7.3 聚合表 + 虚拟列表 |
| 跨 DB 导入 | RecordDB 与 QwertyPlusDB 无法同一事务 | 先写 RecordDB，再写自定义词库；失败时提示「部分导入」并保留备份，后续做导入日志 |
| CSP 兜底 | hash 解析失败仍回退 `unsafe-inline` | 改为构建期生成 hash 清单，运行时只读清单；失败则拒绝内联脚本 |
| 安装器未签名 | SmartScreen 提示 | 购买代码签名证书后接入 signtool |
| Linux 实机 | 只在 CI（xvfb）验证 | 在 Ubuntu 22.04/24.04 实机跑一次冒烟与视觉 |
| Electron 43 EOL | 2027-01-05 | 到期前升级 44+，品牌化已自动化 |

## 9. 复核方法（可重复）

```bash
npm run typecheck && npm run typecheck:node && npm run lint:strict
npm run test:all                       # 221 项，含浮层 42 项 + 复习持久化 30 项
QZ_TEST_APP_DIR=release/shell-win32-x64 npm run test:desktop-smoke
QZ_TEST_APP_DIR=release/shell-win32-x64 npm run test:desktop-visual
npm run package                        # 安装器全流程
npm run test:icons && npm run test:format
```

