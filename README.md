<div align=center>
  <img src="src/assets/logo.svg" width="96" alt="Qwerty Learner Plus" />
</div>

<h1 align="center">Qwerty Learner Plus</h1>

<p align="center">
  为键盘工作者设计的单词记忆与英语肌肉记忆锻炼软件 —— <b>dsh 维护的非官方分支</b>
</p>

<p align="center">
  <a href="./README.en.md">English</a> ·
  <a href="./docs/QUICKSTART.md">快速开始</a> ·
  <a href="./FORK-NOTICE.md">分支声明</a> ·
  <a href="./docs/DSH-FORK.md">技术文档</a>
</p>

> [!IMPORTANT]
> 本仓库是 [Qwerty Learner](https://github.com/RealKai42/qwerty-learner)（GPL-3.0）的**非官方分支**，由 dsh 维护，
> 与上游作者、维护者**没有隶属、委托或背书关系**。上游基线 commit `1182426`，本地分支 `dsh-local-v8`。
> 上游版本**已冻结**，本分支不跟随官方更新。首次使用前请读 [FORK-NOTICE.md](./FORK-NOTICE.md)。

## 这是什么

把「背单词」变成「打字」：看着释义敲出拼写，错误即时反馈，正确率、WPM 与每个字母的错因都被记录下来，
再由记忆曲线决定每个词下次什么时候出现。本分支在上游基础上重做了**出词与复习调度**，并补了一个
桌面外壳（Electron）用来做浏览器端做不了的事（本地备份、离线发音缓存、剪贴板查词等）。

## 相对上游的主要改动

| 方向 | 上游 | 本分支 |
| --- | --- | --- |
| 出词方式 | 按词库章节顺序推进 | **动态出词**：每次答完按记忆曲线挑下一个词，跨词库按词去重 |
| 复习调度 | 固定间隔 | **SRS / 艾宾浩斯**：`memoryLadder.ts` + `srsRules.ts`，错答降档、快答升档、时钟回拨保护 |
| 进度组织 | 手选词库 + 章节 | **自动进阶**：13 级学习路径（小学→初中→高中→四级→六级），掌握度达 85% 自动进下一级 |
| 起点 | 从第一章开始 | **首启词汇起点选择**：没学过 / 初中 / 高中 / 四级 / 六级，选完立即生效，可在词库页随时改 |
| 主流程 | 章节选择页 | 无章节主流程，进入即练；复习、错题各成一路 |
| 可靠性 | — | 本地记忆数据表、备份/恢复、时钟回拨纠正、脏数据迁移、写入失败可见 |
| 外壳 | 仅网页 | **Electron 增强外壳**：托盘、快捷键、本地备份、离线发音缓存、剪贴板查词（默认关） |
| 界面 | 含捐赠/推广/友链 | **去营销 UI**：移除捐赠入口、社区二维码、统计脚本；保留分享 / 导出 / 请求词库 |
| 工程 | yarn，无门禁 | **npm + lockfile**、`engines`、质量门禁、发布/回滚脚本、CDP 冒烟与行为验证 |
| 文档 | 单份 README | 分支声明、技术文档（中/英）、快速开始、第三方许可、审计闭环、发布说明 |

完整清单见 [docs/DSH-FORK.md](./docs/DSH-FORK.md)。

## 快速开始

需要 Node 18–22 与 npm ≥ 9：

```bash
npm ci          # 严格按 package-lock.json 安装，可复现
npm run dev     # http://localhost:5173
```

生产构建 `npm run build`（产物在 `build/`）。桌面端打包、双目录安装、回滚，以及**脚本默认路径是作者本机布局**
这件事，都写在 [docs/QUICKSTART.md](./docs/QUICKSTART.md) 里。

## 目录结构

```
src/                     网页端（React 18 + TS + Vite 4）
  utils/                 记忆曲线 / SRS / 自动进阶 / 起点选择等纯逻辑
  pages/Typing/          练习页（出词、判题、统计、设置）
  pages/Analysis/        数据统计（热力图、正确率、WPM）
  pages/ErrorBook/       错题本（分组、分页、详情、导出）
  pages/Gallery-N/       词库与学习起点入口
local-fork/              桌面端外壳源码（Electron 主进程 / preload / 注入式增强 UI）
public/dicts/            385 本词库（体积主要来源，约 79 MB）
docs/                    分支声明、技术文档、快速开始、第三方许可、审计闭环
scripts/                 发布 / 回滚 / 质量门禁 / CDP 冒烟 / 起点选择行为验证
```

## 开发与验证

| 命令 | 作用 |
| --- | --- |
| `npm run test:quality` | `tsc --noEmit` + `eslint src --max-warnings 0`（CI 同款） |
| `npm run test:local` | CDP 冒烟 11 项（需先启动带 `--remote-debugging-port=9472` 的实例） |
| `npm run test:start-level` | 起点选择行为验证 21 项（首启弹窗 → 选档 → 出对应词 → 重启保持 → 词库页修改 → 老用户不打扰） |
| `npm run test:pages` | 页面级回归 17 项（错题本排序/详情/Esc/删除取消、设置面板、脏 payload 不白屏） |
| `npm run test:csv` | 错题本 CSV 导出公式注入防护 14 项断言 |
| `npm run quality` | PowerShell 质量门禁（tsc + eslint + 核心回归） |
| `scripts/dsh-release.ps1` | 打包 asar / 测试安装 / 隔离冒烟 / 双目录安装 |
| `scripts/dsh-rollback.ps1` | 回滚到上一个版本（回滚前自动存 redo 点） |

## 数据、隐私与联网

- 学习记录、记忆曲线、备份都在本机（`%APPDATA%\qwerty-learner-plus`），不上传。
- 桌面端**遥测默认关闭**；网页构建默认开启（与上游一致）。
- 「在线释义 / 整句翻译」**默认开启**，会把查询的单词或句子发往 `dict.youdao.com`、`api.dictionaryapi.dev`、
  `api.mymemory.translated.net`、`translate.googleapis.com`；发音音频来自 `dict.youdao.com`。
  不需要可在设置里关闭 `onlineLookup`。完整披露见 [FORK-NOTICE.md §6.9](./FORK-NOTICE.md)。

## 许可与署名

- 代码：**GPL-3.0**，见 [LICENSE](./LICENSE)。上游版权归 RealKai42 及贡献者；本分支的修改由 **dsh** 完成并署名。
- 词库与图标：来源与许可见 [docs/THIRD-PARTY.md](./docs/THIRD-PARTY.md)，版权归各自原始来源。
- 上游 README 原文存档：[docs/UPSTREAM-README.md](./docs/UPSTREAM-README.md)（英/日文版同目录）。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/QUICKSTART.md](./docs/QUICKSTART.md) | 环境要求、最少命令、桌面端、常见问题 |
| [FORK-NOTICE.md](./FORK-NOTICE.md) | 分支声明、GPL 义务、隐私与联网披露、已知限制 |
| [docs/DSH-FORK.md](./docs/DSH-FORK.md) | 技术实现（自动进阶、SRS、桌面端增强、安全基线） |
| [docs/AUDIT-CLOSE.md](./docs/AUDIT-CLOSE.md) | 发布前审计的逐条闭环记录（修复 / 接受风险 / 无法处理） |
| [docs/REFACTOR-LOG.md](./docs/REFACTOR-LOG.md) | v10 重构逐条记录：问题 / 根因 / 修复 / 验证 / 风险 + 遗留清单 |
| [docs/RELEASE-NOTES-v10.md](./docs/RELEASE-NOTES-v10.md) | v10.0.0 发布说明 |
| [docs/UPSTREAM-PR-DRAFT.md](./docs/UPSTREAM-PR-DRAFT.md) | 可直接提交上游的 issue / PR 文稿（署名 dsh） |
| [docs/REFACTOR-LOG.md](./docs/REFACTOR-LOG.md) | v10 重构逐条记录：问题 / 根因 / 修复 / 验证 / 风险 + 遗留清单 |
| [docs/RELEASE-NOTES-v10.md](./docs/RELEASE-NOTES-v10.md) | v10.0.0 发布说明 |
| [docs/UPSTREAM-PR-DRAFT.md](./docs/UPSTREAM-PR-DRAFT.md) | 可直接提交上游的 issue / PR 文稿（署名 dsh） |
| [docs/THIRD-PARTY.md](./docs/THIRD-PARTY.md) | 第三方词库与图标来源、许可 |
| [docs/Electron-EOL.md](./docs/Electron-EOL.md) | Electron 运行时版本与 EOL 记录 |
| [docs/Backup-Restore.md](./docs/Backup-Restore.md) | 备份与恢复说明 |

## 已知限制

- 词库体积大（约 79 MB），clone 较重；由上游数据量决定。
- SRS / 自动进阶的 309 条回归脚本**不在本仓库**（位于作者本地审计目录），公开用户无法复跑，只能跑
  `test:quality` 与冒烟。
- `scripts/*.ps1` 的默认路径是作者本机布局，他人使用需用 `QZ_*` 环境变量覆盖（见 QUICKSTART）。
- 仓库为浅克隆，无法在本地核验上游历史（影响第三方词库的来源追溯，见 THIRD-PARTY）。
- `Setting/SoundSetting.tsx`、`WordPanel/Word/index.tsx` 仍是较大的单文件，拆分计划见发布说明的遗留清单。
