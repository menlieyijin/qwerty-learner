import Tooltip from '@/components/Tooltip'
import { autoLevelInfoAtom, currentDictInfoAtom, customDictInfoAtom, isReviewModeAtom, learningModeAtom, reviewModeInfoAtom } from '@/store'
import { useAtomValue } from 'jotai'
import { NavLink } from 'react-router-dom'

/** 词库/水平入口：默认自动进阶，显示当前水平；点击可打开词库画廊 */
export const DictButton = () => {
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const customDict = useAtomValue(customDictInfoAtom)
  const isReviewMode = useAtomValue(isReviewModeAtom)
  const reviewInfo = useAtomValue(reviewModeInfoAtom)
  const learningMode = useAtomValue(learningModeAtom)
  const levelInfo = useAtomValue(autoLevelInfoAtom)

  let label = currentDictInfo.name
  if (isReviewMode) label = reviewInfo.reviewKind === 'due' ? '到期复习' : `${currentDictInfo.name} · 错题复习`
  else if (learningMode === 'custom' && customDict) label = `自定义 · ${customDict.name}`
  else if (learningMode === 'auto') label = levelInfo ? levelInfo.name : '准备中'

  const tip = isReviewMode
    ? reviewInfo.reviewKind === 'due'
      ? '记忆曲线到期复习（答完自动回到正常出词）'
      : '错题复习模式'
    : learningMode === 'custom' && customDict
      ? `自定义词库「${customDict.name}」（${(customDict.words || []).length} 词）· 记忆曲线；点击可切换`
      : learningMode === 'auto' && levelInfo
        ? `按词汇水平循序渐进：当前 ${levelInfo.name}，未学 ${levelInfo.unseen}/${levelInfo.total}${
            levelInfo.seen != null ? `，已见 ${levelInfo.seen}` : ''
          }${levelInfo.mastered != null ? `，掌握 ${levelInfo.mastered}` : ''}${
            levelInfo.suspended ? `，待攻克 ${levelInfo.suspended}` : ''
          }${levelInfo.done ? '（本级已完成）' : ''}；点击可切换词库`
        : '切换词库（点击词库将改为手动选择）'

  return (
    <Tooltip content={tip}>
      <NavLink
        className="block whitespace-nowrap rounded-lg px-3 py-1 text-lg transition-colors duration-300 ease-in-out hover:bg-indigo-400 hover:text-white focus:outline-none dark:text-white dark:text-opacity-60 dark:hover:text-opacity-100"
        to="/gallery"
      >
        {label}
      </NavLink>
    </Tooltip>
  )
}
