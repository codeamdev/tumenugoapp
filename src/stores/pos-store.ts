import { create } from 'zustand'
import type { CartItem, CartModifier, OrderType } from '@/types'

let counter = 0
const uid = () => `item_${Date.now()}_${++counter}`

interface PosState {
  items: CartItem[]
  orderType: OrderType
  tableId: string | null
  tableName: string | null
  customerName: string
  customerPhone: string
  customerAddress: string
  deliveryFee: string
  notes: string

  addItem: (item: Omit<CartItem, 'localId'>) => void
  removeItem: (localId: string) => void
  updateQty: (localId: string, qty: number) => void
  clearCart: () => void
  setOrderType: (t: OrderType) => void
  setTable: (id: string | null, name: string | null) => void
  setCustomerName: (n: string) => void
  setCustomerPhone: (n: string) => void
  setCustomerAddress: (n: string) => void
  setDeliveryFee: (n: string) => void
  setNotes: (n: string) => void

  itemCount: number
  getSubtotal: () => number
}

export const usePosStore = create<PosState>((set, get) => ({
  items: [],
  orderType: 'table',
  tableId: null,
  tableName: null,
  customerName: '',
  customerPhone: '',
  customerAddress: '',
  deliveryFee: '',
  notes: '',
  itemCount: 0,

  addItem: (item) =>
    set((s) => {
      const items = [...s.items, { ...item, localId: uid() }]
      return { items, itemCount: items.reduce((a, i) => a + i.quantity, 0) }
    }),

  removeItem: (localId) =>
    set((s) => {
      const items = s.items.filter((i) => i.localId !== localId)
      return { items, itemCount: items.reduce((a, i) => a + i.quantity, 0) }
    }),

  updateQty: (localId, qty) => {
    if (qty <= 0) { get().removeItem(localId); return }
    set((s) => {
      const items = s.items.map((i) => i.localId === localId ? { ...i, quantity: qty } : i)
      return { items, itemCount: items.reduce((a, i) => a + i.quantity, 0) }
    })
  },

  clearCart: () => set({
    items: [], itemCount: 0,
    tableId: null, tableName: null,
    customerName: '', customerPhone: '', customerAddress: '',
    deliveryFee: '', notes: '',
  }),
  setOrderType: (orderType) => set({ orderType }),
  setTable: (tableId, tableName) => set({ tableId, tableName }),
  setCustomerName: (customerName) => set({ customerName }),
  setCustomerPhone: (customerPhone) => set({ customerPhone }),
  setCustomerAddress: (customerAddress) => set({ customerAddress }),
  setDeliveryFee: (deliveryFee) => set({ deliveryFee }),
  setNotes: (notes) => set({ notes }),

  getSubtotal: () => {
    const { items } = get()
    return items.reduce((sum, i) => {
      const mods = i.modifiers.reduce((ms, m) => ms + m.priceDelta, 0)
      return sum + (i.unitPrice + mods) * i.quantity
    }, 0)
  },
}))
