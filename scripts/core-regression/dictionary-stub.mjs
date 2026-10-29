/**
 * Node 冒烟专用 stub：替换 `@/resources/dictionary`（真实模块含 Vite `import.meta.glob`/资源导入，无法在 Node 直接跑）。
 * learningPath.ts 只用到 `dictionaryResources`（文件 -> 词库 id 映射）；给空数组即可，dictId 退化为文件名。
 */
export const dictionaryResources = []
export const idDictionaryMap = {}
