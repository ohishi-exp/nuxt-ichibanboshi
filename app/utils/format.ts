export function formatMan(val: number): string {
  return Math.round(val / 10000).toLocaleString('ja-JP')
}

export type YoyDisplayMode = 'ratio' | 'diff'

export function formatYoyPct(val: number, mode: YoyDisplayMode): string {
  if (mode === 'ratio') return `${(100 + val).toFixed(1)}%`
  const sign = val > 0 ? '+' : ''
  return `${sign}${val.toFixed(1)}%`
}
