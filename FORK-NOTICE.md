# 本地魔改说明（Local Fork Notice）

本项目是 Qwerty Learner 的**本地魔改版本**，仅供个人在本机学习使用，不对外分发。

## 上游来源与署名

| 项 | 内容 |
| --- | --- |
| 上游项目 | Qwerty Learner — https://github.com/RealKai42/qwerty-learner |
| 上游基线 | commit `1182426f2bd0a28c95302c33f9e19136b1262a70` |
| 上游作者/版权 | 归原作者及贡献者所有（见 `LICENSE`，**GPL-3.0**） |
| 本地修改者 | **dsh（DeepSeek Harness）** |
| 本地修改时间 | 2026-10-21 ~ 2026-10-25（v1~v7.1），2026-10-25 起 v8 |
| 本地仓库 | `D:\整理\qwerty-src`（分支 `dsh-local-v8`，仅本地） |

## 版权与许可

- 上游代码采用 **GNU GPL v3.0**；本仓库作为其衍生作品，同样按 GPL-3.0 处理，原始版权声明与 `LICENSE` 文件保持不动。
- 本仓库的本地修改部分由 **dsh** 完成，提交署名均为 `dsh <dsh@dsh.local>`，不冒用上游作者身份，也不向官方仓库提交任何内容。
- 未对外分发；如未来分发，需遵守 GPL-3.0（提供源码、保留版权声明等）。

## 上游策略：冻结，不跟随官方更新

> **不要 `git fetch` / `git pull` / `git rebase` / 合并任何上游官方更新，也不要升级项目依赖。**

原因：本地对官方源码做了较大改动（记忆曲线调度、动态出词、自动词汇水平、去章节、Electron 适配等），官方后续改动可能与本地魔改冲突，导致程序报错。上游提交仅作为**历史基线**保留在本仓库中，用于溯源与署名。

如需引入官方修复，必须单独立项评估、逐条 cherry-pick 并完整回归测试，不能整包合并。

## 本地改动概览（相对上游 1182426）

- 记忆曲线调度：`src/utils/memory.ts`、`memoryLadder.ts`、`refreshMarker.ts`、`learningPath.ts`
- 动态出词 / 自动词汇水平 / 跨词库去重 / 随机回顾：`src/pages/Typing/hooks/useWordList.ts`、`store/index.ts`、`WordPanel/*`
- 无章节练习、HashRouter、相对路径、Electron 适配：`src/index.tsx`、`src/pages/Typing/*`、`src/components/*`
- 数据库：`src/utils/db/index.ts`、`record.ts`（新增 `memoryRecords` 表，旧表保留）
- 词库资源：补回 `public/dicts/` 下 5 本旧词库与图标（来自官方旧版本地构建，仅本地使用）
- 增强外壳（Electron）：`D:\整理\QwertyPackV7\electron\` —— 托盘/快捷键/备份/免费释义/发音缓存等，由 dsh 在本地实现
