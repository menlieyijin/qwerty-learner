import type { Word } from '@/typings'

export async function wordListFetcher(url: string): Promise<Word[]> {
  // Electron 下页面通过 file:// 加载，词库地址必须使用相对路径
  const target = url.startsWith('/') ? '.' + url : url
  const response = await fetch(target)
  const words: Word[] = await response.json()
  return words
}
