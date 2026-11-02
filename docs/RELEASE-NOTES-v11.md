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
| `local-fork/electron/enhance/enhance.js` | 2605 → 1668 行（净减 937：删 2227 / 增 1290，含 prettier 展开）；删除面板 DOM/CSS/页签与 74 条面板规则；保留词卡、悬停提示、toast、键音、主题、统计与备份；新增无头 `window.qzRuntime`（13 个方法） |
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


---

# v11.1.0（兼容性与可移植性）

| 项 | 之前 | 现在 |
| --- | --- | --- |
| 桌面验证脚本定位程序 | 三个脚本各写死 `D://整理//qtest9//app//Qwerty Learner.exe` | `scripts/lib/desktop-app.mjs` 统一解析：`--exe` → `QZ_VERIFY_EXE` → `QZ_TEST_APP_DIR` → `release/app`；按平台拼 `.exe` / `.app/Contents/MacOS/...` / 无后缀 |
| `test:visual` | 必须手工起 dev server | Playwright 检测到本地 baseURL 时自动拉起，`reuseExistingServer` 复用已在跑的服务 |
| 设置对话框 | 固定 800×480，小屏溢出 | `min(800px, 100vw-32px)` × `min(480px, 100vh-144px)`；侧栏 176px，≥640px 时 208px |
| Linux 开机自启 | 开关可点但无效 | 主进程拒绝写入并在界面置灰，注明仅 Windows / macOS |
| 词库列表首开 | 为 385 个词库各读一次 JSON 计数 | 优先用 `dict-meta.json` 的 `length`，缺失时才读文件 |
| **切页错位（新发现）** | `Tab.Panel unmount` 会导致 Headless UI 重算索引，实测点「数据设置」偶发落到「高级设置」 | 改为 `LazyPanel`：首次激活后保持挂载，既不重复采集也不触发 Panel 注销 |
| 桌面 UI 回归 | 只有临时截图脚本 | `npm run test:desktop-visual`：4 页固定 1280×800、像素对比、基线入库 |
| CI | 只有上游 master/dev 触发 | `.github/workflows/quality-fork.yml`：所有分支跑 typecheck + lint + build + stats + core |

验证：tsc + eslint 通过；`test:all` 88 条；`test:core` 309/309；`test:pages` 20/20；
`test:visual` 2/2（自动起服务）；`test:desktop-visual` 4/4（连跑 3 次 0.000%）；
隔离冒烟 13/13；双目录安装 asar `ADC627A8…` 一致。版本号 → `1.0.0-enhanced-v11.1.0`。


---

# v11.2.0（收尾：主题完整化、错误处理、属性测试、断点续传）

## 主题

- `indigo` 调色板改为 CSS 变量（`--qz-indigo-50..950`，默认值 = Tailwind indigo），桌面壳的
  `html.qz-accent-*` 只覆盖变量；带透明度的 `bg-indigo-400/70`、渐变、`ring/shadow-indigo-*` 一起跟随。
  删掉了原先 14 条「只覆盖 text/bg/border-indigo-500/400/600」的选择器补丁。
- `test:desktop-visual` 增加「玫瑰红强调色」页，并断言 `bg-indigo-400/70` 的计算色在换色后发生变化。

## 边界与错误处理

| 位置 | 问题 | 修复 |
| --- | --- | --- |
| `computeCorrectRate` | 脏数据（错词数 > 词数 / 负数）会得到负值或 >100 | 夹取到 0~100；`test:stats` 17 条 + 属性测试覆盖 |
| `useDesktopSettings.patch` | IPC 失败产生未捕获 rejection，界面停在旧状态 | catch + toast |
| 词库页 | 收藏/切换/检查更新/下载/导入/删除都可能把异常抛到控制台 | 全部 catch 并显示原因；删除自定义词库加确认框 |
| 工具页 | 预缓存开始/暂停/继续/取消、通知、清缓存失败时无反馈 | catch + 行内提示 |
| 数据页 | 备份失败只在返回值里，通道异常无人处理 | catch + 行内提示 |
| 当前词库 | 历史版本可能把 `currentDict` 存成裸字符串，`JSON.parse` 会抛错 | 解析失败按原值处理 |

