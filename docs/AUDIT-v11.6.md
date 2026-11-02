# v11.6.0 全栈审查（根因版）

- 审查对象：`qwerty-src`（React 18 + Vite + TS 前端，Electron 43 外壳，IndexedDB 本地库）
- 审查时点：2026-11-02，对应 `v11.6.0`（`c505413`）；`v11.6.1` 为增量（统计聚合拆分 + 计时可见性修复 + 补齐 TypeWords 全量盘点）；`v11.6.2` 落地两条 TypeWords 借鉴（输入判定纯函数化 + 备份 schemaVersion）
- 方法：逐目录读代码 → 对高风险路径做反证（读失败、脏备份、并发备份、异常窗口状态、超大词表）→ 用自动化断言固化结论
- 结构：先给**覆盖矩阵**与**问题总表**（位置/影响/级别/状态），再按模块逐条给根因与修复；数据库、接口单独成章；最后是与 TypeWords 的源码级对照与架构级方案

> 术语说明：本项目**没有服务端**。「后端」指 Electron 主进程（`local-fork/electron/main.js`）、preload 桥、页面内浮层运行时与本地文件/网络出口；「数据库」指浏览器 IndexedDB（Dexie `RecordDB`、增强面板的 `QwertyPlusDB`）；「接口」指 IPC 通道与事件通道。

## 0.1 本轮改进方向（v11.6.1 增量）

上一版报告留了三个薄弱点，这一轮针对性补：

1. **性能结论从形容词变成实测数字**：把统计聚合抽成纯函数 `wordStatsAggregate.ts`，新增 `npm run test:word-stats`——23 项口径/脏数据断言，外加与「上一版实现」「v11.6 之前的数组展开实现」的同数据对照（同日 1 万条 629.1ms → 28.6ms）。
2. **计时语义补一半**：发现窗口最小化/切走时仍每秒累加学习时间（F-11），已改为不可见不累计；完整「暂停原因 + 计时片段」模型列为下一步（§9.2）。
3. **TypeWords 从「读过几个文件」变成全量盘点**：213 个文件按 9 个分区清点，逐条标「已采纳 / 值得做 / 不采纳」，并补上两条此前漏掉的候选（计时片段、空闲暂停）与两条不采纳理由（`event.code`、`word-test`）。
4. **两条借鉴真正落地（v11.6.2）**：
   - 技术实现：按 `visible-word-typing.ts` 的思路，把「键是否算对 / 判到哪一位 / 错在哪」抽成纯函数 `inputJudgement.ts`，Word 组件只负责写状态与音效；两条输入通道共用同一判定。新增 `test:input-judge` 27 项，含与重构前实现的 2000 组随机对拍。
   - 数据健壮性：按 `export.ts` 的分域版本思路，备份快照写入 `schemaVersion`，导入时拒绝更新版本的备份；新增 `test:schema-sync` 6 项静态校验，防止常量与 Dexie 版本漂移。

## 0.2 覆盖矩阵

| 层 | 范围 | 规模 | 对应章节 | 结论 |
| --- | --- | --- | --- | --- |
| 前端·练习主链路 | `src/pages/Typing` | 59 文件 / 6783 行 | §2.1 | 2 个 P1（结算竞态、落库静默）+ 1 个 P2（code 首字符）已修 |
| 前端·统计 | `src/pages/Analysis` | 6 / 1153 | §2.2 | O(n²) 已改单次累加；NaN/Infinity 不进图表 |
| 前端·错题本 | `src/pages/ErrorBook` | 14 / 1055 | §2.3 | 自动进阶下「永远没有错题」已修，并有离线兜底 |
| 前端·词库画廊 | `src/pages/Gallery-N` | 8 / 698 | §2.3 | 复习会话创建路径纳入 F-7 双键存储 |
| 前端·状态与工具 | `src/store`、`src/utils`、`src/hooks` | 46 / 5905 | §2.4 | 记忆聚合缓存、复习持久化拆分、错误态语义 |
| 前端·通用组件 | `src/components` | 15 / 680 | §7 | 图标家族/emoji/className 工具统一 |
| 后端·主进程 | `local-fork/electron/main.js` | 2833 行 | §3 | 备份重入/退出截断/IPC 越权/导航/缓存污染/窗口状态等 13 项已修，E-8 部分（备份已异步、词库解析待下沉） |
| 后端·桥与浮层 | `preload.js`、`preload-clipboard.js`、`enhance/*` | 194 + 1694 行 | §3.4 | 事件可退订；浮层导入事务化；42 项行为用例 |
| 数据库 | `src/utils/db/*`、`enhance.js` 的 IDB 段 | 9 个文件 | §4 | schema 链条目清理；导入 staging + 单事务；配额与多标签页边界明确 |
| 接口 | 43 个 `ipcMain.handle` + 事件通道 | — | §5 | 按窗口角色收敛；参数校验矩阵见 §5.2 |
| 功能完整性 | 上游全部功能 + 本分支新增（首启选档、自动进阶、记忆曲线、错题重练、桌面设置） | 14 组 | §8.1 | 逐项有对应验证手段，未发现功能被静默删除 |
| 配置/构建/依赖/CI | `package.json`、`tsconfig*`、`vite.config.ts`、`Dockerfile`、`.github/workflows/*`、`scripts/*` | 26 个脚本 | §6 | 1 个 P0（Node 与 asar 不匹配）已修；依赖安全余项见 §11 |

## 1. 问题总表（位置 / 影响 / 级别）

> 「位置」用 `文件:函数或行段`，行号会随重构漂移，函数名是稳定锚点。级别：P0 阻断发布、P1 数据或高频功能受损、P2 特定场景可感知、P3 整洁性。

