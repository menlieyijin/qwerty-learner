/**
 * 章节计算（v10.6，dsh：从 `utils/index.ts` 抽出）。
 *
 * 单独成文件是为了让「每章多少词」这一个业务口径只有一个入口：`CHAPTER_LENGTH` 改动时，
 * 页面分页、进度计算、章节记录都从这里走，不会各算各的。
 */
import { CHAPTER_LENGTH } from '@/constants'

/** 按每章固定词数计算总章数（向上取整） */
export function calcChapterCount(length: number) {
  return Math.ceil(length / CHAPTER_LENGTH)
}