## 词库下载断点续传

- 先写 `<file>.part`；失败保留，下次带 `Range: bytes=<已下载>-`；
- 服务端返回 206 追加、200 从头覆盖；416 重置；
- 落盘前校验体积与 JSON 结构，失败清 `.part`，避免半截文件被反复续传；
- 返回 `resumed`，界面提示「断点续传」。

## 新增验证

- `npm run test:fuzz`：csvSafeCell / normalizeTrans / computeCorrectRate 各 800 组固定种子随机输入，
  不变量失败即报错；已接入 CI 与 `test:all`。
- `test:all` 现为 **95 条**（stats 17 + fuzz 5 + start-level 21 + pages 20 + typing 18 + csv 14）+ core 309。
- `test:desktop-visual` 5 页（显示/数据/词库/工具/强调色），连跑 2 次 0.000%。

## 本版验证

tsc + eslint 通过；`test:all` 95 条；`test:core` 309/309；`test:visual` 2/2；
`test:desktop-visual` 5/5；冒烟 13/13；双目录安装 asar `F418D1EB…` 一致。

---

# v11.3.0（发布链跨平台 + 四个「看着有、其实没生效」）

## 1. 发布/回滚不再绑定 Windows

| 之前 | 现在 |
| --- | --- |
| `scripts/dsh-release.ps1`（346 行脚本语言实现），默认路径 `D:\整理\...` | `scripts/release.mjs`（纯 Node），默认 `release/` + `backup/`（已 gitignore） |
| 回滚同理 | `scripts/rollback.mjs`，`npm run rollback` / `rollback:list` |
| 打包用 `npx --yes @electron/asar@4.3.1` 现拉 | `@electron/asar` 进 devDependencies，离线可用 |
| `npm run quality` 调 .ps1 | 纯 npm 链：tsc + eslint + 单测 + 属性测试 + 词库下载 + 核心回归 |

`.ps1` 保留为薄包装（参数原样转发），只是兼容，不再承载逻辑。
**等价性验证**：新版脚本对 v11.2.0 的构建产物打包出 `F418D1EB…`，与旧发布链**逐字节一致**。

## 2. `fs.cpSync` 会让进程直接消失

`fs.cpSync` 在本机 Node 22.22.2 / Windows 上对**任意**目录都会以 `0xC0000409` 终止进程——
不是抛异常，`try/catch` 抓不到。受影响的真实路径是**主进程自动备份**（复制 IndexedDB / Local Storage）。
两处都换成了自写遍历复制（`copyTree` / `copyTreeSync`），失败退回普通异常，按原逻辑「该项跳过并记日志」。

## 3. 词库「断点续传」以前根本续不上

原实现先把整个响应读进内存，再一次性写 `.part`；连接中断时没有任何字节落盘，
所以下次只能从 0 开始 —— `.part` 和 `Range` 分支是死代码。
现在改成**边收边写**，中断保留已收字节，下次带 `Range` 续传。
新增 `scripts/verify-dict-fetch.mjs`（30 项，本地 HTTP 服务真发 `Range`）：
断流后 `.part` 保留、续传请求头正确、文件完整。
**反证**：把实现改回「整包再写」，3b/3d/3e 三条立刻失败（`partialSize: 0`、`lastRange: ""`）。

## 4. 验证脚本不再误杀你的应用

三个 CDP 脚本原来按进程名强杀全部实例——把用户正在用的应用一起杀掉；
再用固定 `sleep 800ms` 等退出，偶发连到正在关闭的旧实例（`等待超时（首屏出词）`）。
现在只清理**占用本脚本端口**的进程并轮询等端口释放；子进程退出改跨平台 `killChild`。
另外首屏就绪条件原来要求词长 ≥2，遇到单字母词（`a` / `I`）会白等 30s，已改为「有词且字母已渲染」。

