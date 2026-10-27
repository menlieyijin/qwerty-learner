# Release Notes — v9.11（含 v9.10）

| 项 | 值 |
| --- | --- |
| 应用版本 | `1.0.0-enhanced-v9.11` |
| 分支 | `dsh-local-v8` |
| Tag | 尚未打（建议 `v9.11-dsh-local`；v9.10 为中间版本，不打 tag） |
| 仓库 | [menlieyijin/qwerty-learner](https://github.com/menlieyijin/qwerty-learner)（非官方分支） |
| 上游基线 | `RealKai42/qwerty-learner` @ `1182426f2bd0a28c95302c33f9e19136b1262a70` |
| 许可证 | GNU GPL v3.0（见根目录 `LICENSE`） |
| 发布日期 | 2026-10-28 |
| 作者署名 | `dsh <dsh@dsh.local>` |
| 提交 | v9.10 `8767c15`、v9.11 `27f73e1` |

> 本版本包含两批改动：**v9.10** 修打字判定里的分隔符（空格 / `-` / `/`），**v9.11** 改自动进阶的毕业线与掺入曲线。v9.10 是中间版本（构建两次后即被 v9.11 覆盖），**其全部内容都包含在 v9.11 里**，装 v9.11 不需要先装 v9.10。分支声明与 GPL 合规见 [`FORK-NOTICE.md`](../FORK-NOTICE.md)，技术细节见 [`DSH-FORK.md`](DSH-FORK.md)。

## 1. 概览

| 版本 | 一句话 | 影响面 |
| --- | --- | --- |
| v9.10 | 同一位置上空格、`-`、`/` 视为等价，`t-shirt` 打 `t shirt` 不再判错 | 打字判定（仅 en/de 且非程序类词库）；不改数据表、不改出词 |
| v9.11 | 本级掌握 70% 起按 10%→30% 掺入下一级词；毕业线 90%→85% | 自动进阶与动态出词（仅 `auto` 模式）；不改数据表 |

两批合起来解决的问题：

1. **判定过严**：词库把同一个复合词写成 `t-shirt`、`a/an`、`ice cream` 三种形式，用户习惯一律打空格，于是被记成错词，错 4 次才能 Skip；反向打 `-` 也一样判错。
2. **进阶卡在死区**：本级"已见 100% 但掌握不足 90%"时没有新词可出，出词全落到到期池。100 词级别、80% 正确率的实测在第 21 天进入死区，此后 29 天、580 次取词只出现 2 个新词，同一批词被反复抽 15~19 次。

## 2. 详细变更

### 2.1 v9.10：分隔符在判定期等价（`8767c15`）

**改动位置**

- `src/pages/Typing/components/WordPanel/components/Word/displayWord.ts`：新增 `SEPARATOR_CLASS`（`' '`、`'␣'`、`'-'`、`'/'`）、`isSeparatorChar`、`charsMatch(input, expected, isIgnoreCase)`、`isSeparatorEquivalenceEnabled(language, languageCategory)`。
- `src/pages/Typing/components/WordPanel/components/Word/index.tsx`：唯一判定点接入（`allowSepEquiv`），判定由严格 `===`（仅大小写放宽）改为比较期等价。

**为什么放在比较期**

归一化只影响展示：把 `/` 归一成 `␣` 会让 `a/an` 显示成 `a␣an`（语义错），还会改变 `displayWord` 的字符内容，污染 `letterMistake` 记下的期望字符与结果页导出。改为"字符是否算相同"的放宽后，长度与下标保持 1:1 —— `t shirt` 与 `t-shirt` 同为 7 位，落库 key、错词下标、导出数据全部不变。

**等价类与生效范围**

- 等价类只有：普通空格、`EXPLICIT_SPACE`（归一化后的 `␣`）、`-`、`/`。
- 不含 `_` `.` `'` `&`：`_` 只出现在程序类词库（`languageCategory=code`），`.` 是缩写标记（`a.m.`），`'` 是词内撇号（`don't`），`&` 是实义符号（`AT&T`）。若与空格等价，`a.m.` 打 `a m`、`dont` 打 `don't` 都会被放过。
- 只在 `language ∈ {en, de}` 且 `languageCategory !== 'code'` 时生效：romaji 的 `-` 是长音符（`taima-`），程序类词库的 `-` `/` `_` 是语法字符。

**数据依据**（`public/dicts` 全量扫描，385 个词库 / 457,031 个词）

| 字符 | 含该字符的词条数 | 说明 |
| --- | --- | --- |
| `-` | 3,301 | `T-shirt`、`re-enter`、`and/or`… |
| `/` | 359 | `a/an`、`and/or`… |
| `_` | 73 | 全部落在程序类词库（`python-*`、`rust-*`、`js-*`、`linux-command`、`OI_XCPC` 等），已被 `languageCategory=code` 排除 |

### 2.2 v9.11：70% 掺入 + 85% 毕业线（`27f73e1`）

**新增常量（`src/utils/autoLevel.ts`）**

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `MASTERY_RATIO` | **0.85**（原 0.90） | 毕业线：已见 100% 且掌握率 ≥ 85% 即升级 |
| `MIX_START` | 0.70 | 掌握率到此开始掺入下一级词 |
| `MIX_FULL` | 0.85 | 掺入比例封顶点（与毕业线对齐） |
| `MIX_MIN` | 0.10 | 70% 时的掺入概率 |
| `MIX_MAX` | 0.30 | 85% 及以上的掺入概率 |
| `MIX_MIN_REQUIRED` | 20 | required < 20 的小级别不掺入 |
| `MIX_WINDOW_CAP` / `MIX_WINDOW_SIZE` | 6 / 20 | 会话滑动窗口：最近 20 次取词最多 6 次掺入 |

`getMixRatio(mastered, required)` 为纯函数：`m < 0.70 → 0`；`0.70 → 0.10` 起线性上升；`m ≥ 0.85 → 0.30`；`required < 20`、`required = 0`、末级（无下一级）→ `0`。采样：70% → 0.10、75% → 0.1667、80% → 0.2333、84% → 0.2867、85% 及以上 → 0.30。

**两个封顶必须恒等**：`MIX_MAX === MIX_WINDOW_CAP / MIX_WINDOW_SIZE`（0.30 === 6/20），门禁断言 `B-19.capAligned` 盯着这条不变式——只改一边会让概率上限永远达不到。

**出词注入（`src/utils/memory.ts`）**

- 新增 `pickPreviewWord()`：从 `LEARNING_PATH[index+1]` 的未学词里抽 1 个（已排除 suspended、按词归一化去重、排除最近窗口、按文件顺序取前 20 个再随机）。
- 注入位置：**错词 requeue 之后、到期兜底之前**。下一级加载失败 / 没有新词 / 全部落在 recent 窗口 → 返回 `null` 并 fallthrough，**绝不返回 `null` 给调用方**。
- `previewBudget <= 0` 或 `mix <= 0` 时**不掷骰**，保证既有确定性断言的随机序列不位移。
- `PickResult.preview` 标记本次是否掺入词；顶栏级别仍显示**本级**进度，掺入词不推进 `levelId`、不参与本级完成判定。

**会话限流（`src/pages/Typing/hooks/useWordList.ts`）**：滑动窗口 20 次取词最多 6 个掺入词（6/20 = 30%，与 `MIX_MAX` 恒等）。

**面板文案（`local-fork/electron/enhance/enhance.js`）**：升级条件由"掌握 ≥90%"改为"掌握 ≥85%（v9.11 由 90% 下调）"，并说明 70% 起按 10%→30% 掺入下一级新词（只提前尝鲜，不影响本级毕业）。

**量化（`audit/mix70-sim.mjs --mode=all`，3 个种子取均值）**

| 场景 | v9.9 基线 | v9.11 | 变化 |
| --- | --- | --- | --- |
| S1（100 词 / 每天 20 次 / 80% 正确）升级日 | 38.00 | **40.33** | +6.1% |
| S2（392 词 / 每天 60 次 / 85% 正确）升级日 | 44.33 | **44.33** | 持平 |
| 死区最后 200 次取词中"下一级词"占比（S1 / S2） | 0.3% / 0% | **46.5% / 29.2%** | 死区不再空转 |

机理：掺入降低本级复习密度 → 复习越密集 lapse 越多，稀疏后稳态掌握率反而更高。所以封顶值按实测选（0.30 + 6/20），不能按"掺入越少毕业越快"的直觉选。长期实测掺入率约 22.8%（名义 28.7%）——窗口是硬约束，额度用完后要等旧掺入词滑出窗口才恢复。

## 3. 升级与回滚

### 3.1 升级

- **数据兼容**：两批改动都不涉及数据表结构、`localStorage` 键或迁移逻辑，无需迁移；旧数据直接可用。
- **从 v9.9 / v9.10 升级**：按 [`FORK-NOTICE.md`](../FORK-NOTICE.md) 第 6.2 节流程安装即可（`dsh-release.ps1 -TestInstall -Smoke` 验证后再 `-Install`）。
- **v9.10 可跳过**：v9.10 是中间版本（构建两次，最终产物 `staging-1.0.0-enhanced-v9.10-20261028-002149`），内容已包含在 v9.11 中，直接装 v9.11 即可。

### 3.2 回滚

```powershell
pwsh -File scripts/dsh-rollback.ps1 -List   # 查看可用备份
pwsh -File scripts/dsh-rollback.ps1         # 回滚到与当前版本不同的最近备份
```

可用回滚点（作者本机）：

| 回滚点 | 路径 |
| --- | --- |
| v9.10（安装 v9.11 前） | `D:\整理\Qwerty备份\app.asar.before-1.0.0-enhanced-v9.11-20261028-004223.asar` |
| v9.9（安装 v9.10 前） | `D:\整理\Qwerty备份\app.asar.before-1.0.0-enhanced-v9.10-20261028-002149.asar` |

行为差异提示：回滚到 v9.9 后，`t-shirt` 打空格会重新被判错，自动进阶的毕业线回到 90%、死区会再次出现。已写入的学习记录不受影响（无 schema 变更）。

## 4. 验证清单（作者本机）

| 项目 | 结果 |
| --- | --- |
| `tsc --noEmit` | 0 error（v9.10、v9.11 各一次） |
| `eslint src --max-warnings 0` | 0 error / 0 warning |
| 核心算法回归 | **309/309**（120 SRS + 189 自动进阶；v9.9 为 253 = 120 + 133） |
| 确定性 | determinism pass（两个 sim 各跑两遍逐字节一致，exit 0/0） |
| 分隔符判定（真实源码打包） | `wordmatch-src.mjs` **29/29** |
| 判定等价状态机 | `word-judgment-sim.mjs` **42/42**（原 32） |
| 掺入量化 | `mix70-sim.mjs --mode=all`（S1/S2 × 3 种子） |
| CDP 冒烟 | **11/11（手工执行）**：脚本内 `-Smoke` 在本机被 GPU 崩溃拦住（`NO_PAGE`），改用 `--disable-gpu --no-sandbox` + 隔离 profile 手工跑同一脚本：v9.10 测试安装 11/11、v9.11 测试安装 11/11、**v9.11 已安装版 11/11**（`logs\smoke-1.0.0-enhanced-v9.11-installed.txt`） |
| 双目录安装 | `app.asar` 哈希一致、安装日志完整 |
| 分隔符数据扫描 | 385 词库 / 457,031 词：`-` 3,301、`/` 359、`_` 73（全部为程序类词库） |

### 4.1 交付产物（作者本机构建记录）

| 项 | v9.11 | v9.10 |
| --- | --- | --- |
| `app.asar` 大小 | 86,402,263 B | 86,400,986 B |
| `app.asar` SHA256 | `831E3E923288E8652B95EC56EBE6389308C18494347746E71C10BC8E85A32F36` | `92979793E2F51E1A1CFBB620B41E967F44241DE53C5CBCDF002FDB7C6AC95CF0` |
| 构建目录 | `QwertyRelease\staging-1.0.0-enhanced-v9.11-20261028-004223` | `QwertyRelease\staging-1.0.0-enhanced-v9.10-20261028-002149` |
| 安装日志 | `logs\qwerty-1.0.0-enhanced-v9.11-installed-20261028-004223.json` | `logs\qwerty-1.0.0-enhanced-v9.10-installed-20261028-002149.json` |

> 不同机器重新构建的产物哈希必然不同，上面的哈希不能用于校验他机构建。

## 5. 已知问题

1. **非官方分支**：不受上游支持；上游更新不会自动进入本分支。
2. **分隔符等价只覆盖 en/de**：`romaji` / `hapin` / `kk` / `ja` 与全部程序类词库仍按严格字符比较（romaji 的 `-` 是长音符，`code` 的 `-` `/` `_` 是语法）。`_` `.` `'` `&` 永不参与等价。
3. **掺入不改级别**：掺入的下一级词只在练习流里出现，`levelId` 不变、顶栏级别不动；不计入本级完成判定，但会正常写入 SRS 记录（后续作为到期词复习）。
4. **窗口比名义值更严**：长期实测掺入率约 22.8%（名义 28.7%），因为是"最近 20 次最多 6 次"的硬窗口，额度耗尽后要等旧掺入词滑出窗口。
5. **源码注释里的小版本标号曾偏差**：`useWordList.ts` / `memory.ts` / `autoLevel.ts` 原把"70% 掺入"标为 `v9.10`（开发轮次标号），已统一改为 `v9.11`；注释不参与产物（vite 压缩已剔除中文注释），因此已安装的 asar 与修正后的源码行为一致。
6. **构建元数据 gitSha 略滞后**：`release-info.json` 是在提交前生成的，v9.11 产物记的是 `8767c15`（v9.10 的提交），v9.10 产物记的是 `8ae7577`（文档提交）。真实代码提交以本文档头的 `8767c15` / `27f73e1` 为准。
7. **CDP 冒烟是手工执行的**：本机（Windows + 远程/沙箱会话）Electron GPU 进程启动即崩（`gpu_process_host: exit_code=-1073741819` → `GPU process isn't usable`），脚本内 `-Smoke` 直接 `NO_PAGE`。因此 v9.10/v9.11 的安装未带 `-Smoke`（安装日志 `smoke=false`），改为手工以 `--disable-gpu --no-sandbox` 起隔离 profile 跑同一 `scripts/dsh-smoke.mjs`：v9.10 测试安装、v9.11 测试安装、v9.11 **已安装版**（`D:\bangong\QwertyLearner-Plus`）均 **11/11**，日志 `logs\smoke-1.0.0-enhanced-v9.11-installed.txt`。属环境问题（GPU 不可用），不是产品缺陷；普通桌面会话下仍建议照常 `-TestInstall -Smoke`。
8. **回归脚本未随仓库发布**：309 断言、确定性检查、掺入量化脚本均位于作者本机审计目录，公开仓库无法一键复现（详见 `FORK-NOTICE.md` 第 7 节）。
9. **仅 Windows 实测**：桌面外壳未验证 macOS / Linux。
10. **无代码签名 / Electron EOL**：Windows SmartScreen 可能提示未知发布者；Electron 43.8.3 于 2027-01-05 EOL。
11. 其余限制（词库版权、备份一致性、第三方在线服务、数据兼容性等）见 [`FORK-NOTICE.md`](../FORK-NOTICE.md) 第 7 节。

## 6. 后续

- **观察实际毕业速度**：85% 毕业线 + 70% 掺入是按仿真选的参数，真实词库与真人正确率可能与 S1/S2 有偏差；若实际体验仍偏慢，优先调 `MIX_MAX` 与 `MIX_WINDOW_CAP`（两者必须同步改），而不是继续降毕业线。
- **掺入词的学习效果**：当前掺入词只"提前尝鲜"，尚无"掺入词是否真的学得更牢"的对照数据；后续可用到期池的 lapse 率做回看。
- **上游贡献**：分隔符等价已单独整理为可上游化的最小补丁（只做这一件事，不夹带 fork 专属功能，署名 dsh 并带 `Signed-off-by`）；该补丁不在本仓库内，也未 push / 未开 PR。
- 保持上游冻结；如需吸收上游修复，逐条评估 + 完整回归，不整包合并。
- 视情况整理可公开的回归脚本子集，使 309 断言门禁能在干净 clone 上复现（当前未包含）。

## 7. 致谢

感谢 **RealKai42** 与 Qwerty Learner 全体贡献者提供的基础项目与词库体系；感谢上游词库/数据来源与第三方释义、发音服务；感谢 Electron、Chromium、React、Vite、Dexie、Tailwind CSS 等开源项目；本分支的开发、审计与文档工作使用了 **DeepSeek Harness（dsh）** 工具链（工具署名，不代表官方背书）。

---

*相关文档：[FORK-NOTICE.md](../FORK-NOTICE.md) · [DSH-FORK.md](DSH-FORK.md) · [DSH-FORK_EN.md](DSH-FORK_EN.md) · [RELEASE-NOTES-v9.9.md](RELEASE-NOTES-v9.9.md) · [Backup-Restore.md](Backup-Restore.md) · [Electron-EOL.md](Electron-EOL.md)*
