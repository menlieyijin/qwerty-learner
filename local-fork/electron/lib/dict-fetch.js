// 词库下载与校验（纯 Node，不依赖 Electron，便于单测）。
// 从 main.js 抽出：这段逻辑涉及「白名单 / 体积上限 / 断点续传 / 结构校验」四个安全边界，
// 只有能被独立测试，改动才敢做。
const fs = require('node:fs')
const { once } = require('node:events')

const UA = 'QwertyLearnerPlus/1.1 (Electron desktop; free dictionary chain)'
const MAX_BYTES = 32 * 1024 * 1024 // 32MB 上限（正常词库最大约 8MB）
const ALLOWED_HOSTS = new Set([
  'raw.githubusercontent.com',
  'cdn.jsdelivr.net',
  'github.com',
  'objects.githubusercontent.com',
  'api.github.com',
])

// 只允许 https + 受信主机 + .json 路径，且不允许携带凭据（防 SSRF / 凭据泄露）
function dictUrlAllowed(raw) {
  try {
    const u = new URL(String(raw || ''))
    if (u.protocol !== 'https:') return false
    if (u.username || u.password) return false
    if (!/\.json$/i.test(u.pathname)) return false
    return ALLOWED_HOSTS.has(String(u.hostname || '').toLowerCase())
  } catch {
    return false
  }
}

// 结构校验：JSON 数组、非空、≥80% 条目为「含 name 字符串的对象」或非空字符串
function validateDictPayload(json) {
  if (!Array.isArray(json) || json.length === 0) return false
  let valid = 0
  for (const item of json) {
    if (typeof item === 'string') {
      if (item.trim()) valid += 1
      continue
    }
    if (item && typeof item === 'object' && typeof item.name === 'string' && item.name.trim() && item.name.length <= 200) valid += 1
  }
  return valid >= Math.ceil(json.length * 0.8)
}

/**
 * 下载词库到 target，支持断点续传。
 * - 边收边写 <target>.part（不是先攒在内存里再写盘，否则连接中断时什么都没留下，续传永远从 0 开始）
 * - 失败保留 .part，下次带 Range: bytes=<已下载>-
 * - 服务端 206 追加 / 200 覆盖 / 416 重置
 * - 落盘前校验体积与 JSON 结构；失败清掉 .part，避免半截文件被反复续传
 * 返回 { size, resumed }。
 */
async function fetchDictToFile(url, target, options = {}) {
  const timeout = options.timeout || 60000
  const maxBytes = options.maxBytes || MAX_BYTES
  const fetchImpl = options.fetch || globalThis.fetch
  if (!dictUrlAllowed(url)) throw new Error('下载源不在白名单内')
  const part = target + '.part'
  let start = 0
  try {
    const st = fs.statSync(part)
    if (st.isFile() && st.size > 0 && st.size <= maxBytes) start = st.size
  } catch {
    /* 无残留 */
  }

  const headers = { 'user-agent': UA }
  if (start > 0) headers.Range = `bytes=${start}-`
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeout) })
  if (res.status === 416 && start > 0) {
    removeQuietly(part)
    throw new Error('续传范围无效，已重置')
  }
  if (!res.ok && res.status !== 206) throw new Error('HTTP ' + res.status)
  if (res.url && !dictUrlAllowed(res.url)) throw new Error('下载地址重定向到非受信源')

  const append = res.status === 206 && start > 0
  const base = append ? start : 0
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared && base + declared > maxBytes) throw new Error('词库文件过大')

  // 流式写入：中断时 .part 里保留已收到的字节，下次从这里续
  let written = 0
  const out = fs.createWriteStream(part, { flags: append ? 'a' : 'w' })
  try {
    if (res.body) {
      for await (const chunk of res.body) {
        written += chunk.length
        if (base + written > maxBytes) throw new Error('词库文件过大')
        if (!out.write(chunk)) await once(out, 'drain')
      }
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())))
  } catch (e) {
    out.destroy()
    throw e
  }

  const total = base + written
  if (total === 0) throw new Error('空文件')

  let json = null
  try {
    json = JSON.parse(fs.readFileSync(part, 'utf-8'))
  } catch {
    removeQuietly(part)
    throw new Error('下载内容不是完整 JSON')
  }
  if (!validateDictPayload(json)) {
    removeQuietly(part)
    throw new Error('JSON 不是有效词库数组')
  }
  fs.renameSync(part, target)
  return { size: total, resumed: append }
}

function removeQuietly(file) {
  try {
    fs.rmSync(file, { force: true })
  } catch {
    /* ignore */
  }
}

module.exports = { UA, MAX_BYTES, ALLOWED_HOSTS, dictUrlAllowed, validateDictPayload, fetchDictToFile }
