import type { Word } from '@/typings'

/** 词库 JSON 的原始条目：历史上 trans 可能是数组/字符串/null，音标字段也可能缺失 */
type RawWord = {
  name?: unknown
  trans?: unknown
  usphone?: unknown
  ukphone?: unknown
  phone?: unknown
  [key: string]: unknown
}

function normalizeTrans(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string' && item.length > 0)
  }
  if (raw == null) return []
  const text = String(raw)
  return text ? [text] : []
}

function normalizePhone(raw: unknown): string {
  return typeof raw === 'string' ? raw : ''
}

/**
 * v9.5（TYP-005 根因修复）：词条 name 的空白归一化。
 *
 * 385 个词库里有 286 条 name 含首/尾空格、连续空格或换行（如 `"gym\nn."`、`" a lot "`）：
 * 首空格会导致第一个键就判错、尾空格要求用户多按一个空格才算完成、连续空格/换行几乎无法复现，
 * 最终只能错 4 次触发 Skip 并被写成 suspended。这里在**加载层**统一：
 * - 所有空白序列（空格/制表/换行/全角空格由 \s 覆盖的常见形式）折叠为一个普通空格；
 * - 去掉首尾空格；
 * - 归一化后为空的条目丢弃（原实现只按 length>0 过滤）。
 * 原始词库文件不改；记忆曲线/错题本按归一化后的 name 写入，展示层无需再处理空白。
 */
function normalizeWordNameInput(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/**
 * v9.4（数据层 P2 修复，原 DATA-005）：词库条目字段归一化。
 *
 * public/dicts 的历史数据字段不统一：13 个词库的 `trans` 是**字符串**或 **null**
 * （English_II 1144 条、IELTS_XDF_7000 5567 条、BEIJING 初中 1844 条、google-20000-english 10398 条…），
 * 旧代码把 `response.json()` 原样交给 UI，于是：
 * - 错题本导出 `word.trans.join('；')` 抛 `TypeError: ...join is not a function` → 导出 100% 失败；
 * - 其余依赖 `trans: string[]` 的渲染/朗读组件也会拿到字符串。
 * 这里统一成 `Word`（trans: string[]、usphone/ukphone: string），并过滤掉没有 name 的坏条目。
 */
export function normalizeWordEntry(raw: unknown): Word | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as RawWord
  if (typeof entry.name !== 'string' || entry.name.length === 0) return null
  const name = normalizeWordNameInput(entry.name)
  if (!name) return null
  const phone = normalizePhone(entry.phone)
  const usphone = normalizePhone(entry.usphone) || phone
  const ukphone = normalizePhone(entry.ukphone) || phone
  return {
    ...entry,
    name,
    trans: normalizeTrans(entry.trans),
    usphone,
    ukphone,
  } as Word
}

/** 归一化整个词库文件；根节点不是数组时抛错（错误信息可直接展示给用户） */
export function normalizeWordList(raw: unknown): Word[] {
  if (!Array.isArray(raw)) throw new Error('词库文件格式错误：根节点不是数组')
  const words: Word[] = []
  for (const item of raw) {
    const word = normalizeWordEntry(item)
    if (word) words.push(word)
  }
  return words
}

export async function wordListFetcher(url: string): Promise<Word[]> {
  // Electron 下页面通过 file:// 加载，词库地址必须使用绝对路径转相对路径
  const target = url.startsWith('/') ? '.' + url : url
  const response = await fetch(target)
  // v9.4：不再把 404/错误页当 JSON 解析（旧实现会抛 SyntaxError，用户只看到“数据加载失败”图标）
  if (!response.ok) throw new Error(`词库读取失败（HTTP ${response.status}）：${url}`)
  return normalizeWordList(await response.json())
}
