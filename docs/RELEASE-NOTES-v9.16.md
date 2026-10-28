# RELEASE-NOTES v9.16（2026-10-28）

**主题**：首次打开应用的「词汇水平起点选择」（目标范围 2 的功能落地）
**commit**：`b750131`（功能）+ `169f628`（选择后同步持久化 choice）；asar SHA256 `C2B5BC82AE75B18599994B66DF325CF91F97B6FEAE8546F5CAADC55D65B78B97`

## 变更

1. **首启选择卡**（`src/components/FirstRunLevelPicker.tsx`）：首次打开且没有任何练习数据时自动弹出，五档起点——从未学过（primary-1）/ 初中（junior-1）/ 高中（senior-1）/ 四级（cet4）/ 六级（cet6）；「稍后再说」仅本次会话生效，下次启动若仍未选择会再次提示。
2. **个性化路线**（`src/utils/autoLevel.ts` 新增 `applyLearningStartChoice`）：选择写入唯一状态源 `qzAutoLevelState.levelId`，后续进阶仍由 LEARNING_PATH + 自动进阶接管（选四级不会跳过后续六级→高频词等路线）。
3. **持久化与可修改**：选择本身存 `learningStartChoiceAtom`（键 `learningStartChoice`）；练习页顶栏新增「学习路线」按钮，随时重开选择卡修改起点（修改直接改写 levelId，不扫描历史记录）。
4. **不打扰老用户**：已有练习数据（`hasAutoLevelState()`）的用户不会自动弹卡，仅可通过按钮打开。
5. 辅助：`scripts/check-v916.mjs`（首启选择卡 CDP 专项验证，7 项断言）。

## 验证

- `tsc --noEmit` 0 error；`eslint --max-warnings 0` 0 warning；核心回归 **309/309**；determinism pass。
- 专项验证（全新 profile，CDP）：首启弹卡 ✓ / 顶栏按钮 ✓ / 点「六级水平」→ `learningStartChoice="cet6"` 且 `qzAutoLevelState.levelId=cet6` ✓ / 弹卡关闭 ✓ / 按钮重开 ✓ → **V916-PASS**。
  （首验曾抓到「levelId 已写但 choice 未持久化 → 下次启动重复弹卡」的回归，已在 `169f628` 修复并复测。）
- CDP 冒烟 **11/11**（隔离 profile，`logs/smoke-1.0.0-enhanced-v9.16-testinstall.txt`）；双目录安装 asar 哈希一致。
- 回滚点：tag `v9.15-pre-batchE` + `Qwerty备份\rollback-v9.15-before-batchE.asar`。

## 行为变化（用户可感知）

- 全新安装首次打开会弹出起点选择卡（可推迟）。
- 练习页顶栏多一个「学习路线」按钮。
- 其余无任何变化：不选择/推迟时行为与 v9.15 完全一致。
