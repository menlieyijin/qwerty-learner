import { db } from '.'
import { getCurrentDate } from '..'
import { MEMORY_KEY_CASE_MIGRATED_KEY, MEMORY_MIGRATED_KEY } from '../memory'
import { clearMemoryCache } from '../memoryCache'
import { recordDataAction } from '../mixpanel'
import { cleanupStaleTempImportDbs, createTempImportDbName } from './temp-import-db'
import { DUE_REVIEW_WORDS_STORAGE_KEY, REVALUATE_LEVEL_STORAGE_KEY, REVIEW_MODE_INFO_STORAGE_KEY } from '@/constants'
import { AUTO_LEVEL_STORAGE_KEY } from '@/utils/autoLevel'
import Dexie from 'dexie'
import type * as PakoModule from 'pako'

export type ExportProgress = {
  totalRows?: number
  completedRows: number
  done: boolean
  /** v9.12（M2-002）：仅在 `done` 时出现；true 表示本次导出失败，UI 不要把进度条推到 100% */
  failed?: boolean
}

export type ImportProgress = {
  totalRows?: number
  completedRows: number
  done: boolean
  /** v9.12（M2-007）：仅在 `done` 时出现；true 表示本次导入失败（已回滚/主库未动） */
  failed?: boolean
}

/** v9.4：写入主库时每次 bulkPut 的行数（太大容易让单个 IDB 请求过重，太小则事务回调过多） */
const COPY_CHUNK_SIZE = 1000
/** v9.4：导入失败时区分“文件本身有问题”（主库完全没动）与“写入失败”（已整体回滚） */
class ImportFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportFileError'
  }
}

/** pako 解压成 Blob（解压出的 JSON 字符串在此函数返回后即可被回收，避免大备份双重占用内存） */
function ungzipToBlob(pako: typeof PakoModule, compressed: ArrayBuffer): Blob {
  const json = pako.ungzip(compressed, { to: 'string' })
  return new Blob([json])
}

/**
 * v9.12（M2-009）：导出文件名时间戳 `YYYYMMDD-HHmmss`（补零风格与 `getCurrentDate` 一致）。
 * 只加时分秒，扩展名与下载目录不变；同一天多次导出不再得到无法区分/排序的两份备份。
 */
