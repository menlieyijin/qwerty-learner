import bookCover from '@/assets/book-cover.png'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { currentDictIdAtom, learningModeAtom, reviewModeInfoAtom } from '@/store'
import type { Dictionary } from '@/typings'
import * as Progress from '@radix-ui/react-progress'
import { useAtomValue, useSetAtom } from 'jotai'
import { useMemo } from 'react'
import type { KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * v9.5（数据修复 DATA-010）：词库「唯一词数」覆盖表。
 *
 * 背景：public/dicts 有 136+ 个词库存在重复词条（完全同名，合计 1.2 万+ 条），而 dictionary.ts 的
 * `length` 是文件条数。memoryRecords 按单词去重保存，所以用 `learned / length` 算进度永远到不了 100%
 * （如 coca20000 最多 87%）。这里只为「唯一词数 !== length」的词库提供覆盖值，进度分母统一走
 * `getDictTotalWordCount`。
 *
 * 生成/更新脚本：数据层复现脚本 gen-dict-unique-counts.mjs（来自本地 audit 数据层工具，不入库）。
 * （数据文件变更后重新生成 _dict-unique-counts.generated.json，再跑 _patch-data010-gallery.mjs）
 */
const DICT_UNIQUE_WORD_COUNTS: Record<string, number> = {
  '2025KaoYanHongBaoShu': 6702,
  '3000_ClassRoom_English_Words': 2987,
  '4000_Essential_English_Words1': 3593,
  '4000_Essential_English_Words2': 3593,
  'adult self-study examination': 3690,
  'ai-machine-learning': 725,
  archVocabulary: 542,
  ba2: 463,
  'biomedical-terms': 536,
  BJJuniorHigh: 1839,
  Cambridge_JOIN_IN: 1232,
  Categorized_TOEFL_Vocabulary_by_Zhanghongyan: 3669,
  'cet4-sub': 1679,
  'cet6-sub': 1748,
  coca_20000: 17633,
  dancimimi_1: 4264,
  dancimimi_2: 2854,
  DuckCircle_IELTS: 2607,
  Duolingo_Vocabulary_C1: 1313,
  eflevel1: 255,
  eflevel10: 170,
  eflevel11: 170,
  eflevel12: 166,
  eflevel13: 169,
  eflevel14: 167,
  eflevel15: 162,
  eflevel16: 169,
  eflevel2: 316,
  eflevel3: 168,
  eflevel4: 177,
  eflevel5: 170,
  eflevel6: 167,
  eflevel7: 167,
  eflevel8: 168,
  eflevel9: 161,
  en2german: 5020,
  English_II: 4549,
  'gaokao-yuedu-gaopin': 681,
  gaokao3500: 3875,
  gaokaozhentihexin: 689,
  german2en: 5829,
  gre: 6514,
  GRE_ciyileiji: 8384,
  gre1500: 1532,
  gre3000: 3036,
  heqiong: 2470,
  'hongbaoshu-2026': 4770,
  IELTS_tinglichangjing: 1171,
  'IELTS-807': 4113,
  'IELTS-listening-18-days-14': 75,
  'IELTS-listening-18-days-15': 75,
  'IELTS-listening-18-days-2': 76,
  'IELTS-listening-18-days-5': 75,
  'IELTS-listening-18-days-6': 75,
  'IELTS-listening-18-days-8': 75,
  'IELTS-listening-18-days-9': 75,
  IELTS9988wangyong: 3644,
  IELTSKingLu807: 1852,
  IELTSVocabularyBible: 3630,
  ieltsWang11: 1611,
  ieltsWang3: 1134,
  ieltsWang5: 1568,
  IELTSXDF7000: 5475,
  indonesian_highFrequency_3043: 3028,
  'japanese-hiragana': 279,
  'japanese-katakana': 279,
  japanese0010: 1921,
  japanese002: 646,
  'japanese002-zh': 646,
  japanese003: 625,
  'japanese003-zh': 625,
  japanese004: 1702,
  'japanese004-zh': 1702,
  japanese005: 1776,
  'japanese005-zh': 1776,
  japanese006: 3282,
  'japanese006-zh': 3282,
  japanese007: 2937,
  japanese008: 2426,
  japanese009: 1957,
  javaLinkedList: 22,
  javaString: 33,
  javaStringBuffer: 17,
  jijiao1: 74,
  jijiao10: 513,
  jijiao4: 83,
  jijiao6: 89,
  jijiao9: 557,
  jsMapSet: 10,
  kaoyan: 3727,
  kaoyanshanguo2025: 2254,
  kazakh_basic_3000_arabic_hapin: 2985,
  kazakh_basic_3000_cyrillic_hapin: 2985,
  ket: 892,
  longman_communication_3000_words: 3158,
  Macmillan7000: 6265,
  'nce-new-1': 867,
  'nce-new-2': 840,
  'nce-new-3': 1050,
  'nce-new-4': 784,
  nce1: 861,
  nce2: 833,
  nce3: 1038,
  nce4: 775,
  'new-waiyan2': 305,
  'oi-xcpc': 190,
  Oxford3000: 1339,
  Oxford5000: 5499,
  'pep-sl-liu1': 100,
  'pep-sl-san1': 101,
  'pep-sl-si2': 86,
  'pet-2024': 1537,
  pets3: 1941,
  'pets3-2023': 4441,
  PTE_Basic_apeuni: 2651,
  'python-date': 37,
  sat: 4463,
  SATen: 2679,
  'self-study_English1': 1798,
  'self-study_English2': 2172,
  'self-study_English3': 4167,
  SHjuniormiddleOxford: 1258,
  SoundSfxKey: 405,
  tingshuokaoshi: 539,
  TOEFL_ZhangHongYan: 3560,
  waiyan1: 619,
  waiyan11: 117,
  waiyan12: 109,
  waiyan14: 104,
  waiyan15: 111,
  waiyan18: 71,
  waiyan2: 430,
  waiyan3: 317,
  'waiyan3-2': 154,
  waiyan4: 263,
  'waiyan4-2': 130,
  waiyan5: 378,
  'waiyan5-1': 150,
  'waiyan5-2': 144,
  waiyan6: 127,
  waiyan7: 410,
  xinghuoqiaoji_4: 2422,
  xinghuoqiaoji_6: 6005,
  Yilin1: 275,
  Yilin2: 295,
  ZaiYaoNiMing_GRE3000: 3034,
  zhongkaohexin: 2135,
  'zhuan-cha-ben-ying-yu': 3216,
  'zhuan-sheng-ben-xue-shi': 896,
}

/** 词库的真实「唯一词数」（用于进度分母；无覆盖时退回 dictionary.ts 的 length） */
export function getDictTotalWordCount(dict: Dictionary): number {
  const unique = DICT_UNIQUE_WORD_COUNTS[dict.id]
  return typeof unique === 'number' && unique > 0 ? unique : dict.length
}

// v9.14（dsh，M4-011）：已学词数的统计（含 loadMemoryRows 的 5s 复用缓存）已提升到词库页，
// 由 useLearnedCounts 统一算一次；卡片只按 id 查表，不再各自跑全量 canonicalize。

interface Props {
  dictionary: Dictionary
  /** v9.14（dsh，M4-011）：父级算好的已学词数；null 表示尚未读到（与原实现一样隐藏「已学 N」） */
  learnedCount: number | null
}

export default function DictionaryComponent({ dictionary, learnedCount }: Props) {
  const currentDictID = useAtomValue(currentDictIdAtom)
  const learningMode = useAtomValue(learningModeAtom)
  const setLearningMode = useSetAtom(learningModeAtom)
  const setCurrentDictID = useSetAtom(currentDictIdAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const navigate = useNavigate()

  const totalWords = getDictTotalWordCount(dictionary)
  const progress = useMemo(
    () => (learnedCount === null ? 0 : Math.min(100, Math.round((learnedCount / Math.max(1, totalWords)) * 100))),
    [learnedCount, totalWords],
  )
  const isSelected = learningMode === 'manual' && currentDictID === dictionary.id

  const onChoose = () => {
    setLearningMode('manual')
    setCurrentDictID(dictionary.id)
    setReviewModeInfo(() => ({ isReviewMode: false, reviewRecord: undefined }))
    navigate('/')
  }

  // PAGES-009：role="button" 的 div 补键盘可达（Tab 聚焦 + Enter/Space 触发）
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onChoose()
    }
  }

  return (
    <div
      onClick={onChoose}
      onKeyDown={onKeyDown}
      title="开始记忆曲线练习（随机出词，不分章节）"
      className={`group flex h-36 w-80 cursor-pointer items-center justify-center overflow-hidden rounded-lg p-4 text-left shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
        isSelected ? 'bg-indigo-400' : 'bg-zinc-50 hover:bg-white dark:bg-gray-800 dark:hover:bg-gray-700'
      }`}
      role="button"
      tabIndex={0}
      aria-label={`选择词典「${dictionary.name}」，共 ${totalWords} 词`}
    >
      <div className="relative ml-1 mt-2 flex h-full w-full flex-col items-start justify-start">
        <h1
          className={`mb-1.5 text-xl font-normal  ${
            isSelected ? 'text-white' : 'text-gray-800 group-hover:text-indigo-400 dark:text-gray-200'
          }`}
        >
          {dictionary.name}
        </h1>
        <TooltipProvider>
          <Tooltip delayDuration={400}>
            <TooltipTrigger asChild>
              <p className={`mb-1 max-w-full truncate ${isSelected ? 'text-white' : 'text-gray-600 dark:text-gray-200'} whitespace-nowrap`}>
                {dictionary.description}
              </p>
            </TooltipTrigger>
            <TooltipContent>
              <p>{`${dictionary.description}`}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <p className={`mb-0.5 font-bold  ${isSelected ? 'text-white' : 'text-gray-600 dark:text-gray-200'}`}>
          {totalWords} 词{learnedCount !== null ? ` · 已学 ${learnedCount}` : ''}
        </p>
        <div className=" flex w-full items-center pt-2">
          {progress > 0 && (
            <Progress.Root
              value={progress}
              max={100}
              className={`mr-4 h-2 w-full rounded-full border  bg-white ${isSelected ? 'border-indigo-600' : 'border-indigo-400'}`}
            >
              <Progress.Indicator
                className={`h-full rounded-full pl-0 ${isSelected ? 'bg-indigo-600' : 'bg-indigo-400'}`}
                style={{ width: `calc(${progress}% )` }}
              />
            </Progress.Root>
          )}
          <img src={bookCover} alt="" className={`absolute right-3 top-3 w-16 ${isSelected ? 'opacity-50' : 'opacity-20'}`} />
        </div>
      </div>
    </div>
  )
}
