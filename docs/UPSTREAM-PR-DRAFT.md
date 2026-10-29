# 上游贡献稿（可直接提交为 issue / PR）

> 署名：**dsh**（`dsh <dsh@dsh.local>`），与本分支（`menlieyijin/qwerty-learner`）的本地定制**无关**，
> 每个修复都是独立最小 diff，GPL-3.0 兼容。
> 核对基线：上游 `RealKai42/qwerty-learner` commit `1182426`（本仓库的基线）。**提交前请先确认上游这几处是否已改**。
> 建议流程：先提 issue（附复现）→ 维护者确认后再提 PR；每个问题一条分支、一个 PR。

---

## 1. `vite.config.ts`: `getLastCommit` 的 Promise 在非 git 环境下永不 resolve，`vite build` 静默不产出（Docker 构建必失败）

**类型**：Bug / 高（阻断构建） · **建议**：PR

**现象**

在没有 `.git` 的目录（Docker `COPY . .`、下载的源码 zip、CI 的 shallow export）执行 `npm run build`：
命令退出码 **0**，**没有任何输出**，也**没有生成 `build/`**。于是 `Dockerfile` 里的
`COPY --from=build /app/build /app` 必然失败，但错误看起来和 vite 无关，很难定位。

**定位**（`vite.config.ts`）

```ts
const latestCommitHash = await new Promise<string>((resolve) => {
  return getLastCommit((err, commit) => (err ? 'unknown' : resolve(commit.shortHash)))
})
```

`err ? 'unknown' : resolve(...)` 在 err 分支只是**求值出一个字符串**，并不调用 `resolve`。
于是这个 Promise 永远 pending → `defineConfig(async …)` 永不返回 → vite 进程在事件循环空转后退出（退出码 0，无输出）。

**复现**

```bash
git clone <repo> /tmp/x && cd /tmp/x && rm -rf .git
npm ci && npx vite build; echo "exit=$?"; ls build    # exit=0，build 不存在
```

**修复**

```ts
const latestCommitHash = await new Promise<string>((resolve) => {
  getLastCommit((err, commit) => {
    if (err || !commit) {
      resolve('unknown')
      return
    }
    resolve(commit.shortHash)
  })
})
```

**验证**（本分支实测）：同一份无 `.git` 的副本，`npm ci`（916 包）后 `npm run build` → `✓ built in 13.42s`，
`build/` 正常产出；修复前同一条命令 0 输出、无产物。

**风险**：仅影响非 git 环境下 `LATEST_COMMIT_HASH` 的取值（变成 `unknown`），页面展示用，无功能影响。

---

## 2. 错题本导出 CSV 存在公式注入（CSV injection）

**类型**：Security / 中 · **建议**：PR

**现象**

`src/pages/ErrorBook/DropdownExport.tsx` 用 `XLSX.utils.json_to_sheet` + `XLSX.write({bookType:'csv'})`
直接导出，单元格内容不做任何中和。若某个词的单词/释义以 `=` `+` `-` `@`（或 Tab / CR）开头，
Excel / WPS / Numbers 打开时会把该单元格当**公式**执行。

词库来自第三方、也可由用户导入，属不可信输入；用户把导出的 CSV 发给别人时，风险会传递。

**实测**（SheetJS 0.18.x）

```js
const ws = XLSX.utils.json_to_sheet([{ 单词: '=cmd|calc', ... }])
XLSX.write(wb, { bookType: 'csv', type: 'string' })
// => 单词,释义,...\n=cmd|calc,...      ← 裸公式
```

（`.xlsx` 分支不受影响：SheetJS 写的是 `t:"s"` 字符串单元格，实测读回仍是字符串。）

**建议修复**：命中前缀时给值加 `'` 前缀（Excel 的文本标记，不显示），只对 csv 分支套用，数字列不动。

