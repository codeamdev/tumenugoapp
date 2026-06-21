/**
 * Pure order calculation logic — identical to web version.
 * No dependencies, works in any JS runtime.
 */

export interface CalcModifier {
  groupName: string
  modifierName: string
  priceDelta: number
}

export interface CalcItem {
  id: string
  productId: string | null
  productName: string
  unitPrice: number
  quantity: number
  modifiers: CalcModifier[]
  notes: string
}

export interface TaxLine {
  taxRateId: string
  name: string
  rate: number
  base: number
  amount: number
}

export interface OrderTotals {
  subtotal: number
  discount: number
  taxLines: TaxLine[]
  taxTotal: number
  tip: number
  deliveryFee: number
  total: number
}

export interface ProductForCalc {
  id: string
  taxRateId?: string | null
  taxName?: string | null
  taxRate?: number | null
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function calcItemTotal(item: CalcItem): number {
  const modifiersTotal = item.modifiers.reduce((s, m) => s + m.priceDelta, 0)
  return round2((item.unitPrice + modifiersTotal) * item.quantity)
}

export function calcOrderTotals(
  items: CalcItem[],
  products: ProductForCalc[],
  options: {
    couponDiscount?: number
    tipPercent?: number
    deliveryFee?: number
  } = {}
): OrderTotals {
  const { couponDiscount = 0, tipPercent = 0, deliveryFee = 0 } = options
  const taxMap = new Map<string, TaxLine>()
  let subtotal = 0

  for (const item of items) {
    const itemTotal = calcItemTotal(item)
    subtotal = round2(subtotal + itemTotal)
    const product = products.find((p) => p.id === item.productId)
    if (product?.taxRateId && product.taxRate && product.taxRate > 0) {
      const existing = taxMap.get(product.taxRateId)
      if (existing) {
        existing.base = round2(existing.base + itemTotal)
      } else {
        taxMap.set(product.taxRateId, {
          taxRateId: product.taxRateId,
          name: product.taxName ?? 'Impuesto',
          rate: product.taxRate,
          base: itemTotal,
          amount: 0,
        })
      }
    }
  }

  const taxLines = Array.from(taxMap.values()).map((line) => ({
    ...line,
    amount: round2(line.base * (line.rate / 100)),
  }))
  const taxTotal = round2(taxLines.reduce((s, l) => s + l.amount, 0))
  const discount = round2(couponDiscount)
  const tip = round2(subtotal * (tipPercent / 100))
  const total = round2(
    subtotal + taxTotal - discount + tip + deliveryFee
  )

  return { subtotal, discount, taxLines, taxTotal, tip, deliveryFee, total }
}

export function calcChange(received: number, total: number): number {
  return round2(received - total)
}
