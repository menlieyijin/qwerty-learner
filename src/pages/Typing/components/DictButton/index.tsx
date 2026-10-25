import Tooltip from '@/components/Tooltip'
import { autoLevelInfoAtom, currentDictInfoAtom, isReviewModeAtom, learningModeAtom } from '@/store'
import { useAtomValue } from 'jotai'
import { NavLink } from 'react-router-dom'

/** 词库/水平入口：默认自动进阶，显示当前水平；点击可打开词库画廊 */
export const DictButton = () => {
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const isReviewMode = useAtomValue(isReviewModeAtom)
  const learningMode = useAtomValue(learningModeAtom)
  const levelInfo = useAtomValue(autoLevelInfoAtom)

  let label = currentDictInfo.name
  if (isReviewMode) label = `${currentDictInfo.name} · 错题复习`
  else if (learningMode === 'auto') label = levelInfo ? levelInfo.name : '准备中'

  const tip =
    learningMode === 'auto' && levelInfo
      ? `按词汇水平循序渐进（当前 ${levelInfo.name}，本级别剩余 ${levelInfo.unseen}/${levelInfo.total} 词）；点击可切换词库`
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