## 5. 视觉基线缺文件不再算通过

`test:desktop-visual` 原来「没有基线就写一份并判过」，等于新平台首次运行不设防。
现在缺基线 → 失败，并提示 `test:desktop-visual:update`。

## 本版验证

| 检查 | 结果 |
| --- | --- |
| tsc + eslint | 通过 |
| `test:all` | **125 条**（stats 17 / fuzz 5 / dict 30 / start-level 21 / pages 20 / typing 18 / csv 14） |
| `test:core` | 309/309 + determinism |
| `test:visual` | 2/2（自动起 dev server） |
| `test:desktop-visual` | 5/5（view/data/dict/tools 0.000%，accent 0.004%） |
| 隔离冒烟 | 13/13（含 `backupWorks`：走新的 `copyTreeSync`） |
| 双目录安装 | asar `1D5502ED…` 两目录一致 |

---

# v11.4.0（把「剩余风险」变成可跑的检查）

本轮不加功能，只把上一版列出的风险逐条变成能跑的东西。

## 1. 下载链路：从 30 项到 45 项

| 新增场景 | 断言 |
| --- | --- |
| 分块慢速（10 块 × 120ms） | 完整落盘、`resumed=false` |
| 下载中途超时 | 报错且 `.part` 保留已收字节；之后能续传到完整文件 |
| 连续三次中断（服务端支持 Range 但只给一半） | `.part` **每次都在前进**，不是原地重下；最后能续传完成 |
| 206 只给一半就结束 | 判定为脏 JSON，清 `.part`，不生成目标文件 |
| 0 字节响应 / `body=null` | 报「空文件」而不是崩溃 |
| 残留 `.part` 超过体积上限 | 丢弃并整包重下，不会被当成续传起点 |

## 2. 安装目录体检

新增 `scripts/check-install.mjs`（`npm run check:install`），发布脚本在**测试安装**与**正式安装**后各跑一次：

- 可执行文件存在；
- `app.asar` 能被 asar 读出目录（截断的包在这一步就会失败）；
- 必需条目齐全：`package.json` / `electron/main.js` / `build/index.html`；
- 哈希与本次产物一致；
- `resources` 下没有上次失败留下的 `.tmp-*`；
- 安装目录根部有 `LICENSE` 与 `FORK-NOTICE.md`（GPL）。

顺带修掉：`--test-install` 以前不复制这两个合规文件，测试目录与正式目录结构不一致——体检第一次跑就抓出来了。

## 3. 桌面视觉基线可指定平台

新增 `--platform` / `QZ_DESKTOP_VISUAL_PLATFORM`，给其它平台（或 CI 容器）生成独立基线用；
`docs/DSH-FORK.md` §6.6 写了具体步骤。缺基线仍然是**失败**，不会静默写一份然后判过。

## 4. 门禁只剩一处实现

`scripts/quality-gate.ps1` 降级为薄包装，把 `-SkipTypes` / `-SkipLint` / `-WithSim` / `-WithSmoke` 映射到
`npm run quality` / `npm run test:quality` / `node scripts/core-regression/run.mjs` / `node scripts/dsh-smoke.mjs`。

## 本版验证

| 检查 | 结果 |
| --- | --- |
| tsc + eslint + `prettier --check .` | 通过 |
| `test:all` | **140 条**（stats 17 / fuzz 5 / dict **45** / start-level 21 / pages 20 / typing 18 / csv 14） |
| `test:core` | 309/309 + determinism |
| `test:visual` | 2/2 |
| `test:desktop-visual` | 5/5（view/data/dict/tools 0.000%，accent 0.004%） |
| 隔离冒烟 | 13/13 |
| 安装体检 | 3/3（测试目录 + 两个正式目录） |
| 双目录安装 | asar `738E9E81…` 两目录一致 |

---

# v11.5.0（外壳可以自己造了 + 浮层有用例了）

## 1. 从零组装桌面外壳

