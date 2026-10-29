/**
 * v9.3 仿真专用 Dexie stub（内存表）。
 * 只实现 updateMemoryProgress / 迁移 / 删除路径实际用到的 API，行为对齐 Dexie 的异步语义：
 *   version().stores() / 表对象 get/put/delete/count/toArray/bulkPut/add/update/mapToClass/where
 * 主键推导：'++id' → 自增整数主键；'key,word,...' → 以 key 字段为主键。
 * 注意：本文件只服务 scripts/core-regression 下的仿真，不改 src/。
 */

class Table {
  constructor(name, def) {
    this.name = name
    this.map = new Map()
    this.idSeq = 0
    this.configure(def)
  }

  configure(def) {
    const primary = String(def || '').split(',')[0].trim()
    this.auto = primary.startsWith('++')
    this.keyField = this.auto ? null : primary
  }

  keyOf(value) {
    if (this.auto) return value && value.id !== undefined ? value.id : undefined
    return value[this.keyField]
  }

  mapToClass() {
    return this
  }

  async get(key) {
    return this.map.get(key)
  }

  async put(value) {
    let key = this.keyOf(value)
    if (this.auto && key === undefined) {
      key = ++this.idSeq
      value.id = key
    }
    this.map.set(key, value)
    return key
  }

  async add(value) {
    let key = this.keyOf(value)
    if (this.auto && key === undefined) key = ++this.idSeq
    if (!this.auto && key === undefined) throw new Error('missing key')
    this.map.set(key, value)
    return key
  }

  async update(key, patch) {
    const cur = this.map.get(key)
    if (!cur) return 0
    this.map.set(key, { ...cur, ...patch })
    return 1
  }

  async delete(key) {
    this.map.delete(key)
    return 1
  }

  async count() {
    return this.map.size
  }

  async toArray() {
    return Array.from(this.map.values())
  }

  async bulkPut(values) {
    for (const v of values) await this.put(v)
  }

  async clear() {
    this.map.clear()
    this.idSeq = 0
  }

  where() {
    const self = this
    const api = {
      delete: async () => {
        const n = self.map.size
        self.map.clear()
        return n
      },
      toArray: async () => [],
      aboveOrEqual: () => api,
      equal: () => api,
      first: async () => undefined,
    }
    return api
  }
}

export default class Dexie {
  constructor(name) {
    this.name = name
    this.tableMap = {}
  }

  version() {
    return this
  }

  stores(schema) {
    for (const [name, def] of Object.entries(schema)) {
      if (this[name]) {
        this[name].configure(def)
      } else {
        const table = new Table(name, def)
        this.tableMap[name] = table
        this[name] = table
      }
    }
    return this
  }
}