| ID | 模块 | 位置 | 问题 → 影响 | 级别 | 状态 |
| --- | --- | --- | --- | --- | --- |
| B-1 | 构建 | `package.json:engines`、`.nvmrc`、`Dockerfile`、`.github/workflows/*.yml`、`scripts/pre-check.*` | `@electron/asar@4` 要求 Node ≥22.12，仓库仍 18~20 → `npm run release` 必失败、桌面 CI 三个 job 必红 | P0 | 已修 |
| B-2 | CI | `.github/workflows/{desktop,e2e,deploy-pages}.yml` | Node 20 + `actions/*@v3`（已停用）→ 工作流无法运行 | P0 | 已修 |
| B-3 | 构建 | `playwright.config.ts:localBaseUrlOf` | 正则被 `//` 注释吞掉，守卫恒真 → 任何 `QZ_E2E_BASE_URL` 都会拉起 dev server | P1 | 已修 |
| B-4 | 发布 | `scripts/shell.mjs:expectedSha` | Electron 发行包零校验、坏包被永久复用 → 供应链风险与「莫名的启动失败」 | P1 | 已修 |
| B-5 | 构建 | `tsconfig.json:target`、`src/index.tsx`、`vite.config.ts` | 类型检查 es5、产物 es2020、polyfill 三套基线矛盾 → 白装 100KB+ 且行为不一致 | P2 | 已修 |
| B-6 | 构建 | `vite.config.ts:esbuild` | 生产 `drop:['console']` 连 `console.error` 一起删 → 错误分支彻底静默 | P1 | 已修 |
| B-7 | 构建 | `Dockerfile`、`.dockerignore` | 无 `.dockerignore`，`COPY . .` 把 node_modules/release/.git 带进镜像 | P2 | 已修 |
| B-8 | 依赖 | `package.json` | `classnames`+`clsx`+`tailwind-merge` 三套并存；6 个死依赖；`typescript` 在 dependencies | P2 | 已修 |
| B-9 | 发布 | `scripts/release.mjs:installToDirs` | 多目录安装只备份第一份，回滚失败仅 warn → 可能留下版本混用且无记录 | P1 | 已修 |
| B-10 | 发布 | `scripts/release.mjs:packAsar` | asar 直接输出到被扫描的 staging 目录 → 重跑可能把上一次的 asar 打进包（体积翻倍） | P2 | 已修 |
| B-11 | 发布 | `scripts/package.mjs:writeSums` | 同版本分平台打包时校验和文件互相覆盖 → 先出的产物失去校验和 | P2 | 已修 |
| B-12 | 仓库 | `.gitattributes` | 只有 `*.ico binary`，缺 `*.icns` → `* text eol=lf` 会把 icns 当文本转换，**图标文件被改坏** | P1 | 已修 |
| B-13 | 依赖安全 | `package.json:dependencies` | react-router 6.11 开放重定向（high）；echarts 5.6 moderate；xlsx 0.18.5 无修复版 | P1/P2 | 部分修（见 §11） |
| F-1 | 前端/统计 | `hooks/useWordStats.ts:getChapterStats`、`hooks/wordStatsAggregate.ts:aggregateWordRecords` | 日桶用 `[...arr, x]` 累加（O(n²)）；错误键再 `flatMap` 展开成与错误次数等长的数组。同日 1 万条实测 629ms | P1 | 已修（v11.6.0 修日桶；v11.6.1 去掉展开，28.6ms） |
| F-2 | 前端/出词 | `src/utils/memory.ts:canonicalizeMemoryRecords`、`src/utils/autoLevel.ts:buildBestRecordMap`、`src/utils/memoryCache.ts` | 每次换词 4~6 次全表遍历且无缓存 → 2 万条记忆记录时可感知卡顿 | P1 | 已修 |
| F-3 | 前端/结算 | `src/pages/Typing/store/index.ts:104-235`、`Word/useAttemptSettlement.ts` | 重置章节先把统计清零、旧词结算后到 → 旧增量落到新章节同下标的另一个词 | P1 | 已修 |
| F-4 | 前端/落库 | `Word/useAttemptSettlement.ts:settle`、`src/pages/Typing/hooks/useSaveRecord.ts` | `persisted` 写在 await 之前、失败只 `console.error`，SRS 继续推进 → 错题本与复习进度不一致且不可重试 | P1 | 已修 |
| F-5 | 前端/数据 | `src/utils/memory.ts:getMemoryRecords`、`hooks/useWordList.ts`、`pages/Typing/index.tsx` | DB 读失败返回 `[]` → UI 显示「词库已全部学完」，用户以为进度被清空 | P1 | 已修 |
| F-6 | 数据库 | `src/utils/db/index.ts:version(5)` | `reviewRecords` 死表、`[dict+chapter]` 死索引、缺 `[word+dict]` → 删除确认退化为全表扫描 | P2 | 已修 |
| F-7 | 前端/复习 | `src/store/reviewInfoAtom.ts`、`src/store/reviewPersistence.ts` | 整份词表与下标同键，每次翻词全量 `JSON.stringify` + 同步写盘 → 大词表卡顿，配额满时连进度都写不进去 | P2 | 已修 |
| F-8 | 前端/错题 | `src/pages/ErrorBook/index.tsx:startWrongReview` | 用 `currentDictId` 过滤历史错题 → 自动进阶下永远提示「当前词典还没有错题」 | P1 | 已修 |
| F-9 | 前端/输入 | `pages/Typing/index.tsx:142-192`、`TextAreaHandler/index.tsx`、`Word/inputJudgement.ts` | 「开始/继续」重放合成 keydown，code 词库走 textarea input → 首字符丢失 | P2 | 已修（重放兜住 + 判定抽纯函数，见 §2.1） |
| F-10 | 后端/导入 | `local-fork/electron/enhance/enhance.js:importAll` | 逐表 clear+put、非法行静默丢弃 → 中途失败留下半新半旧数据 | P1 | 已修 |
| F-11 | 前端/计时 | `src/pages/Typing/index.tsx:248-260`（`setInterval` + `TICK_TIMER`） | 窗口不可见（最小化/切走/锁屏）仍每秒累加 `timerData.time` → WPM、结果页用时、章节时长都会被「挂着一下午」稀释 | P2 | 已修（`document.hidden` 时跳过 tick） |
| F-12 | 前端/统计 | `hooks/wordStatsAggregate.ts:aggregateWordRecords` | 错误键先展开成数组再计数 → 与错误次数等长的内存峰值，5 万条记录时可达数百万字符串 | P2 | 已修（Map 直接合并） |
| E-1 | 后端/备份 | `main.js:runBackup` | 定时器/托盘/面板/导入前备份可并发；目录名只到秒；修剪按 mtime 删「正在写」的目录 | P1 | 已修 |
| E-2 | 后端/退出 | `main.js:will-quit`、`app:relaunch`、`saveCachesNow` | `app.exit(0)` 硬退，不等备份与缓存落盘 → 退出瞬间丢最近设置/备份 | P1 | 已修 |
| E-3 | 后端/安全 | `main.js:handle`、`roleOf`、`CLIPBOARD_CHANNELS` | 剪贴板小窗与主窗口共享 43 个通道 → 展示远端内容的窗口具备全部主进程能力 | P2 | 已修 |
| E-4 | 后端/安全 | `main.js:hardenWebContents`、`cspFor` | 导航放行 app 目录内任意 HTML；CSP 只覆盖一个路径、`frame-src` 未收 | P2 | 已修 |
| E-5 | 后端/安全 | `main.js:cacheGet/cacheSet` | 查词缓存用普通对象 + 用户输入做键 → `__proto__` 可污染原型，且跨会话落盘 | P2 | 已修 |
| E-6 | 后端/稳定 | `main.js:loadWindowState`、`isVisibleOnSomeDisplay` | 状态文件缺字段 → `Math.max(900, undefined)=NaN` → BrowserWindow 抛错，进程无窗口 | P1 | 已修 |
| E-7 | 后端/稳定 | `main.js:loadSettings`、`saveSettings` | 设置损坏静默回落默认值，第一次保存即覆盖原文件 → 用户偏好全丢且无从恢复 | P2 | 已修 |
| E-8 | 后端/性能 | `main.js:copyTreeAsync`（已修）、`readDictContent`（未修） | 备份/词库解析跑在主进程事件循环 → 大目录备份期间窗口无响应 | P1 | 备份已修；解析待下沉 |
| E-9 | 后端/隐私 | `main.js:startClipboardWatch`、`downloadDictUpdate` | 每 1.2s 全量 `readText`（含图片/富文本）；同文件并发下载互相覆盖 `.part` | P2 | 已修 |
| E-10 | 后端/接口 | `main.js:localDictPath`、字典 id 查表 | 用对象下标命中 `__proto__`/`constructor` → 读到非预期路径/对象 | P2 | 已修 |
| E-11 | 后端/接口 | `main.js:stats:update` | 统计字段不取整/不夹取 → `Infinity` 进设置与托盘显示 | P2 | 已修 |
| E-12 | 后端/稳定 | `main.js:registerShortcuts`、`updateSettings` | 先全注销再注册，新键被占用时两个都失效且无提示 | P2 | 已修 |
| E-13 | 后端/桥 | `preload.js:onClipboardWord`、`onBackupRequest`、`enhance.js` | 事件订阅无法退订（重复挂载会叠加）；主窗口仍暴露无消费方的 `onClipboardWord` | P3 | 已修 |
| E-14 | 后端/隐私 | `main.js:publicSettings` | 向渲染端下发 `plusDir/userDataDir/exportsDir` 绝对路径（无消费方） | P3 | 已修 |

