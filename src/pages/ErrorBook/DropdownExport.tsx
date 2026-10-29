import { idDictionaryMap } from '@/resources/dictionary'
import type { Word } from '@/typings'
import { formatDate } from '@/utils'
import { csvSafeCell } from '@/utils/csvSafe'
import { normalizeTrans } from '@/utils/trans'
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
          // v10.2（dsh，F5-004）：与 learningPath / useWordList 的同一段逻辑合并到 normalizeTrans
          const trans = normalizeTrans(word?.trans)
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
        // v9.19（dsh，F5-001）：.csv 是纯文本、没有单元格类型，以 `=` `+` `-` `@` 开头的内容会被
        // Excel / WPS 当成公式执行（CSV injection）；.xlsx 由 SheetJS 写成 t:"s" 字符串单元格（已实测），
        // 不会被执行，因此只对 csv 加前缀，避免改变 xlsx 的内容。
        const rows =
          bookType === 'csv'
            ? ExportData.map((item) => ({
                单词: csvSafeCell(item.单词),
                释义: csvSafeCell(item.释义),
                错误次数: item.错误次数,
                词典: csvSafeCell(item.词典),
              }))
            : ExportData
        const worksheet = XLSX.utils.json_to_sheet(rows)
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
        const excelBuffer = XLSX.write(workbook, { bookType: bookType as XLSX.BookType, type: 'array' })
        blob = new Blob([excelBuffer], { type: 'application/octet-stream' })
      }

      // v9.14（dsh，M4-015）：日期格式化改用公共 formatDate（输出与原先手写实现逐字符一致）
      const timestamp = formatDate(new Date())
      const fileName = `ErrorBook_${timestamp}.${bookType}`

      // v9.14（dsh，M4-018）：blob 与 fileName 在上文两个分支都已赋值，原 `if (blob && fileName)` 是恒真判断
      saveAs(blob, fileName)
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
