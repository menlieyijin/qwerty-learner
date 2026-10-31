# 备份 / 导出 / 跨设备恢复说明（Qwerty Learner Plus，dsh 维护）

> 适用版本：v9.6+（本地 fork）。网络：无需联网。文档由 dsh 维护，2026-10-26。

## 1. 结论（先看这里）

| 通道 | 含学习记录<br>(RecordDB) | 含自定义词库库<br>(QwertyPlusDB.dicts) | 含「当前自定义词库」<br>(localStorage.qzCustomDict) | 含外壳设置<br>(enhanced-settings.json) | 跨设备可用 |
| --- | --- | --- | --- | --- | --- |
| **自动备份（每日/手动）目录副本** `%APPDATA%\qwerty-learner-plus\backups\backup-*` | ✅ IndexedDB 目录 | ✅ 同一 IndexedDB 目录 | ✅ Local Storage 目录（LevelDB） | ✅ Preferences + data.json | ⚠️ 仅建议**同机整目录还原** |
| **自动备份里的逻辑快照** `backup-*/data.json` | ✅ | ✅ `customDicts` | ✅ `localStorage.qzCustomDict` | ✅ `settings` | ✅ 可用 |
| **工具 → 数据 → 导出全量数据 JSON** | ✅ | ✅ | ✅ | ✅ | ✅ **推荐跨设备** |
| **官方 设置 → 数据 → 导出/导入数据库**（上游功能） | ✅ | ❌（Dexie 只导 RecordDB） | ❌（localStorage 不在 Dexie 导出里） | ❌ | ❌ 不建议跨设备 |

**一句话**：本 fork 自己的「自动备份 + data.json 逻辑快照 + 导出全量数据 JSON / 导入全量数据」**已经完整覆盖 `qzCustomDict`（当前自定义词库）与 `QwertyPlusDB.dicts`（自定义词库库）**；会丢的只有兼容路径——**上游官方设置里的「导出/导入数据库」只导 Dexie**，不含 localStorage 与外壳设置。

## 2. 数据到底存在哪

| 数据 | 位置 |
| --- | --- |
| 练习记录 / 记忆曲线 / 章节记录 | IndexedDB `RecordDB`（wordRecords / chapterRecords / memoryRecords…） |
| 自定义词库（导入的词表本体） | IndexedDB `QwertyPlusDB.dicts`（key = 词库名） |
| 「当前自定义词库」桥接、自动进阶状态、当前词库/学习模式等页面配置 | localStorage（`qzCustomDict`、`qzAutoLevelState`、`currentDict`、`learningMode`、`state`…） |
| 外壳设置（目标、主题、快捷键、收藏词库、最近词库…） | `%APPDATA%\qwerty-learner-plus\enhanced-settings.json`（导出时以 `settings` 字段包含在 JSON 中） |

## 3. 怎么备份 / 恢复

### 3.1 跨设备（推荐）：导出全量数据 JSON → 导入全量数据

1. 旧设备：`工具 → 数据 → 导出全量数据 JSON`（弹保存框，默认到「文档」）。
2. 新设备：安装同版本 → `工具 → 数据 → 导入全量数据…` → 选该 JSON。
3. 导入流程会自动先备份当前数据，再覆盖 RecordDB、合并/覆盖 QwertyPlusDB.dicts、恢复 localStorage 与外壳设置，然后自动重载。

> 版本要求：导入方应用版本 ≥ 导出方（旧 JSON 缺字段时按缺省处理；高版本新字段不会反向兼容旧版本）。

### 3.2 同机恢复：直接用备份目录（最快）

1. 完全退出应用（托盘 → 退出）。
2. 打开 `%APPDATA%\qwerty-learner-plus\backups\backup-YYYYMMDD-HHmmss\`。
3. **整目录**覆盖 `%APPDATA%\qwerty-learner` 下的 `IndexedDB` / `Local Storage` / `Preferences`（不要只挑单个文件；LevelDB 有 MANIFEST 依赖）。
4. 重新启动应用。

⚠️ 文件级目录副本不建议跨设备手工挑文件复制：LevelDB/IndexedDB 目录是整体结构，跨机合并容易损坏；跨设备请优先用 3.1 的 JSON。

### 3.3 恢复失败/写入不完整的提示

v9.6 起，导入时若某些 localStorage 项写入失败（最常见：超出 `localStorage` 配额，或数据文件来自更高版本），会：
- 在控制台输出 `[QZ] import localStorage failed keys: …`；
- 在界面上提示「导入完成，但 N 项本地配置未写入…」，并延长展示时间到 6 秒（原实现 0.7 秒就重载，警告一闪而过）。

如果提示的是 `qzCustomDict`：说明自定义词库桥接没能写入，请先释放 localStorage 空间（清掉不再用的自定义词库/减少词条）后重试，或改用 3.2 的整目录恢复。

## 4. 自动备份机制（实现说明）

- 主进程 `runBackup()`：`fs.cpSync` 拷贝 `IndexedDB`、`Local Storage` 目录 + `Preferences` 文件，同时向渲染端请求逻辑快照写 `data.json`（RecordDB 全 store + QwertyPlusDB.dicts + 全量 localStorage + 外壳设置）。
- 位置：`%APPDATA%\qwerty-learner-plus\backups\backup-<时间戳>`，保留最近 7 份；每天自动一次，面板「立即备份」/托盘菜单可手动触发。
- `data.json` 单份上限 64MB；超过时只记日志并使用目录副本（正常学习数据远小于此）。
- 快照获取有 8 秒超时；超时/失败不影响目录副本备份（`BACKUP-README.txt` 会标明“本份备份未能获取逻辑快照”）。

## 5. 已知限制

- 官方「设置 → 数据 → 导出/导入数据库」= 上游 `src/utils/db/data-export.ts` 的 Dexie 导出，**只含 RecordDB**；跨设备恢复自定义词库/外壳设置请用本 fork 的「导出全量数据 JSON」。本 fork 不改上游该页面，只在「设置 → 关于 → 打开增强工具」里给出提示。
- 自动备份目录副本是在应用运行中拷贝的，IndexedDB 的 LevelDB 可能处于写入中（拷到的一致性风险见审计报告）——恢复时优先使用 `data.json`（3.1）。
- 备份文件包含学习记录与词库，属于个人数据；如需上传云盘请自行加密。

---

*文档：dsh（DeepSeek Harness）· 2026-10-26 · 对应 task-23（Batch3 / DATA-008）*