**级别分布**：共 39 条 —— P0 2、P1 16、P2 18、P3 2，另有 B-13（依赖安全）跨 P1/P2 仍部分开放；其余全部关闭。

## 2. 前端

### 2.1 练习主链路（`src/pages/Typing`）

**F-3 结算竞态** — `store/index.ts:104-235`、`Word/useAttemptSettlement.ts`
`REPEAT_CHAPTER / NEXT_CHAPTER / SETUP_CHAPTER` 先 `structuredClone(initialState)` 清零统计，Word 的 `[word]` effect 随后才用旧 meta 结算。根因是**生产者先重置、消费者后结算**。修复：状态加 `sessionEpoch`，重置时 +1；`REPORT_WORD_RESULT` 携带创建时的 epoch，reducer `break` 掉过期增量。影响面：只有「章节重置与上一词结算同帧」时才出错，但一旦发生就是统计与错题记到别的词上，属静默数据错误。

**F-4 落库失败静默** — `Word/useAttemptSettlement.ts:settle`、`hooks/useSaveRecord.ts`
`meta.persisted = true` 在 `await` 之前，失败只 `console.error`（生产构建还会被剥离）；`wordRecords` 失败但 `updateMemoryProgress` 继续。根因是**把「发起写」当成「写成」**，且两个写操作没有一致性约束。修复：词记录失败即抛；记忆曲线失败回滚词记录；`persisted` 失败复位、下次 settle 可重试。

**F-5 读失败伪装空库** — `utils/memory.ts:getMemoryRecords`、`hooks/useWordList.ts`、`pages/Typing/index.tsx`
DB 打不开（配额满/被其它标签页阻塞/隐私模式）时返回 `[]`，UI 落到「词库已全部学完」。根因是**用空数组表达错误**。修复：抛错 → `useWordList` 维护 `error` → 练习页显示「本地学习数据读取失败（数据仍在，不代表清空）」并提示先导出备份。

**F-9 code 词库首字符丢失** — `pages/Typing/index.tsx:142-192`、`TextAreaHandler/index.tsx`
开始/继续时缓存按键并用合成 `KeyboardEvent` 重放；code 模式走 textarea 的 `input` 事件，合成 keydown 不产生默认输入。已修两层：① 焦点在 textarea 时写入值并派发 `InputEvent('input',{data})`（重放处兜住）；② v11.6.2 把判定抽成 `judgeInput` / `describeMistake`（`Word/inputJudgement.ts`），Word 组件只保留「守卫 → 写状态 / 播音效」，keydown 与 textarea 两条通道共用同一判定。`test:input-judge` 27 项，其中 2000 组随机输入与重构前实现逐字段一致。

**F-11 后台仍在计时（v11.6.1）** — `pages/Typing/index.tsx:248-260`
`setInterval` 只看 `state.isTyping`，不看窗口是否可见。桌面上把窗口最小化/切走几小时，`timerData.time` 照样每秒 +1，直接污染三处展示：结果页「用时」、WPM、分享图。根因是**计时器以「会话开始」为唯一条件，没有可见性/空闲状态**。最小修复：`document.hidden` 时跳过 tick（时间只累计可见秒数）。完整方案（暂停原因 + 计时片段）见 §9.2。

### 2.2 统计（`src/pages/Analysis`）

**F-1 聚合 O(n²) + 错误键展开** — `hooks/useWordStats.ts:getChapterStats` → `hooks/wordStatsAggregate.ts:aggregateWordRecords`
两处放大：① `bucket.words = [...bucket.words, word]`、`wrongKeys = [...a, ...b]`，同一天记录越多复制越多次；② 错误键先 `flatMap` 展开成「每个错误一个元素」的数组再计数。
修复分两步：v11.6.0 把日桶改成 `Set`/`Map` 就地累加；v11.6.1 再把聚合抽成纯函数，错误键直接用 `Map` 合并，不再展开。
实测（`npm run test:word-stats`，同一批合成数据）：同日 1 万条 `629.1ms → 28.6ms`（22×）；跨 30 天 2 万条 `72.9ms → 54.4ms`（1.3×，错误键展开 4 万个元素 → 0）。口径不变：`totalTime=0` 仍给 0，不产生 `Infinity`。

### 2.3 错题本与复习入口（`src/pages/ErrorBook`、`src/pages/Gallery-N`）

**F-8 自动进阶错题必空** — `ErrorBook/index.tsx:startWrongReview`
`wordRecords.dict` 在自动进阶下是级别词库 id（如 `auto:3`），`currentDictId` 仍是 cet4 → 过滤必空。根因是**用当前选择推断历史数据归属**。修复：按错题实际所属词库分组；优先当前词典，否则取错题最多的；按钮下方显示「当前词典没有错题，将从 X 的 N 个错题开始」；词库请求失败时用 `memoryRecords` 的 `trans/phone` 构造 Word（断网可复习）。

### 2.4 状态与工具（`src/store`、`src/utils`、`src/hooks`）

**F-2 换词重复聚合** — `utils/memory.ts:canonicalizeMemoryRecords`、`utils/autoLevel.ts:buildBestRecordMap`、`utils/memoryCache.ts`
一次换词触发 4~6 次全表遍历。修复：`memoryCache` 增加 `revision`，增删改清都 +1；两个派生结果按「源数组引用 + revision」缓存。注意这是**缓存层**修复，不改任何判定口径。

**F-7 复习进度存储** — `store/reviewInfoAtom.ts`、`store/reviewPersistence.ts`
词表与下标同键，每翻一词全量序列化。修复：`reviewModeInfo:session`（开始/结束各写一次）+ `reviewModeInfo:index`（每词 ≈30B）；旧键在模块加载时迁移一次后删除；拆分/合并/迁移为纯函数，`test:review-persist` 30 项守护（含「仅下标变化必须判为同一会话」这条热路径不变式）。

## 3. 后端（Electron 主进程 / 桥 / 浮层）

### 3.1 备份与退出

**E-1 重入与修剪** — `main.js:runBackup`
定时器、托盘、面板、导入前备份可并发；目录名只到秒；修剪按 mtime 排序后 `slice(7)` 会删掉另一路正在写的目录。修复：`backupRunning` 复用同一次执行、目录名加随机后缀、先写 `*.partial` 完成后原子改名、修剪只认 `^backup-\d{8}-\d{6}-[0-9a-f]{8}$`，孤儿 `.partial` 超过 24h 清理。影响面：备份是唯一兜底，误删/半份备份等于没有兜底。

