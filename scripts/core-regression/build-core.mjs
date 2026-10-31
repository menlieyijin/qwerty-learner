#!/usr/bin/env node
/**
 * v9.3 仿真核心构建：把 **真实源码** src/utils/{srsRules,autoLevel,memory,db/index,learningPath,
 * memoryLadder,memoryKey,memoryCache,sessionRequeue}.ts 用 esbuild 打包成 core.mjs。
 *
 * 只替换浏览器专属依赖（不改变算法判定）：
 *   - dexie   → stub-dexie.mjs（内存表）
 *   - react / jotai / @/store / @/pages/Typing/store → hook stub（仿真不调用 UI hook）
 *   - @/utils/db/record   → stub-record.mjs（真实 record.ts 依赖 navigator/mixpanel）
 *   - @/resources/dictionary → dictionary-stub.mjs（真实模块含 Vite import.meta.glob）
 *   - learningPath 保持真实实现，仿真通过注入 globalThis.fetch 供词库数据（含加载失败场景）
 *
 * 不修改 src/ 下任何文件。运行：node "scripts/core-regression\build-core.mjs"
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const SRC_ROOT = path.resolve(import.meta.dirname, '../..')
const SRC = path.join(SRC_ROOT, 'src')
const AUDIT = import.meta.dirname
const ENTRY = path.join(AUDIT, 'entry.ts')
const OUT = process.env.CORE_OUT ? path.resolve(process.env.CORE_OUT) : path.join(AUDIT, 'core.mjs')
/**
 * v9.11 量化仿真需要「同一份源码、两个毕业线」：
 *   CORE_MASTERY_RATIO=0.9 node build-core.mjs  →  变体 bundle（只在内存里改常量，不动 src）
 * 缺省（不设该环境变量）= 完全按源码原样打包，门禁行为不变。
 */
const MASTERY_OVERRIDE = process.env.CORE_MASTERY_RATIO ? Number(process.env.CORE_MASTERY_RATIO) : null
/** 诊断用：CORE_MIX_MAX=0.3 可复现 v9.10 的掺入封顶（不改 src），仅用于对比实验 */
const MIX_MAX_OVERRIDE = process.env.CORE_MIX_MAX ? Number(process.env.CORE_MIX_MAX) : null
/** 诊断用：CORE_MIX_WINDOW_CAP=6 可试算「放大窗口」方案（不改 src），仅用于对比实验 */
const WINDOW_CAP_OVERRIDE = process.env.CORE_MIX_WINDOW_CAP ? Number(process.env.CORE_MIX_WINDOW_CAP) : null

const STUBS = {
  dictionary: path.join(AUDIT, 'dictionary-stub.mjs'),
  dexie: path.join(AUDIT, 'stub-dexie.mjs'),
  react: path.join(AUDIT, 'stub-react.mjs'),
  jotai: path.join(AUDIT, 'stub-jotai.mjs'),
  store: path.join(AUDIT, 'stub-store.mjs'),
  typingStore: path.join(AUDIT, 'stub-typing-store.mjs'),
  record: path.join(AUDIT, 'stub-record.mjs'),
}

const require = createRequire(path.join(SRC_ROOT, 'package.json'))
const esbuild = require('esbuild')

function resolveWithExtension(base) {
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, 'index.ts')]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return base
}

const plugins = [
  {
    name: 'dsh-v93-aliases',
    setup(build) {
      build.onResolve({ filter: /^@\/resources\/dictionary$/ }, () => ({ path: STUBS.dictionary }))
      build.onResolve({ filter: /^@\/pages\/Typing\/store$/ }, () => ({ path: STUBS.typingStore }))
      build.onResolve({ filter: /^@\/store$/ }, () => ({ path: STUBS.store }))
      build.onResolve({ filter: /^react$/ }, () => ({ path: STUBS.react }))
      build.onResolve({ filter: /^jotai$/ }, () => ({ path: STUBS.jotai }))
      build.onResolve({ filter: /^dexie$/ }, () => ({ path: STUBS.dexie }))
      build.onResolve({ filter: /^\.\/record$/ }, (args) => {
        // 只替换 src/utils/db/index.ts 里的 './record'；src/utils/memory.ts 用的是 './db/record'
        if (args.importer && /[\\/]utils[\\/]db[\\/]index\.ts$/.test(args.importer)) {
          return { path: STUBS.record }
        }
        return undefined
      })
      build.onResolve({ filter: /^@\// }, (args) => ({
        path: resolveWithExtension(path.join(SRC, args.path.slice(2))),
      }))
    },
  },
]

// v9.11：仅在显式设 CORE_MASTERY_RATIO / CORE_MIX_MAX / CORE_MIX_WINDOW_CAP 时覆盖常量
// （内存替换，不写 src），用于 (a)/(b) 组对照与备选方案试算
if (MASTERY_OVERRIDE != null || MIX_MAX_OVERRIDE != null || WINDOW_CAP_OVERRIDE != null) {
  plugins.push({
    name: 'dsh-mastery-override',
    setup(build) {
      build.onLoad({ filter: /[\\/]utils[\\/]autoLevel\.ts$/ }, async (args) => {
        let src = await fs.promises.readFile(args.path, 'utf8')
        if (MASTERY_OVERRIDE != null) {
          const re = /const MASTERY_RATIO = [0-9.]+/
          if (!re.test(src)) throw new Error('[v93-build-core] 找不到 MASTERY_RATIO 常量（源码形态变了？）')
          src = src.replace(re, `const MASTERY_RATIO = ${MASTERY_OVERRIDE}`)
        }
        if (MIX_MAX_OVERRIDE != null) {
          const re = /export const MIX_MAX = [0-9.]+/
          if (!re.test(src)) throw new Error('[v93-build-core] 找不到 MIX_MAX 常量（源码形态变了？）')
          src = src.replace(re, `export const MIX_MAX = ${MIX_MAX_OVERRIDE}`)
        }
        if (WINDOW_CAP_OVERRIDE != null) {
          const re = /export const MIX_WINDOW_CAP = [0-9.]+/
          if (!re.test(src)) throw new Error('[v93-build-core] 找不到 MIX_WINDOW_CAP 常量（源码形态变了？）')
          src = src.replace(re, `export const MIX_WINDOW_CAP = ${WINDOW_CAP_OVERRIDE}`)
        }
        return { contents: src, loader: 'ts' }
      })
    },
  })
}

await esbuild.build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2020',
  outfile: OUT,
  logLevel: 'info',
  sourcemap: false,
  plugins,
})

const size = fs.statSync(OUT).size
console.log(`[v93-build-core] built ${OUT} (${size} bytes)`)
