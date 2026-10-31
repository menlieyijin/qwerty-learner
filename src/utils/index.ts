/**
 * `@/utils` 对外入口（v10.6，dsh 重构）。
 *
 * 原先这里是 168 行的「什么都放」文件：键盘判定、平台判定、Howl 监听、日期格式化、数值取整、
 * 数组交集挤在一起，改任意一处都要在同一文件里来回翻。现在按领域拆到同目录的小文件，
 * **本文件退化为纯 re-export**，对外 API 与全部调用点保持不变（`import { isLegal } from '@/utils'` 仍然有效）。
 *
 * 新增工具时请直接放进对应领域文件，不要再往这里堆实现：
 * - 键盘 / 输入字符判定 → `./keyboard`
 * - 平台与快捷键文案 → `./platform`
 * - 时间戳与格式化 → `./time`
 * - 通用数值 / 数组 → `./number`
 * - 章节词数 → `./chapter`
 * - 音频监听包装 → `./audio`
 *
 * 不再转出 mixpanel（历史原因）：那个 barrel 透出会把 mixpanel（import store / pages 类型）拖进所有
 * 使用本 barrel 的模块的依赖图，形成 dictionary → utils → mixpanel → store → dictionary 大环。
 * 需要上报函数的模块请直接从 `@/utils/mixpanel` 导入。
 */

export { addHowlListener } from './audio'
export { calcChapterCount } from './chapter'
export { isChineseSymbol, isLegal } from './keyboard'
export { findCommonValues, toFixedNumber } from './number'
export { CTRL, IS_MAC_OS, IsDesktop } from './platform'
export { formatDate, getCurrentDate, getUTCUnixTimestamp, timeStamp2String } from './time'
