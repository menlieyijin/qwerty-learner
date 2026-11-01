#!/usr/bin/env node
// 词库下载与校验的行为测试（本地 HTTP 服务 + 真实 Range/断流，不走外网）。
// 覆盖：白名单、首次下载、断流后续传、服务端忽略 Range、脏 JSON、超限、416、重定向、结构校验。
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { fetchDictToFile, validateDictPayload, dictUrlAllowed, MAX_BYTES } = require('../local-fork/electron/lib/dict-fetch.js')

const results = { pass: 0, fail: 0 }
function check(name, cond, extra) {
  if (cond) {
    results.pass += 1
    console.log(`PASS  ${name}`)
  } else {
    results.fail += 1
    console.log(`FAIL  ${name}${extra === undefined ? '' : '  ' + JSON.stringify(extra)}`)
  }
}

// 一份合法词库：120 条，既够长到能在中途断开
const WORDS = Array.from({ length: 120 }, (_, i) => ({ name: `word${String(i).padStart(3, '0')}`, trans: [`释义${i}`] }))
const BODY = Buffer.from(JSON.stringify(WORDS))

let mode = 'ok'
let lastRange = ''
const server = createServer((req, res) => {
  lastRange = req.headers.range || ''
  if (mode === 'bad-json') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"not":"an array"}')
    return
  }
  if (mode === 'oversize') {
    res.writeHead(200, { 'content-length': String(MAX_BYTES + 1024) })
    res.end(BODY)
    return
  }
  if (mode === '416') {
    res.writeHead(416, { 'content-range': `bytes */${BODY.length}` })
    res.end()
    return
  }
  if (mode === 'half') {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(BODY.length) })
    res.write(BODY.subarray(0, Math.floor(BODY.length / 2)))
    // 半途断链：客户端应当报错，并把已收到的字节留在 .part 里
    setTimeout(() => res.destroy(), 30)
    return
  }
  if (mode === 'range' && lastRange) {
    const m = lastRange.match(/bytes=(\d+)-/)
    const start = m ? Number(m[1]) : 0
    if (start >= BODY.length) {
      res.writeHead(416, { 'content-range': `bytes */${BODY.length}` })
      res.end()
      return
    }
    res.writeHead(206, {
      'content-type': 'application/json',
      'content-range': `bytes ${start}-${BODY.length - 1}/${BODY.length}`,
      'content-length': String(BODY.length - start),
    })
    res.end(BODY.subarray(start))
    return
  }
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(BODY.length) })
  res.end(BODY)
})

await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const localUrl = `http://127.0.0.1:${port}/dict.json`
const ALLOWED = 'https://raw.githubusercontent.com/dsh/dicts/main/CET4.json'
const realFetch = globalThis.fetch

// 把白名单 URL 的请求转到本地服务；reportedUrl 用于模拟「重定向到非受信源」
const makeFetch =
  (reportedUrl = ALLOWED) =>
  async (_url, init) => {
    const r = await realFetch(localUrl, init)
    // 与真实 Response 对齐：body 可流式读，也支持 arrayBuffer（后者用于反证旧实现）
    const body = r.body
    return {
      ok: r.ok,
      status: r.status,
      url: reportedUrl,
      headers: r.headers,
      body,
      arrayBuffer: async () => {
        const chunks = []
        for await (const c of body) chunks.push(Buffer.from(c))
        return new Uint8Array(Buffer.concat(chunks))
      },
    }
  }

const dir = mkdtempSync(join(tmpdir(), 'qz-dict-'))
const target = join(dir, 'CET4_T.json')
const partFile = target + '.part'
const fresh = () => {
  for (const f of [target, partFile]) rmSync(f, { force: true })
}

// ---------------------------------------------------------------- 1. 白名单
check('1a http:// 被拒绝', dictUrlAllowed('http://raw.githubusercontent.com/a.json') === false)
check('1b 非受信主机被拒绝', dictUrlAllowed('https://evil.example.com/a.json') === false)
check('1c 非 .json 路径被拒绝', dictUrlAllowed('https://raw.githubusercontent.com/a.txt') === false)
check('1d 带凭据的 URL 被拒绝', dictUrlAllowed('https://u:p@raw.githubusercontent.com/a.json') === false)
check('1e 正常官方源通过', dictUrlAllowed(ALLOWED) === true)

