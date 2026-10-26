import Dexie from 'dexie'

/**
 * v9.9（Batch6 / DATA-001 验收缺陷修复）：导入临时库的命名与清理。
 *
 * 背景：`src/utils/db/data-export.ts` 的导入流程先导入一个临时 Dexie 库
 * （`RecordDB-import-<ts>-<rand>`），成功后在 `finally` 里删除。如果进程在「临时库写了一半」时被强杀
 * （关窗 / 崩溃 / 断电），临时库会残留在 IndexedDB 里；v9.8 之前只有「下一次导入开始时」才清理，
 * 表现为永久存储泄漏（实测：9 轮强杀有 6 轮残留，重启后仍在）。
 *
 * v9.9：把清理逻辑独立到本模块（只依赖 dexie，避免 data-export ↔ db 循环依赖），
 * 并在 `src/utils/db/index.ts` 的启动链（db 就绪后）调用一次 `cleanupStaleTempImportDbs()`，
 * 使强杀后**重启即清理**；导入开始前的清理仍保留（双保险）。
 */

/** 临时导入库名前缀（数据库名 = 前缀 + `<Date.now()>-<random>`） */
export const TEMP_IMPORT_DB_PREFIX = 'RecordDB-import-'

/** 生成一个新的唯一临时库名 */
export function createTempImportDbName(): string {
  return `${TEMP_IMPORT_DB_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 运行时环境是否支持枚举 IndexedDB 数据库（Node/仿真环境没有 indexedDB） */
function canEnumerateDatabases(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function'
  } catch {
    return false
  }
}

/**
 * 清理残留的 `RecordDB-import-*` 临时导入库（幂等、尽力而为、绝不抛错）。
 *
 * @returns 被删除的数据库名列表（无残留时为空数组）
 */
export async function cleanupStaleTempImportDbs(): Promise<string[]> {
  if (!canEnumerateDatabases()) return []
  let staleNames: string[] = []
  try {
    const list = await indexedDB.databases()
    staleNames = (Array.isArray(list) ? list : [])
      .map((info) => (info && typeof info.name === 'string' ? info.name : ''))
      .filter((name) => name.startsWith(TEMP_IMPORT_DB_PREFIX))
  } catch (e) {
    console.warn('枚举 IndexedDB 数据库失败，跳过临时导入库清理：', e)
    return []
  }
  const deleted: string[] = []
  await Promise.all(
    staleNames.map(async (name) => {
      try {
        // Dexie.delete：关闭同名连接并删除数据库（不存在时也安全 resolve）
        await Dexie.delete(name)
        deleted.push(name)
      } catch (e) {
        console.warn('清理残留临时导入库失败（下次启动会重试）：', name, e)
      }
    }),
  )
  if (deleted.length > 0) console.warn('[QZ] 已清理残留临时导入库：', deleted.join(', '))
  return deleted
}