**E-8 备份同步 IO（已修）/ 词库解析（未修）** — `main.js:copyTreeAsync`、`readDictContent`
`copyTreeSync` 会把主进程事件循环按住几十秒（IndexedDB 的 LevelDB 目录很碎）。已改为全 `fs.promises` + 每 64 个条目 `setImmediate`，并删除不再使用的 `copyTreeSync`。词库 `JSON.parse(readFileSync)` 仍在主线程，方案见 §10.1。

**E-2 退出截断** — `main.js:will-quit`、`app:relaunch`
`app.exit(0)` 硬退。修复：重启走 `saveWindowState → saveSettings → saveCachesNow → 等备份（≤8s）→ relaunch → quit`；`will-quit` 在备份未完成时 `preventDefault`，收尾后再退。

### 3.2 安全边界

**E-3 IPC 按窗口角色收敛** — `main.js:handle/roleOf/CLIPBOARD_CHANNELS`
剪贴板小窗展示远端词典内容，是攻击面最高的渲染进程。修复：只放行 `free:lookup`、`clipboard:close` 两个通道；其余 41 个通道即便 preload 被绕过也拿不到；拒绝时记 `ipc-deny` 日志。

**E-4 导航与 CSP** — `main.js:hardenWebContents`、`cspFor`
导航白名单从「app 目录内任意文件」收到「仅 `build/index.html`（剪贴板窗额外放行其自身 HTML）」，并挂 `will-frame-navigate`；CSP 删除未使用的 mixpanel/vercel 域名，`frame-src 'none'`。

**E-5 缓存原型污染** — `main.js:cacheGet/cacheSet`
`wordCache['__proto__']` 会改掉整个对象的原型，且 `Object.keys`/修剪看不到。修复：保留键拒绝 + `defineProperty` 写入；字典 id 查表改 `hasOwnProperty`（E-10）。

### 3.3 稳定性

**E-6 窗口状态**：缺字段即整体丢弃，尺寸夹取 900×600~10000，坐标必须有限数（否则 `isVisibleOnSomeDisplay` 误判）。
**E-7 设置损坏**：先重命名 `.corrupt-<ts>` 留档，再回落默认值；保存前保留 `.bak`。
**E-11 统计字段**：`clampInt` 取整夹取，`ratio` 夹 0~1，日期必须 `YYYY-MM-DD`。
**E-12 快捷键**：改为「先注册新键，成功再注销旧键」，失败返回 `shortcutError` 且旧键继续可用。

### 3.4 桥与浮层

**E-13 事件订阅** — `preload.js:onClipboardWord/onBackupRequest`：两者都返回 `unsubscribe`；主窗口侧已无 `clipboard:word` 消费方（原先的 toast 已删），但 `onClipboardWord` 仍保留在桥面上——这是为后续「主窗口剪贴板提示」留的入口，属已知的未使用桥面，不构成风险。
**F-10 浮层全量导入** — `enhance.js:importAll`：先对全部表做类型/主键预校验 → 单跨 store 事务 clear+put → 任一失败整体回滚；旧备份缺少的表不再清空；自定义词库同样预校验。跨 IndexedDB（RecordDB / QwertyPlusDB）仍无法一个事务覆盖（§10.4）。

## 4. 数据库

### 4.1 schema 链（`src/utils/db/index.ts`）

| 版本 | 变更 | 说明 |
| --- | --- | --- |
| v1 | `wordRecords`、`chapterRecords` | `errorCount` 时代 |
| v2 | `wordRecords.errorCount → wrongCount` | 字段改名 |
| v3 | `+ reviewRecords` | 复习进度表（v9.9 起零读写） |
| v4 | `+ memoryRecords` | 记忆曲线：`key,word,dict,due,[dict+due]` |
| v5 | 删 `reviewRecords`、删 `[dict+chapter]`、加 `[word+dict]` | 本轮：死表/死索引清理；`deleteConfirm` 的 `where({word,dict})` 才走索引 |

另一处数据库是增强面板的 `QwertyPlusDB`（v3，`dicts` 表），由 `enhance.js:idbOpen` 管理；两库**没有跨库事务**，导入顺序与失败恢复见 §10.4。

### 4.2 查询与索引

- 错题本：`where('wrongCount').above(0).toArray()` → 全表扫描后内存分组。`[word+dict]` 只服务删除确认。数万条以内可接受，再往上需要聚合表（§10.3）。
- 统计：`where('timeStamp').between(a,b)` 走索引，成本在内存聚合（F-1）。
- 记忆记录：`[dict+due]` 服务到期池；`memoryKey` 保留大小写，legacy key 读取时回退（DATA-003 的兼容层）。

### 4.3 边界

- **配额**：写失败只告警不冒泡（`safeStorage`、`db` 写入被 try/catch 包住）；用户可见后果是「本次修改只在内存生效」，不会白屏。
- **多标签页**：Dexie 自身用 IDB 事务串行化；应用层没有跨标签页锁，两个窗口同时练习会各自写记录（数据不丢，统计会重复计入）。
- **导入**：前端导入已是「临时库 staging → 逐表校验行数 → 主库单事务 clear+put → 失败整体回滚」（`data-export.ts:importDatabase`），强杀残留临时库在启动时清理（`temp-import-db.ts`）。
- **备份覆盖**：目录副本含 IndexedDB / Local Storage / Preferences；`data.json` 是逻辑快照（RecordDB 全 store + QwertyPlusDB.dicts + localStorage + 设置）。官方「导出/导入数据库」只含 IndexedDB，文档已注明不要用于跨设备。

## 5. 接口

### 5.1 通道清单（43 个 `ipcMain.handle`）

| 域 | 数量 | 通道 | 校验要点 |
| --- | --- | --- | --- |
| `app:*` | 6 | `getSettings`、`updateSettings`、`notify`、`openPath`、`relaunch`、`quit` | settings patch 字段白名单 + 类型校验；`openPath` 只允许白名单目录；快捷键失败回传 `shortcutError` |
| `win:*` | 7 | `setAutoStart`、`setClipboardWatch`、`setCloseToTray`、`setMini`、`setOpacity`、`setTop`、`setZoom` | 数值夹取；窗口存在性检查；Linux 拒绝自启 |
| `dicts:*` | 8 | `list`、`read`、`checkUpdates`、`downloadUpdate`、`updateInfo`、`override`、`openUpdateDir`、`clearUpdates` | 文件名正则 `^[A-Za-z0-9._\-]+\.json$`；URL 白名单；同文件下载去重 |
| `free:*` | 6 | `lookup`、`translate`、`ecdict`、`hover`、`stats`、`clear` | 查询串长度上限；缓存键防原型污染 |
| `pron:*` | 7 | `precacheStart`、`precachePause`、`precacheResume`、`precacheCancel`、`precacheStatus`、`stats`、`clear` | 来源枚举校验；缓冲文件存在性 |
| `backup:*` | 2 | `now`、`writeSnapshot` | 重入保护；路径固定在备份目录内 |
| `file:*` | 4 | `exportJSON`、`importJSON`、`saveCSV`、`openExports` | 目标目录白名单；文件名去非法字符；`saveCSV` 写 BOM（公式中和在渲染端 `csvSafe.ts`，`test:csv` 覆盖） |
| `stats:*` | 1 | `update` | 取整夹取、日期格式 |
| `qzcache` | 1 | （清缓存） | 只清应用缓存目录 |
| `clipboard:*` | 1 | `close` | 仅剪贴板窗可调用 |