以前要「先准备一个装好的 Electron 目录」，别人 clone 下来跑不起来。现在：

```bash
npm run shell                                   # Electron 43.8.3，产出 release/shell-<platform>-<arch>
node scripts/shell.mjs --zip <本地 zip>          # 离线
node scripts/shell.mjs --asar <app.asar>         # 指定包
```

下载 → 解压 → 放 `app.asar` → 删 `default_app.asar` → 平台重命名 → 复制 GPL 材料 → 写 `shell-info.json` → 体检。
**实测**：用官方 Electron 43.8.3 包产出目录，体检 477 条目 / GPL 齐全，启动后冒烟 **13/13**。

不生成安装器与图标（需要 rcedit / .icns / NSIS，见 DSH-FORK §7.4）。

## 2. 词卡浮层回归（上一版的遗留）

`npm run test:enhance`，9 项：`qzRuntime.lookupWord` 打开词卡、空词不打开、Esc 关闭、
点遮罩关闭、点 ✕ 关闭、关闭后无残影、无未捕获异常、无控制台错误。
浮层在 `#qz-enhance-host` 的 open shadow root 里，用例从 shadowRoot 查。

## 3. 文档纠正

- README 的「Electron 33」改为 **43.8.3**；「注入式增强 UI」改为「页面内浮层 + 无头运行时」；
- DSH-FORK §7.3 重写为「从零组装外壳」，新增 §7.3.1 安装。

## 本版验证

| 检查 | 结果 |
| --- | --- |
| `npm run quality` | 通过（格式 + tsc + eslint + 17 + 5 + 45 + 309） |
| `test:all` | **149 条**（stats 17 / fuzz 5 / dict 45 / start-level 21 / pages 20 / typing 18 / **enhance 9** / csv 14） |
| `test:core` | 309/309 + determinism |
| `test:visual` | 2/2 |
| `test:desktop-visual` | 5/5 |
| 隔离冒烟（安装目录） | 13/13 |
| 冒烟（`npm run shell` 自建外壳） | 13/13 |
| 安装体检 | 3/3 |
| 双目录安装 | asar `C895DFA5…` 一致 |

---

# v11.5.1（补丁）

- `FORK-NOTICE.md`：提交数改为「命令 + 时点快照」，不再写死（写死的数字每次提交就过期）；
  同时修正 4.5 节「注入式增强面板」的过期描述；
- 因为 `FORK-NOTICE.md` 会打进 `app.asar` 并复制到安装目录，本版重新构建并重装，保证
  「仓库文档 / asar / 安装目录」三处一致。

验证：`test:all` 149 条、`test:core` 309/309、`test:visual` 2/2、`test:desktop-visual` 5/5、
隔离冒烟 13/13、安装体检 3/3；asar `01FEA493…`，双目录一致。

---

# v11.6.0（安装器 / 图标 / 三平台 CI / 浮层细分用例）

这一版处理的是上一版明确留下的四条「能力边界」，不是再加功能：

## 1. 桌面图标（Windows / macOS / Linux）

- 新增 `scripts/icons.mjs`：从品牌 SVG（当前 `src/assets/logo.svg`）渲染 16–1024 共 11 档 PNG，
  再自己封装 ICO 与 ICNS。图标造型会按用户提供的参考图另行重做；本版先把「生成 + 校验 + 打包」链路做通。
  ICO 用 PNG 压缩条目（Vista+ 支持），ICNS 覆盖 16/32/64/128/256/512/1024，不依赖 ImageMagick、
  `iconutil`、`png2icns`，三平台产物逐字节一致。
- 生成物提交在 `local-fork/icons/`（`icon.ico` / `icon.icns` / `icon.png` + 各档 PNG + `manifest.json`）。
- `npm run test:icons` 做两层校验：结构（ICO 目录项、ICNS 块类型与尺寸）+ 与 SVG 重算结果**逐字节比对**，
  「改了 SVG 忘了重新生成」会失败。
