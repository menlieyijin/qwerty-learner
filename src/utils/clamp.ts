export default function clamp(number: number, lower: number, upper: number): number {
  number = +number
  lower = +lower
  upper = +upper
  lower = lower === lower ? lower : 0
  upper = upper === upper ? upper : 0
  // M6-011：NaN 入参原先会原样透传（例如 RemarkRing 把 clamp(percentage, 0, 100) 的 NaN
  // 直接写进 SVG 属性），显式归到下界 min。非 NaN 入参的钳制结果与原先逐分支一致。
  if (number !== number) {
    return lower
  }
  number = number <= upper ? number : upper
  number = number >= lower ? number : lower
  return number
}
