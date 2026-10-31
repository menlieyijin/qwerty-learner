# 核心算法回归（SRS / 记忆曲线 / 自动进阶）

这套脚本原本只在作者本机（`D:\整理\audit`）维护，公开仓库里没有——于是「核心算法有 309 条回归保护」
对外**不可复跑**。v10.1 起它随仓库发布，路径改成仓库相对，`npm run test:core` 一条命令跑完。

## 跑什么

| 步骤 | 脚本 | 内容 | 断言数 |
| --- | --- | --- | --- |
| 1 | `build-core.mjs` | 用 esbuild 把**真实源码**（`src/utils/{srsRules,autoLevel,memory,memoryLadder,memoryKey,memoryCache,sessionRequeue,learningPath,db/index}.ts`）打包成 `core.mjs`；只把浏览器专属依赖换成本目录下的 stub | — |
| 2 | `srs-sim.mjs --strict` | 到期计算、错答降档、快答升档、时钟回拨纠正、mature 降档、refresh 调度、封顶与不变式 | 120 |
| 3 | `sim-autolevel.mjs --strict` | 级别推进（掌握度 85% 毕业）、掺入上一级词、skip/挂起、due 键、加载失败不推进 | 189 |
| 4 | `determinism-check.mjs` | 同输入跑两遍，结果必须逐字节一致（防随机/时间泄漏） | — |
| 5 | `aggregate.mjs` | 汇总 309 条 + 确定性结果，任一项失败即非 0 退出 | — |

## 怎么跑

```bash
npm run test:core
```

产物（都已 gitignore）：`core.mjs`、`report-srs.json`、`report-autolevel.json`、
`report-determinism.json`、`report-all.json`。

## 关键约束：**不改 src**

`build-core.mjs` 只在内存里对常量做替换（`CORE_MASTERY_RATIO` / `CORE_MIX_MAX` /
`CORE_MIX_WINDOW_CAP` 三个环境变量，用于对比实验），**不会写 `src/`**。仿真注入时间、随机种子与
localStorage/fetch，因此结果可复现。

## 局限（诚实说明）

- 它验证的是**纯算法层**（记忆曲线、出词、级别推进），不覆盖 React 组件与 Electron 主进程；
  界面与交互由 `scripts/dsh-smoke.mjs` 与 `verify-*.mjs` 覆盖。
- stub 只保证「不改变算法判定」，不是真实浏览器环境：例如 dexie 被换成内存表。
- 断言数量随版本增长（历史：v9.3–v9.6 为 248、v9.7–v9.9 为 253、v9.10 起 309）。改算法时**先改断言再改实现**。
