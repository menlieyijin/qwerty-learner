/**
 * v9.3 仿真专用 db/record stub：
 * 真实 record.ts 依赖 src/utils/index.ts（navigator / mixpanel / howler），Node 下无法加载，
 * 而 db/index.ts 只在 saveWordRecord/saveChapterRecord（仿真不调用的 hook）里构造这些类，
 * 因此这里给出最小可构造实现，迁移/更新进度路径只用普通对象。
 */
export class WordRecord {
  constructor(word, dict, chapter, timing, wrongCount, mistakes) {
    this.word = word
    this.dict = dict
    this.chapter = chapter
    this.timing = timing || []
    this.wrongCount = wrongCount
    this.mistakes = mistakes || {}
    this.timeStamp = 0
  }
  get totalTime() {
    return this.timing.reduce((acc, cur) => acc + cur, 0)
  }
}

export class ChapterRecord {
  constructor(...args) {
    this.args = args
    this.timeStamp = 0
  }
}

export class ReviewRecord {
  constructor(...args) {
    this.args = args
  }
}