- 站点 favicon / PWA 图标与桌面图标从同一 SVG 生成，保证两端口径一致。
- 前端不再混用 heroicons / weui / fa / bxs / icon-park 等图标家族，58 处图标全部统一为 tabler；
  仅有的 emoji（✨ / ★ / ☆ / 🔊 / ✕）改为内联或组件化 SVG。

## 2. Windows 安装器（NSIS 3.10）+ 外壳品牌化

- `npm run package`：
  1) rcedit 2.0.0 写入图标与版本资源（`FileVersion 11.6.0.0`，`ProductVersion 1.0.0-enhanced-v11.6.0`）；
  2) makensis 生成 `QwertyLearner-v11.6.0-win-x64-Setup.exe`（当前用户安装，无需管理员）；
  3) **静默安装到临时目录 → 体检（asar 哈希/条目/GPL）→ 启动冒烟 13 项 → 静默卸载 → 断言目录清理**。
- 安装器内容：主程序 + 开始菜单 + 可选桌面快捷方式 + 卸载信息（HKCU，控制面板可见）；
  卸载只删程序目录与快捷方式，**保留学习数据**；目录里写 `.qz-install` 标记，没有标记时只删已知文件，
  不会 `RMDir /r` 用户自选目录。
- `npm run shell` 默认也做品牌化（`--no-brand` 可关）：以前自建外壳的任务栏图标与文件属性显示 Electron，
  现在与安装器一致。rcedit/NSIS 按需下载到 `.tools/`（已 gitignore），rcedit 校验 SHA256，
  也支持 `QZ_RCEDIT_EXE` / `QZ_NSIS_DIR` 完全离线。
- 版本号映射集中在 `numericVersion()`：`1.0.0-enhanced-v11.6.0 → 11.6.0.0`，
  不再出现「exe 文件版本停在 9.8.0.0」的旧问题。

## 3. Linux 产物（macOS 不再作为支持目标）

- Linux：`QwertyLearner-v11.6.0-linux-x64.tar.gz`，含 `qwerty-learner.desktop`、`qwerty-learner.png`、
  LICENSE / FORK-NOTICE；`package.mjs` 会回读 tar 清单确认关键文件在。
- macOS：按用户要求**不再投入**。交叉组装/Info.plist 代码保留在脚本里，但没有实机验证、签名、公证与 dmg，
  文档与 CI 都不再把它列为支持平台。
- Windows 安装器未签名（没有代码签名证书）；首次运行 SmartScreen 可能提示，这是证书边界，不是脚本缺陷。

## 4. 两平台桌面 CI

- 新增 `.github/workflows/desktop.yml`：Windows / Linux 跑
  自启冒烟、页面、输入、起点、浮层基础+细分、桌面视觉；Linux 用 `xvfb`，并修正 Electron
  `chrome-sandbox` 的 root/4755 权限。
- 单独 `installer` job 在 Windows 上真实构建安装器并跑安装/启动/卸载验证，产物与 SHA256 上传 artifact。
- 视觉基线缺失时不会「静默判过」：工作流生成基线并上传 artifact，下载后用
  `npm run test:desktop-visual:apply -- <目录>` 校验（5 张、1280×800、非纯色）后写入仓库。
  Windows 基线已在实机生成；Linux 基线由该工作流首次运行时产出。

## 5. 浮层细分用例（42 项）

`npm run test:enhance:detail` 补的是基础用例没覆盖的部分：18 个运行时入口、Shadow DOM 隔离、
词卡在视口内/宽度上限/滚动、点内容不关闭、Esc/遮罩/✕、空词、200 字符长词、XSS 字符串按文本显示、
中文/引号/emoji、toast 叠加与自动清理、深浅色同步、换强调色、只读 API 返回类型、
15 次开关无节点增长、无滚动锁残留、全程无异常/无控制台错误。