// ---------------------------------------------------------------- 2. 首次下载
fresh()
mode = 'ok'
let r = await fetchDictToFile(ALLOWED, target, { fetch: makeFetch() })
check('2a 首次下载成功且 resumed=false', r.resumed === false && r.size === BODY.length, r)
check('2b 落盘内容与源一致', readFileSync(target).equals(BODY))
check('2c 成功后不残留 .part', !existsSync(partFile))

// ---------------------------------------------------------------- 3. 断流 → 续传
fresh()
mode = 'half'
let threw = false
try {
  await fetchDictToFile(ALLOWED, target, { fetch: makeFetch() })
} catch {
  threw = true
}
check('3a 半途断链会报错（不静默截断）', threw === true)
const partialSize = existsSync(partFile) ? statSync(partFile).size : 0
check('3b 断链后 .part 保留已收到的字节', partialSize > 0 && partialSize < BODY.length, { partialSize, total: BODY.length })
check('3c 断链后目标文件尚未生成', !existsSync(target))

mode = 'range'
lastRange = ''
r = await fetchDictToFile(ALLOWED, target, { fetch: makeFetch() })
check('3d 续传请求带 Range 头且从断点开始', lastRange === `bytes=${partialSize}-`, { lastRange, partialSize })
check('3e 续传成功并标记 resumed=true', r.resumed === true, r)
check('3f 续传后文件完整', readFileSync(target).equals(BODY))

// ---------------------------------------------------------------- 4. 服务端忽略 Range
fresh()
writeFileSync(partFile, BODY.subarray(0, 10)) // 伪造一段残留
mode = 'ok' // 恒返回 200，表示服务端不支持 Range
r = await fetchDictToFile(ALLOWED, target, { fetch: makeFetch() })
check('4a 服务端不支持 Range 时从头覆盖', r.resumed === false && readFileSync(target).equals(BODY), r)

// ---------------------------------------------------------------- 5. 脏 JSON
fresh()
mode = 'bad-json'
threw = false
try {
  await fetchDictToFile(ALLOWED, target, { fetch: makeFetch() })
} catch (e) {
  threw = /完整 JSON|有效词库/.test(e.message)
}
check('5a 非数组 JSON 被拒绝', threw === true)
check('5b 脏内容不留下 .part（避免反复续传）', !existsSync(partFile))
check('5c 脏内容不生成目标文件', !existsSync(target))

// ---------------------------------------------------------------- 6. 超限
fresh()
mode = 'oversize'
threw = false
try {
  await fetchDictToFile(ALLOWED, target, { fetch: makeFetch() })
} catch (e) {
  threw = /过大/.test(e.message)
}
check('6a content-length 超限直接拒绝', threw === true)
check('6b 超限不留下目标文件', !existsSync(target))

// ---------------------------------------------------------------- 7. 416
fresh()
writeFileSync(partFile, Buffer.alloc(64, 0x20))
mode = '416'
threw = false
try {
  await fetchDictToFile(ALLOWED, target, { fetch: makeFetch() })
} catch (e) {
  threw = /续传范围无效/.test(e.message)
}
check('7a 416 时报「范围无效」并重置', threw === true)
check('7b 416 后 .part 被清理', !existsSync(partFile))

// ---------------------------------------------------------------- 8. 重定向到非受信源
fresh()
mode = 'ok'
threw = false
try {
  await fetchDictToFile(ALLOWED, target, { fetch: makeFetch('https://evil.example.com/CET4.json') })
} catch (e) {
  threw = /非受信源/.test(e.message)
}
check('8a 重定向到非白名单源被拒绝', threw === true)

// ---------------------------------------------------------------- 9. 结构校验边界
check('9a 全对象数组通过', validateDictPayload(WORDS) === true)
check('9b 字符串数组通过', validateDictPayload(['apple', 'banana']) === true)
check('9c 空数组拒绝', validateDictPayload([]) === false)
check('9d 非数组拒绝', validateDictPayload({ a: 1 }) === false)
check('9e 79% 合法被拒', validateDictPayload([...Array(21).fill({ name: 'ok' }), ...Array.from({ length: 79 }, () => ({}))]) === false)
check('9f 81% 合法通过', validateDictPayload([...Array(81).fill({ name: 'ok' }), ...Array.from({ length: 19 }, () => ({}))]) === true)
check('9g name 为空字符串不计入', validateDictPayload([{ name: '  ' }]) === false)

server.close()
rmSync(dir, { recursive: true, force: true })

const total = results.pass + results.fail
console.log(`\nVERIFY ${results.fail === 0 ? 'PASS' : 'FAIL'}  ${results.pass}/${total}`)
process.exit(results.fail === 0 ? 0 : 1)
