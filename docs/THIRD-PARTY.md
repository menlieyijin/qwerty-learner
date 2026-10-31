# Third-Party Components & Data（第三方组件与数据）

> 适用范围：本仓库是 [Qwerty Learner](https://github.com/RealKai42/qwerty-learner) 的非官方分支（分支 `dsh-local-v8`；应用版本以 `local-fork/package.json` 为准），整体按 **GNU GPL v3.0** 分发（见根目录 `LICENSE` 与 [`FORK-NOTICE.md`](../FORK-NOTICE.md)）。本文件逐项说明仓库内**第三方代码/数据/资产**的来源与许可，用于公开发布前的合规披露。
>
> **边界声明**：本文件只做来源与许可的**如实披露**，不代表我们已就全部第三方数据取得额外授权，也不声称这些数据属于公有领域；GPL-3.0 覆盖本仓库有权许可的代码，不当然覆盖第三方词表数据。若权利人认为随附方式不妥，请在本 fork 仓库开 issue，我们会移除对应数据文件或改为运行时按需获取。

## 1. 上游代码（GPL-3.0）

| 项 | 内容 |
| --- | --- |
| 项目 | Qwerty Learner — <https://github.com/RealKai42/qwerty-learner> |
| 上游基线 | commit `1182426f2bd0a28c95302c33f9e19136b1262a70`（上游 `master`） |
| 许可 | GNU GPL v3.0（`LICENSE` 与上游逐字节一致，未删除/替换/改写） |
| 本分支关系 | 衍生作品，同样按 GPL-3.0 分发；修改声明见 `FORK-NOTICE.md` 与 `docs/DSH-FORK.md` |

上游代码、上游 README/文档文本、`src/assets/` 中的上游资产按上游 GPL-3.0 处理；上游作者与贡献者的版权声明保持不变。

## 2. 内置词库（`public/dicts/`，共 385 本）

- 其中 **380 本**随上游仓库提供；上游 README 说明词库数据来自 [kajweb/dict](https://github.com/kajweb/dict) 数据集（上游爬取常见词典整理）。
- 词库文件为 JSON，字段结构为 `name` / `trans` / `ukphone` / `usphone` 等；**中文释义与音标由 kajweb 词典数据集管线生成**，与本分支补回的 5 本词库同源。
- 随附方式与上游一致（作为前端静态资源）。词条内容、释义与音标数据的著作权/数据库权利归原始来源（kajweb 及上游词库贡献者）所有；本分支不单独主张这些数据的版权，也不对其再授权。
- 由于 GPL-3.0 不当然覆盖第三方词表/词典数据，具体使用与再分发风险请使用者按原始来源条款自行判断（见第 8 节）。

## 3. 本地补回的 5 本词库

这 5 本词库在 `af38f75 feat(local): 补回旧版本地词库与图标（dsh）` 中作为本地补充加入：

| 文件 | 来源 | 许可 / 使用条件 |
| --- | --- | --- |
| `public/dicts/NGSL.json` | **New General Service List**（Browne & Culligan）— <https://www.newgeneralservicelist.com/> | **CC BY-SA 4.0**（需署名 + 相同方式共享）；CC BY-SA 4.0 与 GPLv3 兼容，本项目整体仍按 GPL-3.0 分发 |
| `public/dicts/NAWL.json` | **New Academic Word List**（同属 NGSL 项目，Browne & Culligan）— <https://www.newgeneralservicelist.com/word-lists> | **CC BY-SA 4.0**（同上，需署名 + 相同方式共享） |
| `public/dicts/AWL.json` | **Academic Word List**（Averil Coxhead, Victoria University of Wellington）— <https://www.wgtn.ac.nz/lals/resources/academicwordlist> | 教育用途免费使用，**需引用/署名**（按来源页说明） |
| `public/dicts/google-10000-english.json` | 基于 **Google Web Trillion Word Corpus**（Linguistic Data Consortium）的词频表（Norvig 版本） | 许可见 <https://github.com/first20hours/google-10000-english/blob/master/LICENSE.md>（LDC license + Norvig MIT + fair use 组合，按该文件说明） |
| `public/dicts/google-20000-english.json` | 同上（google-10000-english 项目的 20000 词版本） | 同上 |

补充说明：

- **来源核验（2026-10-27）**：用 GitHub contents API 核对 `RealKai42/qwerty-learner` 的 `master`、`dev`、`gh-pages` 分支，上述 5 个文件均返回 **404（不存在）**，因此可确认它们是本地补充，而非上游仓库既有文件；其 JSON 结构与上游词库同源（`name/trans/ukphone/usphone` 管线）。
- **来源核验（2026-10-29，完整历史）**：仓库已从浅克隆补全为完整历史（`git rev-parse --is-shallow-repository` → `false`），改用 git 提交历史复核：
  - `git log --oneline upstream-full/master -- public/dicts/{NGSL,NAWL,AWL,google-10000-english,google-20000-english}.json`，结果均为 **0 条提交** —— 上游历史上从未包含这 5 个文件；
  - `git diff --stat 1182426 HEAD -- public/dicts` 只显示这 **5 个文件新增**（共 200,766 行），**没有任何修改或删除** —— 即其余 380 本词库与上游基线逐字节一致，本分支未改动过任何上游词库内容。
- 上述许可信息来自各项目公开页面，本仓库**未随附**各词表的完整许可原文；如需再分发这些词表本身，请以原始来源的许可文本为准。
- 如权利人认为随附方式不妥，请开 issue，我们会**移除对应数据文件**（本地构建可自行补回）。

## 4. 图标与视觉资产

| 文件 | 说明 |
| --- | --- |
| `public/icon.ico`、`public/icon-256.png` | 项目 logo 派生（Q 键键帽风格），源自上游图标设计；上游 README 致谢 [libregd](https://github.com/libregd) 提供图标设计。按 GPL-3.0 随本分支分发。 |
| `src/assets/logo.svg` 等 | 上游视觉资产，按上游 GPL-3.0 保留。 |

## 5. 文档截图

`docs/` 下的截图（`alipay.png`、`coder.png`、`dictation.png`、`kai-fu.png`、`Screenshot.png`）**来自上游 README / 上游仓库**，作为上游内容保留：

- `docs/alipay.png` 是**上游作者的捐赠二维码**，仅作为上游署名/致谢保留；本分支不运营该捐赠入口，也不收集捐赠。
- 若上游更新/移除这些图片，本分支后续会同步处理；版权归上游作者及原图作者。

## 6. 运行时与构建期依赖（不在仓库内）

- **Electron 运行时不在本仓库**：发布产物只有 `app.asar`，运行时使用 Electron 官方预构建二进制（当前 **43.8.3**，MIT 许可）；安装/升级时从 npmmirror 下载二进制并校验 SHA256（见 `docs/Electron-EOL.md`）。
- 仓库内 JS 依赖见根目录 `package.json` / `yarn.lock`，各自遵循其许可证（React、Vite、Dexie、Tailwind CSS 等）。
- `@electron/asar`（MIT）由发布脚本用 `npx` 临时下载，不作为仓库依赖提交；构建可复现性说明见 `FORK-NOTICE.md` / `docs/DSH-FORK.md` 的已知限制。

## 7. 运行时访问的第三方服务（不随附代码/数据）

以下能力在**用户主动使用**时直接访问第三方服务，本仓库不包含其代码或数据：

| 能力 | 域名 | 说明 |
| --- | --- | --- |
| 在线释义/建议词 | `dict.youdao.com` | 有道 suggest 接口 |
| 在线释义 | `api.dictionaryapi.dev` | 开放词典 API |
| 整句翻译 | `api.mymemory.translated.net` | MyMemory 翻译 API |
| 整句翻译 | `translate.googleapis.com` | Google 翻译接口 |
| 发音音频 | `dict.youdao.com/dictvoice` | 有道发音 |
| 遥测（默认关闭） | `api-js.mixpanel.com` / `*.vercel-insights.com` | 代码内为继承上游的**公开 client token**，非密钥；桌面端默认关闭，需显式 opt-in |

各服务的可用性、隐私政策与使用条款由服务方决定；可在设置中关闭在线释义（`onlineLookup`）。

## 8. 使用与再分发提示

1. 本仓库整体按 GPL-3.0 分发；再分发源码或二进制时须保留 `LICENSE`、上游版权声明与修改声明（`FORK-NOTICE.md`）。
2. 词库/词典数据与截图等第三方内容**可能受其原始来源条款约束**，GPL-3.0 不构成对这些内容的再授权；公开分发（含镜像、安装包、在线站点）前请自行评估。
3. 若你是权利人且不希望本仓库随附某文件，请在本 fork 仓库提交 issue（附文件路径与权利依据），我们会移除或改为运行时按需获取。

## 9. 核验方式

```powershell
# 词库总数与新增 5 本的跟踪状态
(Get-ChildItem public/dicts -File).Count                      # 385
git log --oneline --diff-filter=A -- public/dicts/AWL.json     # af38f75（本地补充）

# 上游是否包含这 5 本（需联网，或直接用 GitHub contents API）
#   https://api.github.com/repos/RealKai42/qwerty-learner/contents/public/dicts/NGSL.json?ref=master
#   → 404 Not Found（master / dev / gh-pages 均如此，2026-10-27 核验）

# 许可证原文未改动
git diff --quiet origin/master HEAD -- LICENSE; $LASTEXITCODE  # 0
```