事件通道（主 → 渲染）：`enhance:event`（载体为 `{type, value}`，`type` 取 `settings` / `mini` / `openSettings`）、`backup:request`、`pron:precache-progress`、`clipboard:word`（仅剪贴板窗）。全部经 preload 暴露为具名函数，不暴露 `ipcRenderer` 本体。

### 5.2 通用规则

1. 所有 `handle` 先做 `roleOf(event.sender)` 判定；未知来源直接 `throw forbidden` 并记日志。
2. 参数按「类型 → 范围 → 路径归一化 → 白名单」四步校验，任一失败返回 `{ok:false,error}` 而不是抛到渲染端。
3. 任何落盘路径都经 `path.resolve` 后与允许根目录做 `path.relative` 判断，拒绝 `..` 逃逸。
4. 出网只有三类：词典 CDN（`dictUrlAllowed`）、发音源、翻译 API；其余域名不进 CSP。

## 6. 配置 / 构建 / 依赖 / CI

- **Node 基线**：`engines: >=22.12 <23`、`.nvmrc=22`、Docker `node:22-bookworm-slim`、全部 workflow `node-version: 22`、预检/安装脚本同口径；`install.sh` 只允许 `npm ci`（锁文件不一致就该报错）。
- **构建目标**：`tsconfig.target=ES2020` 与 `vite.build.target=es2020` 一致；删除 `react-app-polyfill`；`chunkSizeWarningLimit=600` 不再上调（当前唯一超限是懒加载的 `vendor-echarts` 625KB）。
- **日志**：生产只去 `console.log/debug/info`，保留 `warn/error`。
- **依赖**：`classnames` 全量并入 `cn()`；删除 `@types/gtag.js`、`@types/echarts`、`@types/react-router-dom`、`react-app-polyfill`；`@svgr/core`、`@svgr/plugin-jsx` 曾按「零引用」删除导致 `npm run build` 失败，已恢复并注明「构建期需要，不能删」。
- **CI**：`desktop.yml`（Windows/Linux，xvfb + chrome-sandbox 4755，缺基线时产出 artifact）+ installer job；`e2e.yml` 去掉 `|| echo failure` 的软失败绕行。
- **发布**：`release.mjs` 多目录逐个备份并校验回滚；asar 先写 staging 外再移入；`package.mjs` 校验和按产物名合并。

## 7. 代码风格与规范

- 图标：61 处 `~icons/*`（28 个文件）统一为 tabler；`✨/★/☆/🔊/✕` 全部替换为内联或组件化 SVG（词卡、剪贴板窗、通知标题）。
- className：`classnames` 全部并入 `cn()`，只保留一个工具。
- 格式：`prettier --check` 覆盖 `src`、`scripts`、workflow、`package.json`；NSIS 模板因必须带 BOM 单独忽略并写明原因；图标产物由 manifest 逐字节校验，不参与格式化。
- 命名：`sessionEpoch`、`backupRunning`、`roleOf`、`cacheGet/cacheSet`、`copyTreeAsync` 等；注释只写「为什么」。
- 仍待收敛：`main.js` 2833 行、`enhance.js` 1694 行仍是单文件（§10.6），本轮不做大搬迁以免引入回归。

## 8. 验证记录

### 8.1 功能完整性核对

「功能完整性」的判据不是「代码还在」，而是「有可重复的验证手段」。下表逐项列出上游功能与本分支新增能力：

| 功能 | 关键实现 | 本轮影响 | 验证手段 |
| --- | --- | --- | --- |
| 打字 / 默写 / 音标练习 | `WordPanel`、`TextAreaHandler`、`useAttemptSettlement` | F-3/F-4/F-9 修，行为不变；F-11 计时只在窗口可见时累计 | `test:typing`；冒烟 `practiceWorks`/`finishedText` |
| 首启选档（可改、不打扰老用户） | `LearningStartDialog`、`autoLevel` | 未改 | `test:start-level`；冒烟 `startText`/`startClicked` |
| 自动进阶 13 级 | `utils/autoLevel.ts` | F-2 缓存、F-8 复习入口 | `test:core` 189 条 |
| 艾宾浩斯记忆曲线 | `srsRules.ts`、`memoryLadder.ts`、`db.updateMemoryProgress` | F-4 回滚、F-7 存储 | `test:core` 120 条；`test:review-persist` |
| 错词当场重现 | `sessionRequeue` | 未改 | `test:core`/`test:typing` |
| 错题本（分组/排序/详情/删除/导出/复习） | `pages/ErrorBook`、`deleteConfirm`、`DropdownExport` | F-8 修；F-6 索引 | 冒烟 `errorBookWorks`/`errorBookText`；`test:pages` 第 0~6 项；`test:csv` |
| 统计页（练习数/词数/WPM/正确率/错误键） | `pages/Analysis`、`wordStatsAggregate` | F-1/F-12 改聚合实现，口径不变 | `test:stats` 17 项 + `test:word-stats` 23 项；冒烟 `analysisWorks`/`analysisCanvas` |
| 词库画廊 + 自定义词库 | `pages/Gallery-N`、`QwertyPlusDB` | F-7 接入复习会话 | `test:pages`；`test:dict` 45 项 |
| 词库下载/更新/续传 | `dicts:*`、`lib/dict-fetch.js` | E-9 并发去重 | `test:dict` 45 项（含 206/416） |
| 导入/导出（数据库 / CSV / JSON） | `data-export.ts`、`file:*` | F-10 事务化；B-11 校验和 | `test:csv` 14 项；`test:pages` 脏 payload 项 |
| 备份 / 恢复 | `runBackup`、`backup:*` | E-1/E-2/E-8 修 | 冒烟 `backup`；安装器流程内也会跑 |
| 桌面设置 7 页签 | `Setting/index.tsx`、`desktop/*` | 图标/文案统一 | 冒烟 `settingsOpened`/`tabs`；`test:desktop-visual` 5 页 |
| 托盘 / 全局快捷键 / 迷你模式 / 剪贴板查词 / 发音缓存 | `main.js`、`pron:*` | E-9/E-12/E-13 修 | 冒烟 `runtimeReady` + 手动；`test:dict` 覆盖发音缓存状态 |
| 词卡浮层（查词/发音/主题跟随） | `enhance/*` | 图标改内联 SVG | `test:enhance` 9 项 + `test:enhance:detail` 42 项 |

### 8.2 自动化结果

