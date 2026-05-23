export function formatCurrency(amount: number, sign = '$'): string {
  return `${sign}${Math.round(amount).toLocaleString('es-CO')}`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export function elapsedMinutes(iso: string | null | undefined): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
}
