# AUDIT.md 逐条闭环表（`D:\整理\publish-audit\AUDIT.md`）

核对时间：2026-10-29 00:05 ｜ 基线：v9.15（`1fb2b0f` + 文档）
判定口径：**已修**（本次或此前版本已改，附证据）/ **接受风险**（不改，附理由与披露位置）/ **无法处理**（受环境或指令限制）。

## 严重（P0）

| # | 事项 | 状态 | 证据 / 处理 |
| --- | --- | --- | --- |
| S1 | 5 本第三方词库 + 2 图标来源与许可 | **已修** | `docs/THIRD-PARTY.md` 已逐本列来源 URL + 许可（NAWL CC BY-SA 4.0、AWL 需署名、google-10000/20000 组合许可等），并记录 `af38f75` 为本地补充提交 |
| S2 | FORK-NOTICE 称“不对外分发” | **已修** | `grep -c "不对外分发\|仅本地使用" FORK-NOTICE.md` = 0；已改为非官方分支声明并写明 GPL 义务 |
| S3 | 引用的 3 个文档不存在/未跟踪 | **已修** | `docs/DSH-FORK.md`、`docs/DSH-FORK_EN.md`、`docs/RELEASE-NOTES-v9.9.md` 均已入库（另新增 v9.11/v9.15 说明） |
| S4 | 浅克隆 + 远端指向上游 | **无法处理（本次）** | `git rev-parse --is-shallow-repository` 仍为 `true`；`--unshallow` 会拉取上游全部历史，与“不拉取任何上游代码”的指令冲突，未执行。发布前需你确认后单独执行；清单已写入 `docs/DSH-FORK.md` 已知限制 |

## 中（P1）

| # | 事项 | 状态 | 证据 / 处理 |
| --- | --- | --- | --- |
| M1 | fork 上 Actions 误触发/误部署 | **已修** | `deploy-pages.yml:11` 与 `e2e.yml:9` 已有 `if: github.repository == 'RealKai42/qwerty-learner'` 守卫 |
| M2 | 打包版可加载任意 `VITE_DEV_SERVER_URL` | **已修** | `main.js:1536` 注释与实现：仅“未打包 + 回环地址”生效 |
| M3 | 在线查词默认开启，内容发往第三方 | **已修（披露）** | 新增 `FORK-NOTICE.md §6.9 联网与隐私`：列明 4 个域名、发送内容（单词/句子）、关闭方式（`onlineLookup`）；默认值不变（改默认需产品决策） |
| M4 | 发布用 `npx --yes` 拉未固定版本 asar | **已修** | `dsh-release.ps1:209` → `npx --yes @electron/asar@4.3.1`（固定到当前最新 4.3.1） |
| M5 | 脚本默认路径为本机布局 | **接受风险** | 默认值仍是作者布局，但全部支持 `QZ_*` 环境变量覆盖，且 `local-fork/README.md` 已说明；改默认值会破坏本机发布链，暂不调整 |
| M6 | `Signed-off-by` 表述不实 | **已修** | 文案已改为“**部分提交**带 trailer（当前 17 个）”，与实际一致 |
| M7 | 删除上游捐赠/推广 UI 的 GPL 说明 | **已修** | `docs/DSH-FORK.md` “去营销 UI”小节 + FORK-NOTICE 4.6 说明“删除营销 UI/远程二维码，版权与署名保留” |
| M8 | 英文/日文 README 无 fork 声明 | **已修** | `docs/README_EN.md:1`、`docs/README_JP.md:1` 均有非官方分支声明（v9.18 起两份上游存档改名为 `docs/UPSTREAM-README_EN.md` / `docs/UPSTREAM-README_JP.md`） |

## 低（P2）

| # | 状态 | 处理 |
| --- | --- | --- |
| L1 mixpanel 公开 token | 接受风险 | 继承上游的公开 client token，非密钥；§6.9 已披露遥测默认关闭 |
| L2 CSP 解析失败回退 `unsafe-inline` | 接受风险 | 实测走 sha256 分支；改 fail-closed 有白屏风险，需单独批次验证 |
| L3 外链交系统浏览器 | 接受风险 | 现有 deny+openExternal 已被审计判为可接受 |
| L4 `legacy_flows` 目录 | **已修** | 本次 `git rm -r .github/legacy_flows`（inactive、含 secrets 名称） |
| L5 `.claude/settings.local.json` | **已修** | 本次删除（个人工具配置） |
| L6 淘宝旧 registry | **已修** | `install.ps1/sh` 已改 `registry.npmmirror.com` |
| L7 Tauri 旧脚手架 | 接受风险 | 不参与发布链；`docs/Electron-EOL.md` 已说明 |
| L8 过期数字/本机措辞 | **已修** | `local-fork/README.md` 断言数 253/248 → **309（120+189）** |
| L9 浅克隆 | 同 S4 | 同上 |
| L10 全局 `insteadOf` 代理 | 无法处理（环境） | 属 `.git/config` 本机配置，非仓库内容；发布前手动 unset |

## 结论

- **22 项中：已修 14 项、接受风险 6 项、无法处理 2 项（S4/L9 同一事、L10 环境）**。
- 剩余阻塞公开发布的实质项只有 **S4（浅克隆）**：需要一次 `git fetch --unshallow`，该动作会拉取上游历史，按当前指令未执行，等你确认。
- 接受风险的 6 项均已在文档中披露（FORK-NOTICE §6.9 / local-fork/README / DSH-FORK 已知限制），不属“未处理”。
