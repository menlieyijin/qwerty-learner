import { dictionaryResources } from '@/resources/dictionary'
import type { Word } from '@/typings'
import { normalizeTrans } from '@/utils/trans'

export type LearningLevel = {
  id: string
  name: string
  files: string[]
}

/**
 * 自动进阶路径：从小学一年级开始，按年级/难度循序渐进。
 * 练习时无需选择词库；当当前级别全部学过后自动进入下一级。
 */
export const LEARNING_PATH: LearningLevel[] = [
  { id: 'primary-1', name: '小学一年级', files: ['PEP_SL_XiaoXue1_1_t.json', 'PEP_SL_XiaoXue1_2_t.json'] },
  { id: 'primary-2', name: '小学二年级', files: ['PEP_SL_XiaoXue2_1_t.json', 'PEP_SL_XiaoXue2_2_t.json'] },
  { id: 'primary-3', name: '小学三年级', files: ['PEPXiaoXue3_1_T.json', 'PEPXiaoXue3_2_T.json'] },
  { id: 'primary-4', name: '小学四年级', files: ['PEPXiaoXue4_1_T.json', 'PEPXiaoXue4_2_T.json'] },
  { id: 'primary-5', name: '小学五年级', files: ['PEPXiaoXue5_1_T.json', 'PEPXiaoXue5_2_T.json'] },
  { id: 'primary-6', name: '小学六年级', files: ['PEPXiaoXue6_1_T.json', 'PEPXiaoXue6_2_T.json'] },
  { id: 'junior-1', name: '初中一年级', files: ['PEPChuZhong7_1_T.json', 'PEPChuZhong7_2_T.json'] },
  { id: 'junior-2', name: '初中二年级', files: ['PEPChuZhong8_1_T.json', 'PEPChuZhong8_2_T.json'] },
  { id: 'junior-3', name: '初中三年级', files: ['PEPChuZhong9_1_T.json'] },
  {
    id: 'senior-1',
    name: '高中必修',
    files: ['PEPGaoZhong_1_T.json', 'PEPGaoZhong_2_T.json', 'PEPGaoZhong_3_T.json', 'PEPGaoZhong_4_T.json', 'PEPGaoZhong_5_T.json'],
  },
  { id: 'high-frequency', name: '高频基础词', files: ['NGSL.json'] },
  { id: 'cet4', name: '大学四级', files: ['CET4_T.json'] },
  { id: 'cet6', name: '大学六级', files: ['CET6_T.json'] },
]

const wordCache = new Map<string, Word[]>()
// v8.9：合并后的整级词表也缓存一份，避免每个新词都重新合并文件数组 + 去重
const levelCache = new Map<string, Word[]>()
const fileToDictId = new Map(dictionaryResources.map((r) => [String(r.url).split('/').pop() || '', r.id]))

function normalizeWord(w: Word): Word {
  // v10.2（dsh，F5-004）：与 useWordList / DropdownExport 的同一段逻辑合并到 normalizeTrans
  return { ...w, trans: normalizeTrans(w.trans) }
}

export async function loadDictWords(file: string): Promise<Word[]> {
  const cached = wordCache.get(file)
  if (cached) return cached
  const res = await fetch('./dicts/' + file)
  if (!res.ok) throw new Error('词库读取失败: ' + file)
  const raw = await res.json()
  const list: Word[] = (Array.isArray(raw) ? raw : []).filter((w: Word) => w && w.name).map(normalizeWord)
  wordCache.set(file, list)
  return list
}

export async function loadLevelWords(level: LearningLevel): Promise<Word[]> {
  const cachedLevel = levelCache.get(level.id)
  if (cachedLevel) return cachedLevel
  const seen = new Set<string>()
  const out: Word[] = []
  const failed: string[] = []
  for (const file of level.files) {
    try {
      const dictId = fileToDictId.get(file) || file.replace(/\.json$/i, '')
      const list = await loadDictWords(file)
      for (const w of list) {
        const k = String(w.name).toLowerCase()
        if (seen.has(k)) continue
        seen.add(k)
        out.push({ ...w, dict: dictId })
      }
    } catch (e) {
      console.error('load level word list failed', file, e)
      failed.push(file)
    }
  }
  // v9.13（M1-001）：只要有文件没读到，这一级的词表就是残缺的——不能当作完整词表使用。
  // 不写 levelCache（下次调用重试），抛给调用方：autoLevel.loadLevelWordList 会统一映射为
  // error='load-failed'（不判完成、不推进 levelId），与设计文档「抛错或空词表」语义一致。
  if (failed.length) throw new Error(`词库加载不完整（${failed.length}/${level.files.length} 个文件失败）: ${failed.join(', ')}`)
  levelCache.set(level.id, out)
  return out
}