## 6. 做这四件事时暴露并修掉的缺陷

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| 交叉组装 Linux 外壳时体检失败 | `checkInstallDir` 永远按**当前机器**平台找 exe | `resolveDesktopExe` / `checkInstallDir` 增加目标平台参数，`shell.mjs` 传入 `--platform` |
| 交叉组装 macOS 外壳时「缺少 resources」 | `resourcesDirFor` 只认「目录本身以 .app 结尾」 | 支持「外层目录里含 .app」的布局 |
| macOS 外壳解压后重命名 EPERM | Windows 文件系统代理先建目标再报错；且脚本提前创建了目标 Resources | 目标为空才清理重试；Windows 目录改用系统 `move`；darwin 分支延后创建 Resources |
| Windows 上打 Linux tar.gz 报 `Cannot connect to D:` | GNU tar 把盘符当远程主机 | 检测 GNU tar 后加 `--force-local` |
| 安装器静默安装到了默认目录 | NSIS 的 `/D=` 必须是最后一个参数 | 调整参数顺序，并用不含空格的临时目录 |
| 卸载后残留 Uninstall.exe | 卸载器从安装目录运行，删不掉自己 | 去掉 `_?=`，让它复制到临时目录再运行；卸载段先 `SetOutPath $TEMP` |
| 「冒烟通过（0 项 PASS）」 | dsh-smoke 输出 JSON，不是 PASS 文本 | 解析 JSON 并要求 13/13 全 true |
| 非 macOS 上 .app 的 Info.plist 改不了 | 只有 `plutil` | 增加 XML plist 文本补丁；二进制 plist 仍提示必须在 macOS 上重跑 |

## 本版验证

| 检查 | 结果 |
| --- | --- |
| `test:icons` | PASS（ICO 7 档 / ICNS 7 档 / 1024 PNG，逐字节一致） |
| `test:core` | 309/309 |
| `test:all`（含新增 42 项浮层细分） | 全部通过 |
| 隔离冒烟（自建外壳） | 13/13 |
| 桌面视觉（Windows） | 5/5，差异 ≤0.004% |
| 安装器 | 110.8MB；静默安装 → 体检 477 条目 → 冒烟 13/13 → 卸载清理 |
| Linux 产物 | tar.gz 142.4MB，包含 desktop/icon/LICENSE |
| CI 工作流 | YAML 校验；Windows/Linux 与 installer job 已接入（首次运行会生成 Linux 基线） |

## 复审追加（v11.6.0 发布前，全栈根因修复）

发布前又做了一轮逐目录审查，详见 [`AUDIT-v11.6.md`](./AUDIT-v11.6.md)。本版同时修掉：

- **P0 构建阻断**：`@electron/asar@4` 要求 Node ≥22.12，而 engines/.nvmrc/Docker/CI 仍是 18~20 → `npm run release` 必失败、桌面 CI 三个 job 必红。已统一到 Node 22.12（含预检与安装脚本）。
- **P1 数据可靠性**：备份并发重入/同秒同名/修剪误删；退出与重启不等备份收尾；全量导入逐表 clear 无事务；词记录失败被吞但 SRS 仍推进；DB 读失败伪装成「已全部学完」；重置章节时旧结算污染新章节。
- **P1 性能**：统计页 O(n²) 日桶；每次换词 4~6 次全表聚合；首屏静态 xlsx 429KB。
- **P2 安全/稳定**：剪贴板小窗共享 43 个 IPC 通道；导航放行 app 内任意 HTML；查词缓存 `__proto__` 污染；窗口状态缺字段导致无窗口；设置文件损坏被静默覆盖；统计字段 Infinity 进托盘；快捷键换键失败连旧键一起丢。
- **工程一致性**：classnames 全量并入 `cn()`；删除 6 个死依赖（`@svgr/*` 保留，构建期需要）；`playwright.config.ts` 纳入类型检查；Docker 增加 `.dockerignore`；生产构建保留 `console.error`；Electron 发行包强制 SHA256 校验。
- **收尾四项（原「待改」）**：
  - F-7 复习进度拆成「会话 + 下标」两个 localStorage 键，翻词只写 30B；旧键自动迁移，新增 `test:review-persist` 30 项。
  - F-8 错题回顾不再按 `currentDictId` 过滤：按错题实际词库分组、词库读不到时用记忆记录兜底，自动进阶用户不再遇到「当前词典没有错题」。
  - E-8 备份复制改全异步（每 64 个条目让出事件循环）+ `*.partial` 原子改名，修剪只认完整目录；删掉不再使用的 `copyTreeSync`。
  - E-9 同一词库文件的并发下载去重，连点重试不再互相覆盖 `.part`。

