# 代码约定（Conventions）

> 适用范围：本仓库 `src/`（React 前端）与 `scripts/`（构建、验证、发布）。
> 这些约定是**当前代码的实际做法**，2026-10 的 v10.6 整理时统一写入文档，避免"每个人一套风格"。
> 新增代码请遵循；已有代码在触碰时顺手对齐，不做无差别重写。

## 1. 目录分层

| 目录 | 放什么 | 不该放什么 |
| --- | --- | --- |
| `src/pages/` | 路由级页面，一页一个目录（`index.tsx` 为默认导出入口） | 可复用的通用组件 |
| `src/components/` | 跨页面复用的组件（一个组件一个目录 + `index.tsx`） | 页面级状态、路由逻辑 |
| `src/pages/**/components/` | 只服务该页面的组件（就近放置，不往全局 components 塞） | 被多处依赖却藏在页面里 |
| `src/hooks/` | 跨页面复用、且不依赖具体页面的 hook | 只服务单个页面的 hook（放 `pages/**/hooks/`） |
| `src/utils/` | 纯函数（无 React 依赖） | 读写全局 atom、发请求、操作 DOM |
| `src/utils/db/` | 数据层（Dexie 表定义、读写、导入导出） | 页面状态、UI 逻辑 |
| `src/store/` | Jotai atom 与持久化 | 组件 |
| `src/resources/` | 静态资源索引（词库、音效、图片映射） | 业务逻辑 |
| `src/typings/` | 全局类型 | 运行时实现 |

## 2. 组件写法

- **一律用函数声明**，不用 `React.FC`（v10.6 已把最后 7 处 `React.FC` 收敛掉）：
  ```tsx
  type WordChipProps = { word: string; onClick?: () => void }

  export default function WordChip({ word, onClick }: WordChipProps) { ... }
  ```
- **Props 类型命名** `XxxProps`，就近定义在组件文件里；跨文件复用才提到 `typings/`。
- **导出**：
  - 页面、独立组件 → `export default function`；
  - 同一目录内的子组件/展示片段 → 具名导出（`export function WordDisplay`），由父组件引用；
  - 需要 `memo` / `forwardRef` 时：先声明函数，再 `export default memo(X)`，不要在声明处套 `React.FC`。
- **一个文件一个主组件**；单文件超过 ~300 行时，优先按「展示层 / 状态机 / 纯函数」拆分（参考 `Word/` 的 `WordDisplay.tsx`、`letterVisibility.ts`、`useAttemptSettlement.ts`）。
- **hooks 顺序**：atom → ref → state → 派生 useMemo → 回调 useCallback → effect。

## 3. 样式

- **优先 Tailwind**；需要复用结构、复杂选择器或动画时，才用 CSS Module。
- CSS Module 的类名写 **kebab-case**，`vite.config.ts` 已设 `localsConvention: 'camelCaseOnly'`，TSX 里用 `styles.sectionLabel` 访问。
- 不写 `!important`；确需覆盖时用更具体的选择器并注释原因。
- 删除类名前先确认没有引用：`styles.x` / `style.x` 两种写法都要查（`React.memo` 的组件常用 `style`）。

## 4. 工具函数

- 按领域放在 `src/utils/<domain>.ts`：`keyboard` / `platform` / `time` / `number` / `chapter` / `audio` / `trans` / `csvSafe` …
- **`src/utils/index.ts` 只做 re-export**，不再堆实现（v10.6 从 168 行降到 14 行的纯 barrel）。
- 新增工具前先搜一遍是否已有同义实现；重复三次以上再抽公共函数。
- 纯函数优先（可被 `scripts/verify-*.mjs` 直接断言），不要在 util 里读 atom 或 DOM。

## 5. 命名