function exportFileStamp(): string {
  const now = new Date()
  const pad = (value: number) => ('0' + value).slice(-2)
  return `${getCurrentDate()}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

export async function exportDatabase(callback: (exportProgress: ExportProgress) => boolean) {
  try {
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
    saveAs(compressedBlob, `Qwerty-Learner-User-Data-${exportFileStamp()}.gz`)
    recordDataAction({ type: 'export', size: compressedBlob.size, wordCount, chapterCount })
  } catch (error) {
    // v9.12（M2-002）：db.export 之后还有 count / text() / gzip / saveAs 四个可能抛错的步骤，
    // 原先没有任何 catch —— 任一抛错都会让 DataSetting 的 isExporting 停在 true（导出按钮永久禁用）
    // 且进度条停在中间值、无提示。这里只补失败路径（成功路径与之前逐字相同）。
    console.error('数据导出失败：', error)
    window.alert(`导出失败：${String((error as Error)?.message || error)}\n\n练习数据未受影响，可重试。`)
    // 复位按钮与进度条；failed=true 让 UI 不要把失败显示成 100%（与 M2-007 同一处类型追加）
    callback({ totalRows: 0, completedRows: 0, done: true, failed: true })
  }
}

/**
 * v9.4（数据层 P1 修复，原 DATA-001）：导入原子化，替换 v9.3 的“先 db.export 快照 → 直接
 * db.import({clearTablesBeforeImport:true}) → 失败时再导入快照”方案。
 *
 * v9.3 方案的真实风险：dexie-export-import@4.x 的 `importInto` 会**先逐表 clear（各自独立隐式
 * 事务并立即提交）**，之后才开 `db.transaction('rw', ...)` 写入；备份只存在内存里，所以清表后
 * 关窗/崩溃/断电 = 5 张表全空且无可回滚手段（不可恢复）。
 *
 * v9.4 流程（主库只在“一次性 rw 事务”里被改动）：
 * 1) 解压 -> `peakImportFile` 读头部（formatName / databaseName / tables 架构），任何格式问题都在
 *    触碰主库之前抛错；
 * 2) 建**唯一命名的临时 Dexie 库**（架构取自备份自身，兼容旧版本备份缺表），`importInto` 只写临时库，
 *    失败/关窗都碰不到主库；导入后逐表校验行数与备份声明一致（防止截断/损坏的备份写进主库）；
 * 3) 从临时库读出 4 张主库表的全部数据到内存，然后在**单个 `db.transaction('rw', db.tables)`
 *    内先 clear 再分块 bulkPut** —— 清表与写入同一事务，失败自动整体回滚，主库保持导入前状态；
 * 4) 成功后：迁移标记 + 清 memoryCache + 清本机自动进阶/复习状态 + 上报 + reload（逻辑同 v9.3）；
 * 5) `finally` 关闭并删除临时库（含清理历史残留临时库）。
 */
export async function importDatabase(onStart: () => void, callback: (importProgress: ImportProgress) => boolean) {
  const [pako, { importInto, peakImportFile }] = await Promise.all([import('pako'), import('dexie-export-import')])

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/gzip'
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file) return

    onStart()

    let tempDb: Dexie | null = null
    let tempDbName = ''
    let succeeded = false
    /** 是否已经进入“写主库”的阶段：用于区分“文件/备份有问题（主库没动）”与“写入失败（已回滚）” */
    let mainWriteStarted = false

    try {
      // ---------- 1) 解压 + 头部校验：全部在碰主库之前 ----------
      const compressed = await file.arrayBuffer()
      const exportBlob = ungzipToBlob(pako, compressed)
      callback({ totalRows: 0, completedRows: 0, done: false })

      const meta = await peakImportFile(exportBlob)
      if (!meta || meta.formatName !== 'dexie' || !meta.data) {
        throw new ImportFileError('文件不是有效的 Dexie 数据库导出文件')
      }
      const exportedName = String(meta.data.databaseName || '')
      if (exportedName !== db.name) {
        throw new ImportFileError(`备份来自其它数据库（${exportedName || '未知'}），不是 Qwerty Learner 的练习数据`)
      }
      const exportedTables = Array.isArray(meta.data.tables) ? meta.data.tables : []
      if (exportedTables.length === 0) {
        throw new ImportFileError('备份文件中没有任何数据表')
      }

      // ---------- 2) 导入唯一命名的临时库：失败不影响主库 ----------
      await cleanupStaleTempImportDbs()
      tempDbName = createTempImportDbName()
      tempDb = new Dexie(tempDbName)
      tempDb
        .version(Number(meta.data.databaseVersion) || 1)
        .stores(Object.fromEntries(exportedTables.map((table) => [table.name, table.schema])))
      await tempDb.open()

      await importInto(tempDb, exportBlob, {
        // 临时库名与备份中的 RecordDB 不同，只在这里放宽
        acceptNameDiff: true,
        acceptMissingTables: true,
        acceptVersionDiff: true,
        overwriteValues: true,
        clearTablesBeforeImport: true,
        progressCallback: ({ totalRows, completedRows, done }) => callback({ totalRows, completedRows, done }),
      })

      // 行数校验：截断/损坏的备份不能写进主库
      const exportedRowCounts = new Map(exportedTables.map((table) => [table.name, Number(table.rowCount) || 0]))
      for (const table of db.tables) {
        if (!exportedRowCounts.has(table.name)) continue
        const expected = exportedRowCounts.get(table.name) || 0
        const actual = await tempDb.table(table.name).count()
        if (actual !== expected) {
          throw new ImportFileError(`备份数据不完整：${table.name} 应为 ${expected} 行，实际 ${actual} 行`)
        }
      }

      // ---------- 3) 读出临时库数据（旧备份缺少的表按空表处理，即导入后清空） ----------
      const payload: Array<{ name: string; rows: unknown[] }> = []
      for (const table of db.tables) {
        if (!exportedRowCounts.has(table.name)) continue
        payload.push({ name: table.name, rows: await tempDb.table(table.name).toArray() })
      }
      const totalRows = payload.reduce((sum, item) => sum + item.rows.length, 0)

      // ---------- 4) 主库单事务：先全表 clear 再分块 bulkPut（失败整体回滚） ----------
      let completedRows = 0
      mainWriteStarted = true
      await db.transaction('rw', db.tables, async () => {
        for (const table of db.tables) {
          await table.clear()
          const source = payload.find((item) => item.name === table.name)
          const rows = source ? source.rows : []
          for (let index = 0; index < rows.length; index += COPY_CHUNK_SIZE) {
            const chunk = rows.slice(index, index + COPY_CHUNK_SIZE)
            await table.bulkPut(chunk)
            completedRows += chunk.length
            callback({ totalRows, completedRows, done: false })
          }
        }
      })

      succeeded = true
    } catch (error) {
      console.error('数据导入失败：', error)
      const reason = String((error as Error)?.message || error)
      // v9.12（M2-007）：失败也要"结束"（复位按钮），但不能把进度条显示成 100%（failed 由 UI 消费）
      callback({ totalRows: 0, completedRows: 0, done: true, failed: true })
      if (error instanceof ImportFileError || !mainWriteStarted) {
        // 解压失败 / 不是有效备份 / 临时库导入失败：主库一个字节都没动
        window.alert(`导入失败：${reason}\n\n当前数据未做任何改动。`)
      } else {
        // 写入阶段失败：主库事务已整体回滚
        window.alert(`导入失败：${reason}\n\n导入已整体回滚，当前数据未被修改。`)
      }
    } finally {
      if (tempDb) {
        try {
          tempDb.close()
        } catch {
          /* ignore */
        }
      }
      if (tempDbName) {
        try {
          await Dexie.delete(tempDbName)
        } catch (e) {
          console.warn('删除临时导入库失败（下次导入时会重试清理）：', tempDbName, e)
        }
      }
    }

    if (!succeeded) return

    // ---------- 5) 导入成功后的收尾（失败只记录，不再回滚成功数据） ----------
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
      // v9.12（M2-011）：键名一律用常量，避免改键名后这里的清理静默失效（沿用旧机器的 skip/级别状态）
      localStorage.removeItem(AUTO_LEVEL_STORAGE_KEY)
      localStorage.removeItem(REVALUATE_LEVEL_STORAGE_KEY)
      localStorage.removeItem(DUE_REVIEW_WORDS_STORAGE_KEY)
      localStorage.removeItem(REVIEW_MODE_INFO_STORAGE_KEY)
      // v9.5（DATA-003）：导入的是旧机器数据，memoryKey 大小写迁移可能尚未在本机跑过；
      // 清掉标记让 reload 后重新执行迁移（只复制不删旧记录，幂等）。
      localStorage.removeItem(MEMORY_KEY_CASE_MIGRATED_KEY)
    } catch {
      /* ignore */
    }

    try {
      const [wordCount, chapterCount] = await Promise.all([db.wordRecords.count(), db.chapterRecords.count()])
      const totalRows = wordCount + chapterCount
      recordDataAction({ type: 'import', size: file.size, wordCount, chapterCount })
      callback({ totalRows, completedRows: totalRows, done: true })
    } catch (error) {
      console.error('导入后统计上报失败：', error)
    }

    // 成功：缓存已清空，重载保证统计/出词与导入后的数据库完全一致
    // （不弹确认框，避免阻塞/影响自动化；DataSetting 的进度条已到 100%）
    window.location.reload()
  })

  input.click()
}