验证：`test:all` 221 项、核心回归 309/309、安装器全流程、桌面视觉 5/5（基线随图标/文案更新）、`npm run test:icons` 逐字节一致。

### 参考 TypeWords 的后续优化

对 `zyronon/TypeWords` 做了源码级对照（不是只看 README），可借鉴项与落地顺序写在 `AUDIT-v11.6.md` §6：FSRS 调度器、紧凑持久化、计时片段、输入动作抽象、虚拟列表、版本化备份、阶段式练习。明确不照搬 Nuxt 技术栈、默认云同步、emoji 文案与 14 语言 i18n。

---

# v11.6.1（统计聚合实测 + 计时可见性 + TypeWords 全量盘点）

这一版不加功能，只补上一版留下的三处薄弱点：

## 1. 统计聚合：抽成纯函数并给出实测数字

- 新增 `src/pages/Analysis/hooks/wordStatsAggregate.ts`：日桶、去重词数、WPM、正确率、错误键五套口径都在这里，`useWordStats` 只负责读库、取消过期请求与错误态。
- 去掉第二处放大：错误键不再 `flatMap + Array.from({length: count})` 展开成与错误次数等长的数组，直接按 `Map` 合并。
- 新增 `npm run test:word-stats`（23 项）：空/脏记录（null、空词、NaN、字符串时间戳、区间外）、同日去重、WPM 与正确率公式、空格/多字符键、结果排序，以及**与上一版实现逐字段一致**。
- 实测（同一批合成数据，`scripts/verify-word-stats.mjs`）：

  | 场景 | 上一版 | 本版 | 说明 |
  | --- | --- | --- | --- |
  | 同日 1 万条（最坏情况） | 629.1ms | 28.6ms | 22×，旧实现的数组 spread 是 O(n²) |
  | 跨 30 天 2 万条 | 72.9ms | 54.4ms | 1.3×，错误键展开 4 万元素 → 0 |

## 2. 计时只在窗口可见时累计

- 发现：`setInterval` 只看 `isTyping`，最小化/切走/锁屏后仍每秒 +1，结果页用时、WPM、分享图都会被「挂着一下午」稀释。
- 修复：`document.hidden` 时跳过 tick。完整方案（暂停原因 + 计时片段，可区分手动/切走/空闲）列为下一步，见 `AUDIT-v11.6.md` §9.2。

## 3. TypeWords 全量盘点

- `app/` 下 213 个文件按 9 个分区清点，细读调度、练习流程、输入、缓存、列表、导入导出相关文件；基础组件与 i18n 只做结构确认。
- 新增候选：计时片段 + 空闲暂停（部分已采纳）、备份 `schemaVersion`、虚拟列表、已掌握标记。
- 新增「明确不采纳」：`event.code` 物理键位判定（本应用按字符输入）、`word-test.ts` 选择题、Supabase/RSA 账号体系、上游自己标 `@deprecated` 的句子练习。

## 4. 构建脚本两处健壮性修复

- `shell.mjs --force` 在 Windows 上偶发 `EBUSY`（本轮两次撞到）：新增 `removeDirWithRetry`，200ms 递增退避重试，仍失败则把旧目录改名 `*.stale-<ts>` 让路，不再阻断构建。
- `shell-info.json` 原本写入构建机绝对路径，会随安装包/ tar.gz 分发：改为只记 `app.asar` 文件名。

## 验证

`test:all` 244 项、`test:core` 309/309、`test:word-stats` 23/23、冒烟 13/13、桌面视觉 5/5、安装器全流程。