| 检查 | 结果 |
| --- | --- |
| `npm run test:quality`（tsc + typecheck:node + eslint --max-warnings 0） | 通过 |
| `npm run test:core` | 309/309 + 确定性门禁 |
| `npm run test:review-persist` | 30/30（拆分、往返、旧键迁移、损坏兜底） |
| `npm run test:word-stats` | 23/23（五套口径 + 脏数据 + 与上一版逐字段一致） |
| `npm run test:input-judge` | 27/27（判定边界 + 错误文案 + 与重构前实现 2000 组对拍） |
| `npm run test:schema-sync` | 6/6（Dexie 版本 ↔ 备份常量 ↔ 导入守卫） |
| `npm run test:all` | 277 项全通过（含浮层 42 + 复习持久化 30 + 统计聚合 23 + 输入判定 27 + schema 6） |
| `npm run test:desktop-smoke` | 13/13（隔离 profile 自启） |
| `npm run test:desktop-visual` | 5/5，差异 0.000% |
| `npm run package` | 安装器 110.7MB（v11.6.2）；静默安装 → 体检 477 条目 / asar 哈希一致 → 冒烟 13/13 → 卸载清理 |
| 产物（v11.6.2） | Win `5C916676…`；Linux tar.gz `3E0035C0…`；asar `7EE88101…`；tar 内 asar 与 shell-info 已核对 |
| 运行时探针（复习进度） | 旧键迁移成功；按保存的 index 续接；输入一个词后 session 键字节不变、index 1→2 |
| 图标 | ICO 7 档 / ICNS 7 档 / 11 档 PNG；14 个文件入库字节与工作区一致 |

## 9. TypeWords 源码级对照（全量盘点 + 文件级结论）

> 对照对象是 `zyronon/TypeWords` 的实际源码：`app/` 下 **213 个文件、44 个目录（含嵌套）**。方法：先按目录清点，再对「练习主链路 / 数据与缓存 / 调度 / 输入 / 列表 / 导入导出」逐文件读实现；基础组件与国际化资源只做结构确认。
> 结论按「已采纳 / 值得做 / 明确不采纳」三类给出，每条附文件名与理由；不照搬技术栈，也不把「上游有」当成「我们必须有」。

### 9.0 全量盘点

| 分区 | 主要目录（文件数） | 细读的文件 | 与本项目的关系 |
| --- | --- | --- | --- |
| 调度与算法 | `core/hooks`（10）、`core/stores`（5） | `fsrs.ts`、`setting.ts`、`practice.ts`、`base.ts`、`runtime.ts` | FSRS 调度、设置项（含 `wordReviewRatio`、三个 FSRS 阈值）、练习计时状态 |
| 练习流程 | `core/composables/practice-words`（15）、`core/composables`（5） | `usePracticeWordTyping.ts`、`practice-word-session.ts`、`usePracticeWordNavigator.ts`、`usePracticeIdleTimer.ts`、`study-task.ts`、`usePracticePersistence.ts` | 对应我方 `Typing/store` + `useWordList` + `useAttemptSettlement` |
| 输入层 | `core/hooks/event.ts`、`components/word/WordTypingCore.vue` | `event.ts`（`CODE_TO_CHAR` / `SHIFT_CODE_TO_CHAR` / `CHAR_TO_CODE`）、`WordTypingCore.vue` | 对应我方 keydown 通道 + `TextAreaHandler` |
| 数据与缓存 | `core/utils`（10）、`core/hooks/export.ts` | `cache.ts`（`idb-keyval` + `{key, version}`）、`export.ts`（分域 version）、`http.ts`、`wordLookup.ts` | 对应我方 Dexie + 备份 / 查词 |
| 页面与组件 | `components/word`（22）、`components/list`（6）、`components/setting`（9）、`components/article`（9）、`components/dialog`（7） | `WordMarkPickList.vue`、`WordMetaPanel.vue`、`BaseList.vue`、`Statistics.vue`、`TranslationList.vue` | 对应我方 Word 卡片、错题本、统计页、设置页 |
| 句子 / 文章 | `composables/practice-sentences`（6）、`components/article`（9） | `useSentenceTypingFlow.ts`（上游自己标了 `@deprecated`）、`article.ts` | 我方无对应功能 |
| 基础设施 | `base`（23）、`base/icon`（5）、`base/toast`（3）、`base/select`（3）、`plugins`（4） | 只做结构确认（通用按钮/弹窗/选择器） | 我方用 Radix + Headless UI，不照搬 |
| 账号与云 | `core/utils/supabase.ts`、`rsa-password.ts`、`libs/translate/*` | `rsa-password.ts`（`node-forge` + `VITE_PASSWORD_RSA_PUBLIC_KEY`）、`supabase.ts` | 我方无账号体系，明确不引入 |
| 国际化 | `locales`、`vue-i18n` 配置 | 只确认存在 14 语言资源 | 我方中英双语，不引入 i18n 框架 |

### 9.1 已采纳 / 部分采纳

| TypeWords 文件 | 机制 | 我方落点 | 状态 |
| --- | --- | --- | --- |
| `app/core/composables/usePracticePersistence.ts` | 进度只存词名字符串（`taskWordsStr` / `wordsStr` / `wrongWordsStr`），读取时用词库 Map 还原 | F-7：学「大对象与小进度分离」，但 session 仍存完整 Word（跨词库复习要离线可用释义） | 部分采纳（v11.6.0） |
| `app/core/composables/practice-words/usePracticeIdleTimer.ts` | 3 分钟无操作自动暂停；`getIdlePauseTime` / `normalizePracticeTimer`、按天切分计时片段 | F-11：本轮只做「不可见不累计」的最小版；完整片段模型见 9.2 | 部分采纳（v11.6.1） |
| `app/core/composables/practice-words/visible-word-typing.ts` + `usePracticeWordTyping.ts` | 「这个键是否算对」抽成纯函数（`PracticeKeyboardInput`、`isPracticeCharacterCorrect`、`getPracticeInputCharacterStates`），组件只收集按键 | `Word/inputJudgement.ts`：`judgeInput` 给出 idle/correct/wrong（含增量起点、越界夹取）、`describeMistake` 给出漏字/重复/大小写/错字/多输入文案；Word 组件只写状态与音效 | **已采纳**（v11.6.2，27 项） |
| `app/core/hooks/export.ts` | 每类数据独立 `version`（`EXPORT_DATA_KEY.version`、`SAVE_SETTING_KEY.version` 等），导入按版本迁移 | 备份快照写入 `schemaVersion`（与 Dexie 版本同步）；导入时 `incoming > current` 直接拒绝并提示升级；旧备份缺字段则按兼容处理 | **已采纳（最小版）**（v11.6.2，6 项静态校验） |

### 9.2 值得做、尚未做（按收益/成本排序）

| TypeWords 文件 | 机制 | 我方现状 | 建议 |
| --- | --- | --- | --- |
| `app/core/stores/practice.ts` + `usePracticeIdleTimer.ts` | `timerPaused` + `timerPauseReason`（manual / auto_visibility / auto_idle）+ `segments: [start,end][]`，暂停时定格片段、恢复时新开片段 | 只有 `timerData.time` 一个累计值；可见性已在 v11.6.1 跳过，但没有暂停原因/片段，无法区分「真学」与「挂着」 | 加 `segments` 与暂停原因：统计页可按片段算真实学习时长；迁移时把旧 `time` 视为一个片段 |
| `app/components/word/WordMarkPickList.vue` | `know / unknown / mastered` 三态标记，已掌握进入忽略集合 | 只有「错题本」和 SRS 自动判定，没有用户主动「已掌握」 | 轻量版：词卡/错题本加「已掌握」，写入 `memoryRecords` 忽略标记，出词时跳过 |
| `app/components/list/BaseList.vue` | `DynamicScroller` / `DynamicScrollerItem`（vue-virtual-scroller）做虚拟列表 | 错题本分页 + 全量 `toArray`；词库画廊全量渲染 | 数据量阈值触发后再上虚拟列表；先做聚合表（§10.3），否则虚拟列表也只是把内存峰值挪个位置 |

