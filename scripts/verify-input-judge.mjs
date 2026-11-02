#!/usr/bin/env node
// 输入判定的纯函数回归（v11.6.2）
//
// 借鉴 TypeWords 的 visible-word-typing.ts：把「这个字符是否算对 / 新增输入判到哪一位」抽成纯函数。
// 抽取最怕「看起来一样、边界变了」，所以这里做两层验证：
//   1) 逐条断言边界：增量起点、越界输入、大小写、分隔符等价、错误提示文案；
//   2) 把抽取前的 effect 判定写成参考实现，用 2000 组随机输入做等价性对拍。
//
// 用法：npm run test:input-judge
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let passed = 0
const failures = []
const check = (name, ok, detail) => {
  if (ok) {
    passed += 1
    console.log(`PASS  ${name}`)
  } else {
    failures.push(name)
    console.log(`FAIL  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  }
}

const EXPLICIT_SPACE = '␣'
const dir = mkdtempSync(join(tmpdir(), 'qz-input-judge-'))
const outfile = join(dir, 'inputJudgement.mjs')
try {
  await build({
    entryPoints: ['src/pages/Typing/components/WordPanel/components/Word/inputJudgement.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2020',
    logLevel: 'silent',
    alias: { '@': join(process.cwd(), 'src') },
  })
  const { judgeInput, describeMistake } = await import(pathToFileURL(outfile).href)

  const judge = (displayWord, inputWord, extra = {}) =>
    judgeInput({ displayWord, inputWord, judgedLength: 0, ignoreCase: false, allowSeparatorEquivalence: false, ...extra })

  // ---------- 基本判定 ----------
  check('1 空输入 → idle', judge('apple', '').kind === 'idle')
  check('2 空词 → idle', judge('', 'a').kind === 'idle')
  check(
    '3 完整正确 → finished',
    JSON.stringify(judge('apple', 'apple')) === JSON.stringify({ kind: 'correct', from: 0, judged: 5, finished: true }),
  )
  check(
    '4 前缀正确 → 未完成',
    JSON.stringify(judge('apple', 'app')) === JSON.stringify({ kind: 'correct', from: 0, judged: 3, finished: false }),
  )
  check('5 错字定位到下标', JSON.stringify(judge('apple', 'apxle')) === JSON.stringify({ kind: 'wrong', index: 2, extra: false }))
  check('6 首字符错 → 下标 0', judge('apple', 'x').index === 0)

  // ---------- 大小写 ----------
  check('7 忽略大小写时 A/a 等价', judge('Apple', 'a', { ignoreCase: true }).kind === 'correct')
  check('8 不忽略大小写时判错', judge('Apple', 'a', { ignoreCase: false }).kind === 'wrong')

  // ---------- 分隔符等价 ----------
  check('9 空格与连字符等价', judge('t-shirt', 't shirt', { allowSeparatorEquivalence: true }).kind === 'correct')
  check('10 关闭等价后判错', judge('t-shirt', 't shirt', { allowSeparatorEquivalence: false }).kind === 'wrong')
  check('11 ␣ 与 - 等价', judge(`a${EXPLICIT_SPACE}b`, 'a-b', { allowSeparatorEquivalence: true }).kind === 'correct')
  check('12 下划线不在等价类', judge('a_b', 'a b', { allowSeparatorEquivalence: true }).kind === 'wrong')
  check('13 句点不在等价类', judge('a.m.', 'a m ', { allowSeparatorEquivalence: true }).kind === 'wrong')

  // ---------- 越界 / 增量 ----------
  const extra1 = judge('apple', 'applex')
  check('14 超长输入算错且下标夹在词内', extra1.kind === 'wrong' && extra1.index === 4 && extra1.extra === true, extra1)
  const extra2 = judge('apple', 'applexyz')
  check('15 多字符超长仍夹在词内', extra2.index === 4 && extra2.extra === true, extra2)
  const incremental = judge('apple', 'apx', { judgedLength: 2 })
  check('16 增量判定从 judgedLength 开始', incremental.kind === 'wrong' && incremental.index === 2, incremental)
  const noNew = judge('apple', 'ap', { judgedLength: 3 })
  check('17 judgedLength 超过输入长度时不产生负区间', noNew.kind === 'correct' && noNew.judged === 2 && noNew.finished === false, noNew)
  check('18 单字符词正确即完成', judge('a', 'a').finished === true)
  check(
    '19 越界判定不会返回 >= 词长的下标',
    [1, 2, 3].every((n) => judge('ab', 'ab' + 'x'.repeat(n)).index < 2),
  )

  // ---------- 错误提示 ----------
  check('20 漏字提示', describeMistake({ displayWord: 'apple', inputWord: 'appel', index: 3, extra: false }) === '漏掉了「l」')
  check('21 重复输入提示', describeMistake({ displayWord: 'apple', inputWord: 'appple', index: 2, extra: false }) === '重复输入了「p」')
  check('22 大小写提示', describeMistake({ displayWord: 'Apple', inputWord: 'apple', index: 0, extra: false }) === '注意大小写：应为「A」')
  check(
    '23 普通错字提示',
    describeMistake({ displayWord: 'apple', inputWord: 'ax', index: 1, extra: false }) === '应为「p」，你输入了「x」',
  )
  check(
    '24 超长且与末位相同 → 重复输入',
    describeMistake({ displayWord: 'apple', inputWord: 'applee', index: 4, extra: true }) === '重复输入了「e」',
  )
  check('25 超长且不同 → 多输入', describeMistake({ displayWord: 'apple', inputWord: 'applex', index: 4, extra: true }) === '多输入了「x」')
  check('26 空期望字符不产生文案', describeMistake({ displayWord: '', inputWord: 'a', index: 0, extra: false }) === '')

  // ---------- 与抽取前的实现做等价对拍 ----------
  // 参考实现逐行照抄重构前的 effect 判定（含 charsMatch 的等价顺序），只去掉 setState/音效。
  const SEP = new Set([' ', EXPLICIT_SPACE, '-', '/'])
  const charsMatch = (input, expected, ignoreCase) => {
    if (input === expected) return true
    if (SEP.has(input) && SEP.has(expected)) return true
    return ignoreCase ? input.toLowerCase() === expected.toLowerCase() : false
  }
  function legacyJudge({ displayWord, inputWord, judgedLength, ignoreCase, allowSeparatorEquivalence }) {
    const inputLength = inputWord.length
    const wordLength = displayWord.length
    if (!inputLength || !wordLength) return { kind: 'idle' }
    const from = Math.min(judgedLength, inputLength)
    const judgeEnd = Math.min(inputLength, wordLength)
    let mismatch = -1
    for (let i = from; i < judgeEnd; i++) {
      const inputChar = inputWord[i]
      const correctChar = displayWord[i]
      let isEqual = false
      if (inputChar != undefined && correctChar != undefined) {
        isEqual = allowSeparatorEquivalence
          ? charsMatch(inputChar, correctChar, ignoreCase)
          : ignoreCase
          ? inputChar.toLowerCase() === correctChar.toLowerCase()
          : inputChar === correctChar
      }
      if (!isEqual) {
        mismatch = i
        break
      }
    }
    const hasExtraInput = mismatch === -1 && inputLength > wordLength
    if (hasExtraInput) mismatch = wordLength - 1
    if (mismatch === -1) {
      return { kind: 'correct', from, judged: Math.min(inputLength, wordLength), finished: inputLength >= wordLength }
    }
    return { kind: 'wrong', index: mismatch, extra: hasExtraInput }
  }

  const chars = ['a', 'b', 'A', 'B', ' ', EXPLICIT_SPACE, '-', '/', '_', '.', 'x']
  let seed = 20261102
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const pick = () => chars[Math.floor(rand() * chars.length)]
  let mismatches = 0
  let firstMismatch = null
  for (let i = 0; i < 2000; i += 1) {
    const wordLen = 1 + Math.floor(rand() * 8)
    const displayWord = Array.from({ length: wordLen }, pick).join('')
    const inputLen = Math.floor(rand() * (wordLen + 4))
    const inputWord = Array.from({ length: inputLen }, pick).join('')
    const judgedLength = Math.floor(rand() * (wordLen + 2))
    const args = {
      displayWord,
      inputWord,
      judgedLength,
      ignoreCase: rand() > 0.5,
      allowSeparatorEquivalence: rand() > 0.5,
    }
    const a = JSON.stringify(judgeInput(args))
    const b = JSON.stringify(legacyJudge(args))
    if (a !== b) {
      mismatches += 1
      if (!firstMismatch) firstMismatch = { args, next: a, legacy: b }
    }
  }
  check('27 2000 组随机输入与抽取前实现完全一致', mismatches === 0, firstMismatch)

  console.log(`\nINPUT_JUDGE ${passed}/${passed + failures.length}`)
  if (failures.length) {
    console.error(`失败项：${failures.join('；')}`)
    process.exitCode = 1
  }
} finally {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* 临时目录清理失败不影响结论 */
  }
}