| 对象 | 规则 | 例 |
| --- | --- | --- |
| 组件文件 | 目录 PascalCase + `index.tsx`；单文件组件 PascalCase | `components/WordChip/index.tsx` |
| hook | `useXxx.ts` | `useWordList.ts` |
| 工具模块 | camelCase 领域名 | `csvSafe.ts`、`letterVisibility.ts` |
| 常量 | UPPER_SNAKE | `DUE_REVIEW_WORDS_STORAGE_KEY` |
| 事件回调 prop | `onXxx`；内部处理函数 `handleXxx` | `onChange` / `handleKeyDown` |
| 脚本 | `verify-*.mjs`（行为断言）、`dsh-*.ps1`（发布链） | `verify-typing.mjs` |

## 6. 测试与验证

| 命令 | 覆盖 |
| --- | --- |
| `npm run test:quality` | tsc + eslint（`--max-warnings 0`，零容忍） |
| `npm run test:stats` | 结果页正确率/分级的纯函数断言 |
| `npm run test:core` | 309 条核心算法回归（SRS + 自动进阶）+ 确定性 |
| `npm run test:start-level` / `test:pages` / `test:typing` / `test:csv` | CDP 行为断言 |
| `npm run test:visual` | 视觉回归（需先 `npm run dev -- --port 5173 --host 127.0.0.1`） |
| `npm run test:all` | 上面除 visual 外的全部 |

改动的验证要求：

- 改**算法**（`utils/srsRules|autoLevel|memory*`）→ 必须跑 `test:core`；
- 改**页面/组件** → 至少 `test:pages` 或 `test:typing`，涉及样式再加 `test:visual`；
- 改**构建/发布脚本** → 跑 `scripts\dsh-release.ps1 -TestInstall -Smoke`；
- 不允许"只跑 build 就算验证"。

## 7. 提交与发布

- 提交信息：`type(scope): 摘要`，type 取 `feat|fix|refactor|perf|docs|test|build|chore|style`；
  正文写「问题 → 改法 → 验证」，末尾 `Signed-off-by: dsh <dsh@dsh.local>`。
- 每个批次一个 tag（`vX.Y-batchA…`），发布版本一个 tag（`vX.Y.Z`）；tag 与分支一起推送。
- 版本号唯一来源：`local-fork/package.json`；文档里不要写死"当前版本"。
- 本机发布链见 `docs/DSH-FORK.md`；对外说明见 `README.md` 与 `docs/RELEASE-NOTES-v10.md`。

## 8. Electron 侧（`local-fork/electron/`）

- `main.js` / `preload.js` 保持最小：只做窗口、协议、IPC 白名单；
- `enhance/enhance.js` 只允许保留**页面内浮层**（词卡 / 悬停提示 / toast）与无头逻辑；不要再加整页 UI，
  设置与工具一律做成 `Setting/` 下的 React 面板；
- 拼进 `innerHTML` 的用户数据必须过 `esc()`；
- 新增 IPC 通道要同时改 preload 白名单与主进程 handler，不允许 `ipcRenderer` 直通渲染进程任意模块。

## 9. 桌面能力的用法

- React 侧**只能**通过 `src/utils/desktop.ts` 访问桌面能力：
  `desktop()` 拿 IPC（`window.qwertyEnhance`），`runtime()` 拿无头逻辑（`window.qzRuntime`），`isDesktop()` 决定是否渲染；
- 不允许在组件里直接写 `window.qwertyEnhance` / `window.qzRuntime`（`grep` 应为 0，本文件除外）；
- 桌面专属页签在 `SETTING_TABS` 上标 `desktopOnly: true`，网页版自动过滤；
- 滑块类设置：`onChange` 只做预览（`preview`），`onValueCommit` 才落盘（`patch`），避免拖动时高频写设置文件；
- 桌面运行时可能晚于页面就绪（注入顺序），调用点必须容忍返回 `null`，不要假设一定存在；
- 设置页签不要给 `Tab.Panel` 加 `unmount`：Headless UI 会注销 Panel 并重算选中索引，切换时可能落到相邻页；
  需要延迟挂载用 `LazyPanel`（首次激活后保持挂载）。