### 9.3 明确不采纳

| TypeWords 文件 / 做法 | 原因 |
| --- | --- |
| `app/core/hooks/fsrs.ts`（`ts-fsrs` + `fsrsEasyLimit=0 / Good=3 / Hard=6` 把错次数映射为 Rating） | 算法更成熟，但替换会改变所有存量用户的到期时间与复习节奏，属产品行为变更；先做 `Scheduler` 接口抽象，再灰度切换（§10.7） |
| `app/core/hooks/event.ts`（`CODE_TO_CHAR` / `SHIFT_CODE_TO_CHAR` / `CHAR_TO_CODE`，按 `event.code` 判定） | 这是「练物理键位」的语义；本应用是「按屏幕上的字符输入」，用 `event.key` 才能让非美式布局打出正确字符（并已用 `isComposing` 挡输入法）。改成 code 映射会引入新的错判 |
| `app/core/config/env.ts:WordPracticeModeStageMap`（模式 → 阶段流水线） | 需要重排练习流程与 UI，收益偏产品化；当前「打字/默写/音标 + 开关」已覆盖需求 |
| `app/core/utils/word-test.ts`（选择题干扰项打分：`WORD_CONTAIN_SCORE`、`FUZZ_SCORE_BASE` 等） | 是独立的新题型，不是稳定性问题；且需要题库与 UI 配套 |
| `app/core/utils/supabase.ts`、`rsa-password.ts`、`libs/translate/*` | 账号/云同步会引入隐私、合规与运营成本；本项目坚持离线优先，翻译走现有免费接口 |
| `app/composables/practice-sentences/*`、`app/core/hooks/article.ts` | 句子/文章练习是新功能；且上游自己在 `useSentenceTypingFlow.ts` 标了 `@deprecated`（响应式链断裂），不适合照抄 |
| Nuxt/Vue 技术栈、`vue-i18n` 14 语言、emoji 文案 | 技术栈不同；本项目中英双语已够用 |

### 9.4 落地顺序（建议）

1. ~~输入纯函数化~~（v11.6.2 已完成，`test:input-judge` 27 项）；
2. ~~备份 `schemaVersion`~~（v11.6.2 已完成最小版；迁移函数表等第一次真正改 schema 时再加）；
3. 计时片段 + 暂停原因（`practice.ts` / `usePracticeIdleTimer.ts`）——统计页可显示「真实学习时长」，本轮已完成可见性这一半；
4. 错题聚合表 + 虚拟列表——解决数万条记录的内存峰值；
5. 「已掌握」标记——减少无效复习，改动小；
6. `Scheduler` 抽象 → FSRS 灰度——收益最大但需要产品决策。

## 10. 架构级方案（从根源解决，不逐处打补丁）

### 10.1 主进程同步 IO 下沉

**根因**：备份/词库/日志都跑在 Electron 主进程事件循环；`JSON.parse(readFileSync(32MB))` 会阻塞消息泵。
**已完成**：备份复制改 `copyTreeAsync` + `*.partial` 原子改名。
**待做**：词库解析移到 `utilityProcess` 或 `worker_threads`，主进程只保留「请求-响应 + LRU」；日志改内存队列 + 2s 批量 `appendFile`；`injectEnhance` 的 CSS/JS 启动时读一次缓存。
**验收**：备份 300MB 期间主窗口 `requestAnimationFrame` 间隔 <50ms；查询 8MB 词库 IPC 往返 <100ms。

### 10.2 复习进度存储拆分（已完成）

`reviewModeInfo:session` + `reviewModeInfo:index`，纯函数 + 30 项断言；旧键迁移一次后删除。
**验收**：1000 词会话翻词写入 <1KB；配额满时只丢 index，不丢词表。已达成。

### 10.3 错题本聚合与自动进阶

**根因**：错题本每次全量读 `wordRecords` 再内存分组；自动进阶用 `currentDictId` 过滤级别词库 id。
**已完成**：第 3 条（按实际 dict 分组 + 记忆记录兜底）随 F-8 落地。
**待做**：物化表 `wrongWordAggregate: 'word,dict,[dict+word]'`（`wrongCount,lastAt,recordIds`），`saveWordRecord` 同事务增量维护；错题本按 `wrongCount` 倒序分页查聚合表；列表窗口化渲染。
**验收**：5 万条记录打开错题本 <500ms。

### 10.4 跨 IndexedDB 导入

**根因**：`RecordDB` 与 `QwertyPlusDB` 是两个库，浏览器不提供跨库事务。前端导入已有「临时库 staging + 主库单事务」，但面板的全量导入要同时写两个库。
**方案**：导入前把两份数据写到 `*.importing` 临时库并校验行数/主键；按「QwertyPlusDB → RecordDB」顺序切换；写 `importJournal` 记录阶段，下次启动发现未完成 journal 时提示「继续/回滚」。这是「可恢复」而不是「假装原子」。

### 10.5 版本单一来源

**根因**：根 `package.json` 0.1.0（上游网页版）、`local-fork/package.json` 应用版本、`shell.mjs` Electron 常量、安装器 DisplayVersion 四处各自为政。
**方案**：`local-fork/package.json` 增加 `config.electronVersion`/`config.appVersion`，`shell.mjs`/`package.mjs` 只读它，`shell-info.json` 记录后由 `package.mjs` 断言一致。
**验收**：`shell-info.json`、exe FileVersion、安装器 DisplayVersion、界面版本四处一致。

### 10.6 main.js 拆分

**根因**：2833 行单文件，IPC、窗口、备份、词库、缓存混在一起，任何改动都可能碰全局状态。
**方案**：按依赖方向拆 `electron/ipc/{settings,dict,backup,window}.js`、`electron/services/{backup,dict-cache,log}.js`、`electron/windows/{main,clipboard}.js`；共享状态收敛到 `electron/state.js`（显式 getter/setter）。
**验收**：`main.js` <300 行；每个 service 可在 Node 里单独 import 测试；13 项冒烟与 221 条检查不变。

### 10.7 调度器抽象（为 FSRS 留口）

**根因**：艾宾浩斯阶梯硬编码在 `srsRules.ts` + `memoryLadder.ts`，`computeDue/evaluateWrong` 是纯函数但调用点分散。
**方案**：定义 `Scheduler` 接口（`nextDue(record, grade) → {due, stage, ease}`），现有阶梯作为 `ladder` 实现，FSRS 作为可选实现；`updateMemoryProgress` 只依赖接口；迁移时按记录 `createdAt` 分批灰度。
**验收**：切换实现不改 UI 与存储结构；`test:core` 309 条对两种实现都能跑（各自期望值）。

