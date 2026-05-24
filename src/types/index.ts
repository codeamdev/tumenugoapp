export type UserRole = 'admin' | 'cajero' | 'mesero' | 'cocina'

export interface AuthUser {
  id: string
  name: string | null
  email: string
  role: UserRole
}

export interface AuthTenant {
  id: string
  name: string
  slug: string
  primaryColor: string
  currencySign: string
  logoUrl: string | null
}

export interface TenantConfig {
  paymentMethods: { key: string; label: string }[]
  deliveryFields?: {
    phone: boolean
    address: boolean
    notes: boolean
    fee: boolean
  }
  defaultOpeningAmount?: number
  defaultDeliveryFee?: number
}

// Backend uses 'table' | 'bar' | 'delivery'
export type OrderType = 'table' | 'bar' | 'delivery'
export type OrderStatus = 'new' | 'sent' | 'preparing' | 'ready' | 'delivered' | 'closed' | 'cancelled'
export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'nequi' | 'daviplata' | 'other'

export interface OrderItem {
  id: string
  productId: string | null
  productSnapshot: { name: string; price: string } | null
  modifierSnapshot: Array<{ groupName: string; modifierName: string; priceDelta: number | string }> | null
  quantity: number
  unitPrice: string
  itemTotal: string
  notes: string | null
  status: string
}

export interface Order {
  id: string
  localId: string | null
  displayCode: string | null
  type: OrderType
  status: OrderStatus
  tableId: string | null
  tableName: string | null
  customerName: string | null
  customerPhone: string | null
  customerAddress: string | null
  customerNotes: string | null
  subtotal: string
  taxAmount: string
  tipAmount: string
  deliveryFee: string
  discountAmount: string
  total: string
  paymentStatus: string
  paymentMethod: PaymentMethod | null
  paymentNotes: string | null
  notes: string | null
  servedBy: string | null
  closedBy: string | null
  cancelReason: string | null
  createdAt: string | null
  updatedAt: string | null
  closedAt: string | null
  itemsCount?: number
  items?: OrderItem[]
}

export interface ModifierOption {
  id: string
  name: string
  priceDelta: string
  isDefault: boolean
  sortOrder: number
}

export interface ModifierGroup {
  id: string
  name: string
  selectionType: 'single' | 'multiple'
  isRequired: boolean
  minSelections: number
  maxSelections: number | null
  modifiers: ModifierOption[]
}

export interface Product {
  id: string
  name: string
  description: string | null
  price: string
  categoryId: string
  imageUrl: string | null
  isAvailable: boolean
  taxRateId: string | null
  prepTimeMin: number | null
  sortOrder: number
  modifierGroups: ModifierGroup[]
}

export interface Category {
  id: string
  name: string
  emoji: string | null
  color: string
  sortOrder: number
  isActive: boolean
}

export interface Table {
  id: string
  name: string
  capacity: number
  zone: string
  status: 'available' | 'occupied' | 'reserved' | 'cleaning'
  isActive: boolean
}

export interface CashRegister {
  id: string
  openedAt: string | null
  closedAt: string | null
  openingAmount: string
  expectedCash: string | null
  countedCash: string | null
  difference: string | null
  notes: string | null
  status: string
}

export interface CajaSummary {
  totalOrders: number
  totalSales: number
  totalTips: number
  byPaymentMethod: Record<string, number>
  expectedCash: number
}

export interface CartModifier {
  groupId: string
  groupName: string
  modifierId: string
  modifierName: string
  priceDelta: number
}

export interface CartItem {
  localId: string
  productId: string | null
  name: string
  unitPrice: number
  quantity: number
  modifiers: CartModifier[]
  notes: string
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Nuevo',
  sent: 'En cocina',
  preparing: 'Preparando',
  ready: 'Listo',
  delivered: 'Entregado',
  closed: 'Cerrado',
  cancelled: 'Cancelado',
}

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  new: '#64748b',
  sent: '#3b82f6',
  preparing: '#f59e0b',
  ready: '#10b981',
  delivered: '#14b8a6',
  closed: '#6b7280',
  cancelled: '#ef4444',
}

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  table: 'Mesa',
  bar: 'Barra',
  delivery: 'Domicilio',
}
