export function fmtUsd(n: number) {
  if (n === 0) return '$0'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs < 0.000001) return `${sign}$${abs.toFixed(10)}`
  if (abs < 0.001) return `${sign}$${abs.toFixed(6)}`
  return `${sign}$${abs.toFixed(4)}`
}

export function fmtCtx(n: number | null | undefined) {
  if (!n) return '—'
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`
}

export function fmtRate(n: number) {
  if (n === 0) return 'Free'
  if (n < 0.001) return `$${n.toFixed(6)}/M`
  return `$${n.toFixed(4)}/M`
}