## 11. 剩余风险（明确边界）

| 风险 | 影响 | 现状/下一步 |
| --- | --- | --- |
| 词库解析在主进程 | 首次打开超大词库可能卡数百毫秒 | §10.1 `utilityProcess` |
| 错题本全量内存 | 数万条以上打开变慢 | §10.3 聚合表 + 虚拟列表 |
| 安装器未签名 | SmartScreen 首次拦截 | 购买代码签名证书后接 signtool |
| Linux 未上实机 | 只在 CI（xvfb）验证 | Ubuntu 22.04/24.04 实机跑一次冒烟与视觉 |
| 多标签页同时练习 | 记录各写各的，统计重复计入 | 需要跨标签页锁（`navigator.locks`）或单实例提示 |
| echarts 5.6 moderate 公告 | 图表页理论 XSS 面 | 升 6 需图表回归，单独一版做 |
| xlsx 0.18.5 无修复版 | 仅用于导出、不解析用户文件 | 换 `exceljs` 或官方 CDN 包 |
| macOS | 已移出支持范围（无实机/签名/dmg） | 交叉组装代码保留但不再承诺 |
| Electron 43 EOL | 2027-01-05 | 到期前升级 44+，品牌化已自动化 |

## 12. 复核方法（可重复）

```bash
npm run typecheck && npm run typecheck:node && npm run lint:strict
npm run test:word-stats                # 统计聚合 23 项 + 性能对照
npm run test:input-judge               # 输入判定 27 项（含 2000 组对拍）
npm run test:schema-sync                # 备份 schema 6 项
npm run test:all                       # 277 项，含浮层 42 + 复习持久化 30 + 统计聚合 23 + 判定 27 + schema 6
npm run test:core                      # 309 条
QZ_TEST_APP_DIR=release/shell-win32-x64 npm run test:desktop-smoke
QZ_TEST_APP_DIR=release/shell-win32-x64 npm run test:desktop-visual
npm run package                        # 安装器全流程（Windows）
npm run test:icons && npm run test:format
```

## 附录 A：本轮自引入并修掉的缺陷

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| 交叉组装 Linux 外壳体检失败 | `checkInstallDir` 永远按当前机器平台找 exe | 增加目标平台参数，`shell.mjs` 传入 `--platform` |
| 交叉组装 macOS 报「缺少 resources」 | `resourcesDirFor` 只认目录本身以 `.app` 结尾 | 支持「外层目录含 .app」 |
| macOS 外壳重命名 EPERM | Windows 文件系统代理先建目标再报错；脚本提前创建目标 Resources | 空目标清理重试 + 系统 `move` + 延后创建 |
| Windows 打 Linux tar.gz 报 `Cannot connect to D:` | GNU tar 把盘符当远程主机 | 检测 GNU tar 后加 `--force-local` |
| 安装器静默安装到了默认目录 | NSIS 的 `/D=` 必须是最后一个参数 | 调整参数顺序 + 不含空格的临时目录 |
| 卸载残留 `Uninstall.exe` | 卸载器从安装目录运行，删不掉自己 | 去掉 `_?=`，卸载段先 `SetOutPath $TEMP` |
| 「冒烟通过（0 项 PASS）」 | dsh-smoke 输出 JSON，不是 PASS 文本 | 解析 JSON 并要求 13/13 |
| `*.icns` 被当文本转换 | `.gitattributes` 只有 `*.ico binary` | 补 `*.icns binary` 与其余二进制规则，逐个校验入库字节 |
| 校验和文件互相覆盖 | `writeSums` 整体重写 | 按产物名合并 |
| `@svgr/*` 被当死依赖删除 | 静态引用扫描看不到构建期 `require` | 恢复并注明不能删 |
| `shell.mjs --force` 偶发 EBUSY（两次构建撞到） | Windows 上杀毒/索引服务/上个进程句柄未释放，`rmSync(force:true)` 不吞 EBUSY | `removeDirWithRetry`：200ms 递增退避重试 6 次，仍失败则改名 `*.stale-<ts>` 让路 |
| `shell-info.json` 写入构建机绝对路径 | 该文件随安装包/tar.gz 分发，泄露目录结构且换平台无意义 | 只记 `app.asar` 文件名 |

## 附录 B：修复台账（总表里未展开的条目）

> 正文按模块展开的是有代表性的根因；下表补齐其余条目的**可执行修复动作**，便于逐条复核。

| ID | 可执行修复 |
| --- | --- |
| B-1 | 统一 Node 基线：`engines.node >=22.12 <23`、`.nvmrc=22`、Docker `node:22-bookworm-slim`、四个 workflow `node-version: 22`、`pre-check.{sh,ps1}` 与 `install.{sh,ps1}` 同口径 |
| B-2 | Actions 升 v4；`e2e.yml` 去掉 `\|\| echo "status=failure"` 这类软失败写法与随后的 status 检查，失败即红 |
| B-3 | `new URL()` 解析 + `127.0.0.1/localhost/::1` 白名单；`playwright.config.ts` 纳入 `tsconfig.node.json`，新增 `typecheck:node` 进 `test:quality` |
| B-4 | 下载后核对官方 `SHASUMS256.txt`；不符则删除重下；支持 `QZ_ELECTRON_SHA256` 指定、`QZ_SKIP_ELECTRON_VERIFY=1` 显式跳过（会打警告） |
| B-5 | `tsconfig.target=ES2020`；删除 `react-app-polyfill`；`vite.build.target='es2020'`，与 Electron 43 对齐 |
| B-6 | `drop:['debugger']` + `pure:['console.log','console.debug','console.info']`，保留 `warn/error` |
| B-7 | 新增 `.dockerignore`（node_modules/build/release/backup/logs/.git/.tools 等）；构建阶段 `npm ci --ignore-scripts` + `HUSKY=0` |
| B-8 | `classnames` 全量替换为 `cn()` 并删依赖；删 `@types/gtag.js`、`@types/echarts`、`@types/react-router-dom`、`react-app-polyfill`；`typescript` 移到 devDependencies；`@svgr/*` 恢复（构建期需要） |
| B-9 | 每个安装目录各备份一份；回滚后校验 sha256；失败写 `logs/partial-rollback-*.json` 并 `exitCode=3` |
| B-10 | asar 先打到 staging 外的临时文件，成功后 `rename` 进 `resources/`；`finally` 清理临时文件 |
| B-11 | `writeSums` 读旧文件按产物名合并，再按名称排序写回 |
| B-12 | `.gitattributes` 补 `*.icns/*.jpg/*.gif/*.webp/*.woff*/*.ttf/*.zip/*.gz/*.exe/*.dll/*.node/*.asar` 为 `binary`，`scripts/templates/*.nsi` 为 `-text` |
| B-13 | react-router 升 6.30.6（修 open redirect）；echarts 5.6 待升 6（需图表回归）；xlsx 仅导出用途，计划换 `exceljs` |
| E-14 | `publicSettings()` 不再拼接 `plusDir/userDataDir/exportsDir`，只下发 `version` 与设置项 |
| E-10 | 字典 id 与路径映射改 `Object.prototype.hasOwnProperty.call(map, key)`，拒绝原型链命中 |