```ts
const FORMULA_PREFIX = /^[=+\-@\t\r]/
export function csvSafeCell<T>(value: T): T | string {
  if (typeof value !== 'string') return value
  return FORMULA_PREFIX.test(value) ? `'${value}` : value
}
```

**验证**：本分支加了 14 条断言（前缀命中 / 内部等号不误伤 / 数字列不加引号 / 端到端 csv 无裸公式单元格）。

---

## 3. `WordRecord.inputAccuracy` 运算优先级错误，返回值不是正确率

**类型**：Bug / 低（当前无调用点） · **建议**：PR（顺带补单测）

**现象**（`src/utils/db/record.ts:109`）

```ts
get inputAccuracy() {
  return Math.round((this.correctCount / this.correctCount + this.wrongCount) * 100)
}
```

`correctCount / correctCount` 恒为 1（`0/0` 时为 `NaN`），实际结果约等于 `100 + wrongCount * 100`，
不是「正确率」。目前仓库内没有引用，属隐藏缺陷，但一旦被用来展示或参与判定就会出错。

**修复**

```ts
get inputAccuracy() {
  const total = this.correctCount + this.wrongCount
  return total === 0 ? 0 : Math.round((this.correctCount / total) * 100)
}
```

---

## 4. `useGetWord` 在 `useMemo` 中调用 `setHasError`（渲染期更新状态）

**类型**：Bug / 低（React 反模式，dev 有告警） · **建议**：PR

**现象**（`src/pages/ErrorBook/hooks/useGetWord.ts`）

```ts
const word = useMemo(() => {
  if (!wordList) return undefined
  const word = wordList.find((w) => w.name === name)
  if (word) return word
  setHasError(true)   // ← 渲染期 setState
  return undefined
}, [wordList, name])
```

`useMemo` 的返回值不应有副作用：严格模式下会被调用两次；且「词典里有这个词」与「没这个词」会让
`hasError` 一旦置真就再也回不去（切换行后仍是错误态）。

**修复方向**：把 `hasError` 改成派生值（`!isLoading && !word`），或放到 `useEffect` 里；
同时注意切换 `name` 时要复位。

---

## 5. 窗口从窄变宽时 `window.location.href = '/'` 会整页刷新

**类型**：Bug / 低（体验） · **建议**：Issue（改法取决于上游路由方案）

**现象**（`src/index.tsx:38-44`）

```ts
const handleResize = () => {
  const isMobile = window.innerWidth <= 600
  if (!isMobile) {
    window.location.href = '/'      // ← 整页刷新
  }
  setIsMobile(isMobile)
}
```

浏览器版从 600px 以下拉宽会整页重载：当前练习进度、输入焦点全部丢失；打包成桌面端时
（`file://`）`'/'` 还会解析到磁盘根目录。

**修复方向**：用路由导航（`HashRouter` 下 `navigate('/')` / 设 `location.hash = '#/'`）替代整页跳转，
或仅在「移动布局 → 桌面布局」这一次切换时重置路由。

---

## 6. 个别词库 `metadata.length` 与实际词条数不一致，画廊点击卡片会 TypeError

**类型**：Issue（数据质量 + 防御） · **建议**：Issue 优先

**现象**：`dictionaries` 里的元数据（`length`）由构建脚本生成，个别词库与真实条目数不符；
画廊按 `length` 计算章节/词数时拿到 `undefined` 或错值，点击卡片进入练习会抛 TypeError。

**建议**：① 在生成脚本里对 `metadata.length` 与实际词数做校验（不一致直接 fail）；
② 运行期读取时做一次 `Number.isFinite` + 回退到 `words.length` 的兜底。

---

## 提交清单（建议顺序）

| 顺序 | 内容 | 类型 | 难度 | 影响面 |
| --- | --- | --- | --- | --- |
| 1 | `vite.config.ts` Promise 不 resolve（#1） | PR | 3 行 | Docker / 源码包构建 |
| 2 | CSV 公式注入（#2） | PR | ~20 行 | 导出安全 |
| 3 | `inputAccuracy` 优先级（#3） | PR | 4 行 | 隐藏缺陷 |
| 4 | `useGetWord` 渲染期 setState（#4） | PR | ~15 行 | 错题本错误态 |
| 5 | resize 整页刷新（#5） | Issue→PR | 视路由 | 浏览器端体验 |
| 6 | 词库元数据长度（#6） | Issue | — | 数据质量 |

每条 PR 描述建议附一句：

> This change is independent from any local fork; contributed by dsh (`dsh@dsh.local`), signed-off per DCO.

---

*本文稿只包含与本分支定制无关的通用问题。分支本身的改动（自动进阶、SRS、起点选择、Electron 外壳等）
不在此列，也不建议提交上游。*
