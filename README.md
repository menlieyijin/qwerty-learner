<div align=center>
<img  src="src/assets/logo.svg"/>
</div>

<h1 align="center">
  Qwerty Learner
</h1>

<p align="center">
  <a href="./docs/README_EN.md">English</a>
  <a href="./docs/README_JP.md">日本語</a>
</p>

<p align="center">
  为键盘工作者设计的单词记忆与英语肌肉记忆锻炼软件
</p>

> [!IMPORTANT]
> **本仓库是 dsh 维护的非官方分支（non-official fork），不是上游官方仓库，与上游项目及其作者、维护者没有隶属、委托或背书关系。**
>
> - 上游：[RealKai42/qwerty-learner](https://github.com/RealKai42/qwerty-learner)（基线 commit `1182426`，GPL-3.0）；本分支：`dsh-local-v8`，发布在 [menlieyijin/qwerty-learner](https://github.com/menlieyijin/qwerty-learner)。
> - 相对上游的主要改动：艾宾浩斯记忆曲线 / SRS 调度、动态出词、自动进阶、无章节主流程、新增本地记忆数据表、Electron 增强外壳、去营销 UI、构建 / 回滚 / 质量门禁。上游冻结，不跟随官方更新。
> - 首次使用前请先读 [FORK-NOTICE.md](./FORK-NOTICE.md)（分支声明、GPL 合规、已知限制）与 [docs/DSH-FORK.md](./docs/DSH-FORK.md)（技术细节）；版本说明见 [docs/RELEASE-NOTES-v9.9.md](./docs/RELEASE-NOTES-v9.9.md)。
>

## 本分支做了什么（差异摘要）

| 方向 | 内容 |
| --- | --- |
| 记忆算法 | 艾宾浩斯记忆曲线 + SRS 调度（`src/utils/memoryLadder.ts`、`srsRules.ts`），到期复习与新词按比例掺入 |
| 学习路线 | 13 级自动进阶（小学→初中→高中→四级→六级→高频词），首次打开可选起点，之后自动升级 |
| 练习形态 | 无章节主流程、动态出词、错词重现、跳过与暂停、复习模式 |
| 本地数据 | IndexedDB 记忆记录/错题本，导入导出与备份（含版本校验） |
| 桌面增强 | Electron 外壳：词库更新、剪贴板取词、增强面板（主题/字号/快捷键），遥测默认关闭 |
| 去营销 | 移除上游捐赠/推广 UI 与远程二维码资产（版权与署名保留） |
| 工程 | 发布/回滚/冒烟/质量门禁脚本，309 条核心回归，依赖分层与环检测 |

## 部署

见 [`docs/QUICKSTART.md`](docs/QUICKSTART.md)：开发 2 条命令、构建 1 条命令；桌面版另有发布脚本与环境变量说明。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [`FORK-NOTICE.md`](FORK-NOTICE.md) | 分支声明、GPL 合规、已知限制 |
| [`docs/DSH-FORK.md`](docs/DSH-FORK.md) / [`_EN`](docs/DSH-FORK_EN.md) | 技术细节（中/英） |
| [`README.en.md`](README.en.md) | 本分支英文说明 |
| [`docs/RELEASE-NOTES-v9.15.md`](docs/RELEASE-NOTES-v9.15.md) | 最新发布说明 |
| [`docs/AUDIT-CLOSE.md`](docs/AUDIT-CLOSE.md) | 发布前审计逐条闭环 |
| [`docs/UPSTREAM-README.md`](docs/UPSTREAM-README.md) | 上游 README 原文（溯源用） |
