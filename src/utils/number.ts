/**
 * 数值与数组小工具（v10.6，dsh：从 `utils/index.ts` 抽出）。
 *
 * 只放无业务含义的通用实现；带业务规则的（章节长度、记忆阶梯）不放这里。
 */

/** 四舍五入到指定小数位，并去掉多余的 0（返回 number） */
export function toFixedNumber(number: number, fractionDigits: number) {
  return Number((number ?? 0).toFixed(fractionDigits))
}

/** 两个数组的交集（保持 `xs` 的顺序，去重由调用方决定） */
export function findCommonValues<T>(xs: T[], ys: T[]): T[] {
  const set = new Set(ys)
  return xs.filter((x) => set.has(x))
}
