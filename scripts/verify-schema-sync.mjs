#!/usr/bin/env node
// 备份 schema 版本一致性（v11.6.2）
//
// 背景：备份快照（data.json）里写入了 `schemaVersion`，导入时用它拒绝「来自更新版本的备份」。
// 这个号必须与 Dexie 的真实版本一致，否则升级数据库后忘了改常量，会出现
// 「新版本备份被旧版本接受」或「同版本备份被误拒」。这里做静态校验。
//
// 用法：npm run test:schema-sync
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

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

const REPO = resolve(import.meta.dirname, '..')
const dbSource = readFileSync(join(REPO, 'src/utils/db/index.ts'), 'utf8')
const enhanceSource = readFileSync(join(REPO, 'local-fork/electron/enhance/enhance.js'), 'utf8')

// Dexie 的最终版本 = 所有 this.version(N) 里的最大值
const versions = [...dbSource.matchAll(/this\.version\((\d+)\)/g)].map((m) => Number(m[1]))
const dbVersion = versions.length ? Math.max(...versions) : NaN
const constMatch = enhanceSource.match(/RECORD_DB_SCHEMA_VERSION\s*=\s*(\d+)/)
const constVersion = constMatch ? Number(constMatch[1]) : NaN

check('1 Dexie 版本号可解析', Number.isFinite(dbVersion), versions)
check('2 enhance.js 的 schema 常量可解析', Number.isFinite(constVersion), constMatch ? constMatch[1] : null)
check('3 两处版本号一致', dbVersion === constVersion, { dexie: dbVersion, enhance: constVersion })

check('4 备份快照写入 schemaVersion', /schemaVersion:\s*RECORD_DB_SCHEMA_VERSION/.test(enhanceSource))
check(
  '5 导入时读取并比较 schemaVersion',
  /data\.schemaVersion/.test(enhanceSource) && /incomingSchema\s*>\s*RECORD_DB_SCHEMA_VERSION/.test(enhanceSource),
)
check('6 拒绝导入时给出可操作的提示', /备份来自更新的版本/.test(enhanceSource) && /请先升级应用/.test(enhanceSource))

console.log(`\nSCHEMA_SYNC ${passed}/${passed + failures.length}`)
if (failures.length) {
  console.error(`失败项：${failures.join('；')}`)
  process.exitCode = 1
}
