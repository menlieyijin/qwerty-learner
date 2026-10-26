import { db } from '.'
import { getCurrentDate, recordDataAction } from '..'
import { MEMORY_MIGRATED_KEY } from '../memory'
import { clearMemoryCache } from '../memoryCache'

export type ExportProgress = {
  totalRows?: number
  completedRows: number
  done: boolean
}

export type ImportProgress = {
  totalRows?: number
  completedRows: number
  done: boolean
}

export async function exportDatabase(callback: (exportProgress: ExportProgress) => boolean) {
  const [pako, { saveAs }] = await Promise.all([import('pako'), import('file-saver'), import('dexie-export-import')])

  const blob = await db.export({
    progressCallback: ({ totalRows, completedRows, done }) => {
      return callback({ totalRows, completedRows, done })
    },
  })
  const [wordCount, chapterCount] = await Promise.all([db.wordRecords.count(), db.chapterRecords.count()])

  const json = await blob.text()
  const compressed = pako.gzip(json)
  const compressedBlob = new Blob([compressed])
  const currentDate = getCurrentDate()
  saveAs(compressedBlob, `Qwerty-Learner-User-Data-${currentDate}.gz`)
  recordDataAction({ type: 'export', size: compressedBlob.size, wordCount, chapterCount })
}

/** v9.3：导入/回滚共用的 Dexie 导入参数（清表 + 覆盖，保证“整库替换”语义） */
const IMPORT_OPTIONS = {
  acceptVersionDiff: true,
  acceptMissingTables: true,
  acceptNameDiff: false,
  acceptChangedPrimaryKey: false,
  overwriteValues: true,
  clearTablesBeforeImport: true,
}

/**
 * v9.3（数据层 P0）：官方 .gz 导入保护。
 * - 导入前先 `db.export()` 备份当前 RecordDB；备份失败则中止导入（不能在没有回滚手段时清表）；
 * - 导入成功：处理 `memoryMigratedV1` 标记 + 清空 memoryCache，然后 reload，避免“统计已变、出词仍用旧缓存”；
 * - 导入失败：用内存中的备份整库回滚并提示；回滚也失败时强提示停止使用。
 */
export async function importDatabase(onStart: () => void, callback: (importProgress: ImportProgress) => boolean) {
  const [pako] = await Promise.all([import('pako'), import('dexie-export-import')])

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/gzip'
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file) return

    onStart()

    // 1) 导入前快照：导出失败直接中止（此时数据库还没有被清空）
    let backupBlob: Blob | null = null
    try {
      backupBlob = await db.export({
        // 备份大库可能耗时，复用导入进度条，避免看起来“卡在 0%”
        progressCallback: ({ totalRows, completedRows }) => {
          callback({ totalRows, completedRows, done: false })
          return true
        },
      })
    } catch (error) {
      console.error('备份当前数据失败，已中止导入：', error)
      callback({ totalRows: 0, completedRows: 0, done: true })
      window.alert(`导入已中止：创建导入前备份失败，为避免数据丢失未执行导入。\n\n${String((error as Error)?.message || error)}`)
      return
    }
    const snapshot = backupBlob
    if (!snapshot) return

    // 2) 解析 + 导入；任何一步失败都要能回到 snapshot
    let importStarted = false
    try {
      const compressed = await file.arrayBuffer()
      const json = pako.ungzip(compressed, { to: 'string' })
      const blob = new Blob([json])

      importStarted = true
      await db.import(blob, {
        ...IMPORT_OPTIONS,
        progressCallback: ({ totalRows, completedRows, done }) => {
          return callback({ totalRows, completedRows, done })
        },
      })
    } catch (error) {
      console.error('数据导入失败：', error)
      const reason = String((error as Error)?.message || error)
      let restored = false
      if (importStarted) {
        try {
          await db.import(snapshot, {
            ...IMPORT_OPTIONS,
            progressCallback: () => true,
          })
          restored = true
        } catch (restoreError) {
          console.error('恢复导入前备份失败：', restoreError)
        }
        // 无论回滚是否成功，内存缓存都不可信，必须清掉
        clearMemoryCache()
      }
      callback({ totalRows: 0, completedRows: 0, done: true })
      if (!importStarted) {
        window.alert(`导入失败：文件无法解析，或不是有效的 Qwerty Learner 数据备份。\n\n${reason}`)
      } else if (restored) {
        window.alert(`导入失败，已恢复到导入前的数据，应用将重新加载。\n\n原因：${reason}`)
        window.location.reload()
      } else {
        window.alert(`导入失败，且自动恢复也失败！请立即停止操作并重启应用，再用最近一次备份恢复。\n\n原因：${reason}`)
      }
      return
    }

    // 3) 导入已成功：以下步骤失败只记录，不再回滚（避免把成功导入的数据又覆盖回去）
    try {
      // 迁移标记：有 memoryRecords 时必须保留/写入标记，否则 memory.ts 迁移会用 wordRecords 聚合值
      // bulkPut 覆盖导入的 SRS 档位；只有“导入后没有任何记忆曲线记录”时才清空，让迁移按旧练习记录重建。
      const [memoryCount, wordCount] = await Promise.all([db.memoryRecords.count(), db.wordRecords.count()])
      if (memoryCount > 0 || wordCount === 0) {
        localStorage.setItem(MEMORY_MIGRATED_KEY, String(Date.now()))
      } else {
        localStorage.removeItem(MEMORY_MIGRATED_KEY)
      }
    } catch (error) {
      console.error('处理记忆曲线迁移标记失败：', error)
    }
    clearMemoryCache()
    // v9.3：导入后清掉本机的自动进阶/复习会话状态，让新数据重建级别，避免沿用旧机器的 skip/级别
    try {
      localStorage.removeItem('qzAutoLevelState')
      localStorage.removeItem('qzReevaluateLevel')
      localStorage.removeItem('qzDueReviewWords')
      localStorage.removeItem('reviewModeInfo')
    } catch { /* ignore */ }

    try {
      const [wordCount, chapterCount] = await Promise.all([db.wordRecords.count(), db.chapterRecords.count()])
      const totalRows = wordCount + chapterCount
      recordDataAction({ type: 'import', size: file.size, wordCount, chapterCount })
      callback({ totalRows, completedRows: totalRows, done: true })
    } catch (error) {
      console.error('导入后统计上报失败：', error)
    }

    // 4) 成功：缓存已清空，重载保证统计/出词与导入后的数据库完全一致
    //    （不弹确认框，避免阻塞/影响自动化；DataSetting 的进度条已到 100%）
    window.location.reload()
  })

  input.click()
}
