import atomForConfig from './atomForConfig'
import { reviewInfoAtom } from './reviewInfoAtom'
import { safeStorage } from './storage'
import { defaultFontSizeConfig } from '@/constants'
import { idDictionaryMap } from '@/resources/dictionary'
import { correctSoundResources, keySoundResources, wrongSoundResources } from '@/resources/soundResource'
import type {
  CustomDict,
  Dictionary,
  LoopWordTimesOption,
  PhoneticType,
  PronunciationType,
  WordDictationOpenBy,
  WordDictationType,
} from '@/typings'
import type { ReviewRecord } from '@/utils/db/record'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

// M6-003：以下 atomWithStorage 均传入 safeStorage（写失败只告警、读失败回默认），键名与序列化格式不变
export const currentDictIdAtom = atomWithStorage('currentDict', 'cet4', safeStorage<string>())
/** v7：自动进阶（默认）/ 手动选择词库 / v8.4 自定义词库 */
export const learningModeAtom = atomWithStorage<'auto' | 'manual' | 'custom'>(
  'learningMode',
  'auto',
  safeStorage<'auto' | 'manual' | 'custom'>(),
)
/** v8.4：增强面板导入的自定义词库（localStorage 桥接，供主练习流程读取） */
export const customDictInfoAtom = atomWithStorage<CustomDict | null>('qzCustomDict', null, safeStorage<CustomDict | null>())
export type AutoLevelInfo = {
  id: string
  name: string
  index: number
  unseen: number
  total: number
  done: boolean
  seen?: number
  mastered?: number
  suspended?: number
}
export const autoLevelInfoAtom = atom<AutoLevelInfo | null>(null)
export const currentDictInfoAtom = atom<Dictionary>((get) => {
  const id = get(currentDictIdAtom)
  let dict = idDictionaryMap[id]
  // 如果 dict 不存在，则返回 cet4. Typing 中会检查 DictId 是否存在，如果不存在则会重置为 cet4
  if (!dict) {
    dict = idDictionaryMap.cet4
  }
  return dict
})

export const currentChapterAtom = atomWithStorage('currentChapter', 0, safeStorage<number>())

export const loopWordConfigAtom = atomForConfig<{ times: LoopWordTimesOption }>('loopWordConfig', {
  times: 1,
})

export const keySoundsConfigAtom = atomForConfig('keySoundsConfig', {
  isOpen: true,
  isOpenClickSound: true,
  volume: 1,
  resource: keySoundResources[0],
})

export const hintSoundsConfigAtom = atomForConfig('hintSoundsConfig', {
  isOpen: true,
  volume: 1,
  isOpenWrongSound: true,
  isOpenCorrectSound: true,
  wrongResource: wrongSoundResources[0],
  correctResource: correctSoundResources[0],
})

export const pronunciationConfigAtom = atomForConfig('pronunciation', {
  isOpen: true,
  volume: 1,
  type: 'us' as PronunciationType,
  name: '美音',
  isLoop: false,
  isTransRead: false,
  transVolume: 1,
  rate: 1,
})

export const fontSizeConfigAtom = atomForConfig('fontsize', defaultFontSizeConfig)

export const pronunciationIsOpenAtom = atom((get) => get(pronunciationConfigAtom).isOpen)

export const randomConfigAtom = atomForConfig('randomConfig', {
  isOpen: false,
})

export const isShowPrevAndNextWordAtom = atomWithStorage('isShowPrevAndNextWord', true, safeStorage<boolean>())

export const isIgnoreCaseAtom = atomWithStorage('isIgnoreCase', true, safeStorage<boolean>())

export const isShowAnswerOnHoverAtom = atomWithStorage('isShowAnswerOnHover', true, safeStorage<boolean>())

export const isTextSelectableAtom = atomWithStorage('isTextSelectable', false, safeStorage<boolean>())

export const reviewModeInfoAtom = reviewInfoAtom({
  isReviewMode: false,
  reviewRecord: undefined as ReviewRecord | undefined,
})
export const isReviewModeAtom = atom((get) => get(reviewModeInfoAtom).isReviewMode)

export const phoneticConfigAtom = atomForConfig('phoneticConfig', {
  isOpen: true,
  type: 'us' as PhoneticType,
})

export const isOpenDarkModeAtom = atomWithStorage(
  'isOpenDarkModeAtom',
  window.matchMedia('(prefers-color-scheme: dark)').matches,
  safeStorage<boolean>(),
)

export const wordDictationConfigAtom = atomForConfig('wordDictationConfig', {
  isOpen: false,
  type: 'hideAll' as WordDictationType,
  openBy: 'auto' as WordDictationOpenBy,
})
