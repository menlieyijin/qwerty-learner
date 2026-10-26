import { idDictionaryMap } from '@/resources/dictionary'
import type { Word } from '@/typings'
import { wordListFetcher } from '@/utils/wordListFetcher'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { saveAs } from 'file-saver'
import type { FC } from 'react'
import { useState } from 'react'
import * as XLSX from 'xlsx'

/** 导出只需要这几个字段；与 ErrorBook 里 groupedWordRecords 结构兼容（结构性类型，无需耦合其定义） */
export type ExportableRecord = {
  word: string
  dict: string
  wrongCount: number
}

type DropdownProps = {
  renderRecords: ExportableRecord[]
}

const DropdownExport: FC<DropdownProps> = ({ renderRecords }) => {
  const [isExporting, setIsExporting] = useState(false)

  const formatTimestamp = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0') // 月份从0开始
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const seconds = String(date.getSeconds()).padStart(2, '0')

    return `${year}-${month}-${day} ${hours}-${minutes}-${seconds}`
  }

  const handleExport = async (bookType: string) => {
    setIsExporting(true)

    try {
      // 获取所有需要的词典数据
      const dictUrls: string[] = []
      renderRecords.forEach((item) => {
        const dictInfo = idDictionaryMap[item.dict]
        if (dictInfo?.url && !dictUrls.includes(dictInfo.url)) {
          dictUrls.push(dictInfo.url)
        }
      })

      // 并行获取所有词典数据
      const dictDataPromises = dictUrls.map(async (url) => {
        try {
          const data = await wordListFetcher(url)
          return { url, data }
        } catch (error) {
          console.error(`Failed to fetch dictionary data from ${url}:`, error)
          return { url, data: [] }
        }
      })

      const dictDataResults = await Promise.all(dictDataPromises)
      const dictDataMap = new Map(dictDataResults.map((result) => [result.url, result.data]))

      const ExportData: Array<{ 单词: string; 释义: string; 错误次数: number; 词典: string }> = []

      renderRecords.forEach((item) => {
        const dictInfo = idDictionaryMap[item.dict]
        let translation = ''

        if (dictInfo?.url && dictDataMap.has(dictInfo.url)) {
          const wordList: Word[] = dictDataMap.get(dictInfo.url) || []
          const word = wordList.find((w) => w && w.name === item.word)
          // v9.4（数据层 P2 修复，原 DATA-005）：wordListFetcher 已把 trans 归一化为 string[]，
          // 这里再做一层防御（旧缓存/第三方词库可能仍是字符串或 null），避免整份导出抛 TypeError。
          const rawTrans: unknown = word?.trans
          const trans = Array.isArray(rawTrans)
            ? rawTrans.filter((t): t is string => typeof t === 'string')
            : rawTrans == null
            ? []
            : [String(rawTrans)]
          translation = trans.join('；')
        }

        ExportData.push({
          单词: item.word,
          释义: translation,
          错误次数: item.wrongCount,
          词典: dictInfo?.name || item.dict,
        })
      })

      let blob: Blob

      if (bookType === 'txt') {
        const content = ExportData.map((item) => `${item.单词}: ${item.释义}`).join('\n')
        blob = new Blob([content], { type: 'text/plain' })
      } else {
        const worksheet = XLSX.utils.json_to_sheet(ExportData)
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
        const excelBuffer = XLSX.write(workbook, { bookType: bookType as XLSX.BookType, type: 'array' })
        blob = new Blob([excelBuffer], { type: 'application/octet-stream' })
      }

      const timestamp = formatTimestamp(new Date())
      const fileName = `ErrorBook_${timestamp}.${bookType}`

      if (blob && fileName) {
        saveAs(blob, fileName)
      }
    } catch (error) {
      console.error('Export failed:', error)
      alert('导出失败，请重试')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="z-10">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="my-btn-primary h-8 shadow transition hover:bg-indigo-600 disabled:opacity-50" disabled={isExporting}>
            {isExporting ? '导出中...' : '导出'}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content className="mt-1 rounded bg-indigo-500 text-white shadow-lg">
          <DropdownMenu.Item
            className="cursor-pointer rounded px-4 py-2 hover:bg-indigo-400 focus:bg-indigo-600 focus:outline-none"
            onClick={() => handleExport('xlsx')}
            disabled={isExporting}
          >
            .xlsx
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="cursor-pointer rounded px-4 py-2 hover:bg-indigo-600 focus:bg-indigo-600 focus:outline-none"
            onClick={() => handleExport('csv')}
            disabled={isExporting}
          >
            .csv
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  )
}

export default DropdownExport
