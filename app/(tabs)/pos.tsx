import { useState, useMemo, useCallback, useRef } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, Modal, ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '@/lib/api'
import { usePosStore } from '@/stores/pos-store'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { enqueueSync, saveOfflineOrder } from '@/lib/offline/sync-queue'
import { useNetworkStatus } from '@/hooks/use-network'
import { ErrorView } from '@/components/ErrorView'
import { useAppColors } from '@/lib/theme'
import type { Product, Category, Table, ModifierGroup, CartModifier } from '@/types'

// ─── Hooks de datos ───────────────────────────────────────────────────────────

function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: () => api.get<{ data: Product[] }>('/api/tenant/products').then((r) => r.data),
    staleTime: 5 * 60_000,
    gcTime: 24 * 60 * 60_000,
  })
}

function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ data: Category[] }>('/api/tenant/categories').then((r) => r.data),
    staleTime: 10 * 60_000,
    gcTime: 24 * 60 * 60_000,
  })
}

function useTables() {
  return useQuery({
    queryKey: ['tables'],
    queryFn: () => api.get<{ data: Table[] }>('/api/tenant/tables').then((r) => r.data),
    staleTime: 60_000,
    gcTime: 24 * 60 * 60_000,
  })
}

// ─── Modal: Modificadores ─────────────────────────────────────────────────────

function ModifiersModal({ product, onAdd, onClose }: {
  product: Product
  onAdd: (item: { modifiers: CartModifier[]; quantity: number; notes: string }) => void
  onClose: () => void
}) {
  const c = useAppColors()
  const s = makeModStyles(c)
  const { tenant } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const sign    = tenant?.currencySign ?? '$'

  const groups = product.modifierGroups ?? []

  // Pre-select default modifiers on mount
  const defaultSelected = useMemo<Record<string, CartModifier[]>>(() => {
    const init: Record<string, CartModifier[]> = {}
    for (const group of groups) {
      const defaults = group.modifiers.filter((m) => m.isDefault)
      if (defaults.length > 0) {
        init[group.id] = defaults.map((m) => ({
          groupId: group.id,
          groupName: group.name,
          modifierId: m.id,
          modifierName: m.name,
          priceDelta: parseFloat(m.priceDelta as any) || 0,
        }))
      }
    }
    return init
  }, [product.id])

  const [qty, setQty]     = useState(1)
  const [notes, setNotes] = useState('')
  const [selected, setSelected] = useState<Record<string, CartModifier[]>>(defaultSelected)

  function toggle(group: ModifierGroup, modId: string, modName: string, delta: number) {
    setSelected((prev) => {
      const current = prev[group.id] ?? []
      const exists  = current.find((m) => m.modifierId === modId)

      if (group.selectionType === 'single') {
        return exists
          ? { ...prev, [group.id]: [] }
          : { ...prev, [group.id]: [{ groupId: group.id, groupName: group.name, modifierId: modId, modifierName: modName, priceDelta: delta }] }
      }
      // multiple
      return exists
        ? { ...prev, [group.id]: current.filter((m) => m.modifierId !== modId) }
        : { ...prev, [group.id]: [...current, { groupId: group.id, groupName: group.name, modifierId: modId, modifierName: modName, priceDelta: delta }] }
    })
  }

  function canAdd() {
    return groups.every((g) => !g.isRequired || (selected[g.id]?.length ?? 0) >= (g.minSelections || 1))
  }

  const allMods   = Object.values(selected).flat()
  const modsDelta = allMods.reduce((sum, m) => sum + m.priceDelta, 0)
  const unitPrice = parseFloat(product.price) + modsDelta
  const total     = unitPrice * qty

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.modRoot}>
        <View style={s.modHeader}>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={c.textSecondary} />
          </TouchableOpacity>
          <Text style={s.modTitle} numberOfLines={1}>{product.name}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={s.modBody}>
          {/* Cantidad */}
          <View style={s.qtyRow}>
            <Text style={s.groupName}>Cantidad</Text>
            <View style={s.qtyControls}>
              <TouchableOpacity style={[s.qtyBtn, { borderColor: PRIMARY }]} onPress={() => setQty(Math.max(1, qty - 1))}>
                <Ionicons name="remove" size={16} color={PRIMARY} />
              </TouchableOpacity>
              <Text style={s.qtyNum}>{qty}</Text>
              <TouchableOpacity style={[s.qtyBtn, { borderColor: PRIMARY }]} onPress={() => setQty(qty + 1)}>
                <Ionicons name="add" size={16} color={PRIMARY} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Grupos de modificadores */}
          {groups.map((group) => {
            const groupSelected = selected[group.id] ?? []
            return (
              <View key={group.id} style={s.group}>
                <View style={s.groupHeader}>
                  <Text style={s.groupName}>{group.name}</Text>
                  <View style={s.groupMeta}>
                    {group.isRequired && <View style={s.requiredBadge}><Text style={s.requiredText}>Requerido</Text></View>}
                    <Text style={s.groupHint}>
                      {group.selectionType === 'single' ? 'Elige 1' : `Elige hasta ${group.maxSelections ?? '∞'}`}
                    </Text>
                  </View>
                </View>
                <View style={s.modsGrid}>
                  {group.modifiers.map((mod) => {
                    const isSelected = groupSelected.some((sel) => sel.modifierId === mod.id)
                    const delta = parseFloat(mod.priceDelta as any) || 0
                    return (
                      <TouchableOpacity
                        key={mod.id}
                        style={[s.modChip, isSelected && { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
                        onPress={() => toggle(group, mod.id, mod.name, delta)}
                      >
                        <Text style={[s.modChipText, isSelected && { color: c.textInverse }]}>{mod.name}</Text>
                        {delta !== 0 && (
                          <Text style={[s.modDelta, isSelected && { color: c.textInverse }]}>
                            {delta > 0 ? '+' : ''}{formatCurrency(delta, sign)}
                          </Text>
                        )}
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </View>
            )
          })}

          {/* Notas */}
          <View style={s.group}>
            <Text style={s.groupName}>Notas (opcional)</Text>
            <TextInput
              style={s.modNotesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="Ej: sin cebolla, extra picante..."
              placeholderTextColor={c.textMuted}
              multiline
            />
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={s.modFooter}>
          <TouchableOpacity
            style={[s.addBtn, { backgroundColor: PRIMARY }, !canAdd() && s.btnDisabled]}
            disabled={!canAdd()}
            onPress={() => { onAdd({ modifiers: allMods, quantity: qty, notes }); onClose() }}
          >
            <Text style={s.addBtnText}>
              Agregar · {formatCurrency(total, sign)}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

function makeModStyles(c: ReturnType<typeof useAppColors>) {
  return StyleSheet.create({
    modRoot: { flex: 1, backgroundColor: c.surface },
    modHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingVertical: 16,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    modTitle:  { fontSize: 16, fontWeight: '700', color: c.text, flex: 1, textAlign: 'center' },
    modBody:   { padding: 20, gap: 20 },
    modFooter: { padding: 20, borderTopWidth: 1, borderTopColor: c.border },
    addBtn:    { borderRadius: 12, padding: 16, alignItems: 'center' },
    addBtnText:{ color: '#fff', fontWeight: '700', fontSize: 16 },
    btnDisabled: { opacity: 0.5 },

    qtyRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
    qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    qtyBtn: {
      width: 32, height: 32, borderRadius: 16,
      borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
    },
    qtyNum: { fontSize: 16, fontWeight: '700', color: c.text, minWidth: 24, textAlign: 'center' },

    group:       { gap: 10 },
    groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    groupName:   { fontSize: 15, fontWeight: '700', color: c.text },
    groupMeta:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
    groupHint:   { fontSize: 12, color: c.textMuted },
    requiredBadge: { backgroundColor: '#fef3c7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
    requiredText:  { fontSize: 10, fontWeight: '700', color: '#d97706' },
    modsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    modChip: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
      borderWidth: 1.5, borderColor: c.border, backgroundColor: c.surfaceAlt,
    },
    modChipText: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    modDelta:    { fontSize: 12, color: c.textMuted },
    modNotesInput: {
      borderWidth: 1, borderColor: c.border, borderRadius: 10,
      padding: 12, fontSize: 14, color: c.text, backgroundColor: c.surfaceAlt, minHeight: 70, textAlignVertical: 'top',
    },
  })
}

// ─── Tarjeta de producto ──────────────────────────────────────────────────────

// ─── Fila de producto (vista de categoría) ────────────────────────────────────

function ProductRow({ product, onPress, PRIMARY, sign, c }: {
  product: Product
  onPress: () => void
  PRIMARY: string
  sign: string
  c: ReturnType<typeof useAppColors>
}) {
  const hasModifiers = (product.modifierGroups?.length ?? 0) > 0
  return (
    <TouchableOpacity
      style={[rStyles.row, { borderBottomColor: c.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={{ flex: 1 }}>
        <Text style={[rStyles.name, { color: c.text }]} numberOfLines={1}>{product.name}</Text>
        {hasModifiers && <Text style={[rStyles.sub, { color: c.textMuted }]}>Personalizable</Text>}
      </View>
      <Text style={[rStyles.price, { color: PRIMARY }]}>{formatCurrency(parseFloat(product.price), sign)}</Text>
      <View style={[rStyles.addBtn, { backgroundColor: PRIMARY + '18' }]}>
        <Ionicons name="add" size={20} color={PRIMARY} />
      </View>
    </TouchableOpacity>
  )
}

const rStyles = StyleSheet.create({
  row:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, gap: 12 },
  name:   { fontSize: 15, fontWeight: '600' },
  sub:    { fontSize: 12, marginTop: 2 },
  price:  { fontSize: 14, fontWeight: '700', minWidth: 64, textAlign: 'right' },
  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
})

// ─── Tarjeta de categoría ─────────────────────────────────────────────────────

function CategoryCard({ cat, onPress, c }: {
  cat: Category
  onPress: () => void
  c: ReturnType<typeof useAppColors>
}) {
  return (
    <TouchableOpacity
      style={[catStyles.card, { backgroundColor: c.surface, shadowColor: c.shadow }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <Text style={catStyles.emoji}>{cat.emoji ?? '📦'}</Text>
      <Text style={[catStyles.name, { color: c.text }]} numberOfLines={2}>{cat.name}</Text>
    </TouchableOpacity>
  )
}

const catStyles = StyleSheet.create({
  card:  { flex: 1, margin: 5, borderRadius: 14, padding: 16, alignItems: 'center', gap: 8, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  emoji: { fontSize: 32 },
  name:  { fontSize: 13, fontWeight: '600', textAlign: 'center' },
})

// ─── Sheet de cantidad ────────────────────────────────────────────────────────

function QuantitySheet({ product, onAdd, onClose, PRIMARY, sign, c }: {
  product: Product
  onAdd: (qty: number) => void
  onClose: () => void
  PRIMARY: string
  sign: string
  c: ReturnType<typeof useAppColors>
}) {
  const [qty, setQty] = useState(1)
  const price = parseFloat(product.price)
  return (
    <View style={[qStyles.backdrop]} pointerEvents="box-none">
      <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />
      <View style={[qStyles.sheet, { backgroundColor: c.surface }]}>
        <View style={qStyles.handle} />
        <Text style={[qStyles.name, { color: c.text }]} numberOfLines={2}>{product.name}</Text>
        <Text style={[qStyles.unitPrice, { color: c.textMuted }]}>{formatCurrency(price, sign)} c/u</Text>
        <View style={qStyles.qtyRow}>
          <TouchableOpacity
            style={[qStyles.qtyBtn, { borderColor: c.border }]}
            onPress={() => setQty((q) => Math.max(1, q - 1))}
          >
            <Ionicons name="remove" size={22} color={c.text} />
          </TouchableOpacity>
          <Text style={[qStyles.qtyNum, { color: c.text }]}>{qty}</Text>
          <TouchableOpacity
            style={[qStyles.qtyBtn, { borderColor: c.border }]}
            onPress={() => setQty((q) => q + 1)}
          >
            <Ionicons name="add" size={22} color={c.text} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[qStyles.addBtn, { backgroundColor: PRIMARY }]}
          onPress={() => onAdd(qty)}
          activeOpacity={0.85}
        >
          <Text style={qStyles.addBtnText}>
            Agregar {qty > 1 ? `${qty} · ` : ''}{formatCurrency(price * qty, sign)}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const qStyles = StyleSheet.create({
  backdrop: { position: 'absolute', bottom: 0, left: 0, right: 0, top: 0, justifyContent: 'flex-end' },
  sheet:    { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32, gap: 12, shadowOpacity: 0.15, shadowRadius: 20, elevation: 16 },
  handle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: '#d1d5db', alignSelf: 'center', marginBottom: 4 },
  name:     { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  unitPrice:{ fontSize: 13, textAlign: 'center' },
  qtyRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginVertical: 4 },
  qtyBtn:   { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  qtyNum:   { fontSize: 28, fontWeight: '800', minWidth: 40, textAlign: 'center' },
  addBtn:   { borderRadius: 14, padding: 16, alignItems: 'center' },
  addBtnText:{ color: '#fff', fontWeight: '700', fontSize: 16 },
})

// ─── Modal: Producto libre ────────────────────────────────────────────────────

function FreeProductModal({ visible, onAdd, onClose }: {
  visible: boolean
  onAdd: (name: string, price: number) => void
  onClose: () => void
}) {
  const c = useAppColors()
  const s = makeFreeModalStyles(c)
  const { tenant } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const [name, setName]   = useState('')
  const [price, setPrice] = useState('')

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={s.freeOverlay}>
        <View style={s.freeCard}>
          <Text style={s.freeTitle}>Producto libre</Text>
          <TextInput
            style={s.cartInput}
            placeholder="Nombre"
            placeholderTextColor={c.textMuted}
            value={name}
            onChangeText={setName}
          />
          <TextInput
            style={s.cartInput}
            placeholder="Precio"
            placeholderTextColor={c.textMuted}
            value={price}
            onChangeText={setPrice}
            keyboardType="numeric"
          />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <TouchableOpacity style={[s.freeBtn, { borderColor: c.border }]} onPress={onClose}>
              <Text style={{ color: c.textSecondary, fontWeight: '600' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.freeBtn, { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
              onPress={() => {
                if (!name || !price) return
                onAdd(name, parseFloat(price) || 0)
                setName(''); setPrice(''); onClose()
              }}
            >
              <Text style={{ color: c.textInverse, fontWeight: '600' }}>Agregar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

function makeFreeModalStyles(c: ReturnType<typeof useAppColors>) {
  return StyleSheet.create({
    freeOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
    freeCard:    { backgroundColor: c.surface, borderRadius: 16, padding: 20, gap: 12 },
    freeTitle:   { fontSize: 17, fontWeight: '700', color: c.text },
    freeBtn:     { flex: 1, borderWidth: 1, borderRadius: 10, padding: 12, alignItems: 'center' },
    cartInput: {
      borderWidth: 1, borderColor: c.border, borderRadius: 8,
      padding: 10, fontSize: 14, color: c.text, backgroundColor: c.surfaceAlt,
    },
  })
}

// ─── Modal carrito ────────────────────────────────────────────────────────────

function CartModal({ visible, onClose, tables }: {
  visible: boolean
  onClose: () => void
  tables: Table[]
}) {
  const c = useAppColors()
  const s = makeCartStyles(c)
  const qc = useQueryClient()
  const router = useRouter()
  const { bottom: bottomInset } = useSafeAreaInsets()
  const { tenant, config } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const sign    = tenant?.currencySign ?? '$'
  const dfFields = config?.deliveryFields

  const {
    items, orderType, tableId, tableName,
    customerName, customerPhone, customerAddress, deliveryFee, notes,
    updateQty, removeItem, clearCart,
    setOrderType, setTable, setCustomerName, setCustomerPhone, setCustomerAddress, setDeliveryFee, setNotes,
    getSubtotal,
  } = usePosStore()

  const { isConnected } = useNetworkStatus()
  const [submitting, setSubmitting] = useState(false)
  const subtotal      = getSubtotal()
  const deliveryFeeNum = parseFloat(deliveryFee) || 0
  const isDelivery    = orderType === 'delivery'
  const total         = subtotal + (isDelivery ? deliveryFeeNum : 0)

  async function handleCreate() {
    if (items.length === 0) return
    const needsAddress = dfFields?.address ?? true
    if (isDelivery && needsAddress && !customerAddress.trim()) {
      Alert.alert('Dirección requerida', 'Ingresa la dirección del domicilio.')
      return
    }
    setSubmitting(true)

    const localId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0
      return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })

    const orderPayload = {
      localId,
      type: orderType,
      tableId: orderType === 'table' && tableId ? tableId : undefined,
      customerName: customerName || undefined,
      customerPhone: isDelivery && (dfFields?.phone ?? true) && customerPhone ? customerPhone : undefined,
      customerAddress: isDelivery && (dfFields?.address ?? true) && customerAddress ? customerAddress : undefined,
      deliveryFee: isDelivery && (dfFields?.fee ?? true) ? deliveryFeeNum : 0,
      notes: notes || undefined,
      sendToKitchen: true,
      items: items.map((i) => ({
        productId: i.productId ?? undefined,
        customName: i.productId ? undefined : i.name,
        customPrice: i.productId ? undefined : i.unitPrice,
        quantity: i.quantity,
        notes: i.notes || undefined,
        modifiers: i.modifiers.map((m) => ({
          groupName: m.groupName,
          modifierName: m.modifierName,
          priceDelta: m.priceDelta,
        })),
      })),
    }

    try {
      await api.post('/api/tenant/orders', orderPayload)
      clearCart()
      onClose()
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['kitchen'] })
      router.push('/(tabs)/pedidos')
    } catch (err: any) {
      const isNetworkError = !isConnected || err?.message?.includes('Network request failed') || err?.message?.includes('fetch')
      if (isNetworkError) {
        saveOfflineOrder(localId, orderPayload)
        enqueueSync('create_order', orderPayload)
        clearCart()
        onClose()
        // Sin conexión: navega igual a pedidos; el banner offline informa al usuario
        router.push('/(tabs)/pedidos')
      } else {
        Alert.alert('Error', err.message ?? 'No se pudo crear el pedido')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const ORDER_TYPES: { key: 'table' | 'bar' | 'delivery'; label: string }[] = [
    { key: 'table', label: 'Mesa' },
    { key: 'bar',   label: 'Barra' },
    { key: 'delivery', label: 'Domicilio' },
  ]

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.cartRoot}>
        <View style={s.cartHeader}>
          <TouchableOpacity style={s.cartAddMore} onPress={onClose}>
            <Ionicons name="add-circle-outline" size={18} color={PRIMARY} />
            <Text style={[s.cartAddMoreText, { color: PRIMARY }]}>Agregar</Text>
          </TouchableOpacity>
          <Text style={s.cartTitle}>Carrito</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={c.textSecondary} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>

            {/* Tipo de pedido */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>Tipo</Text>
              <View style={s.chipRow}>
                {ORDER_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t.key}
                    style={[s.chip, orderType === t.key && { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
                    onPress={() => {
                      setOrderType(t.key)
                      if (t.key === 'delivery' && config?.defaultDeliveryFee && !deliveryFee) {
                        setDeliveryFee(String(config.defaultDeliveryFee))
                      }
                    }}
                  >
                    <Text style={[s.chipText, orderType === t.key && { color: c.textInverse }]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Mesa */}
            {orderType === 'table' && tables.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionLabel}>Mesa</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <TouchableOpacity
                    style={[s.chip, !tableId && { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
                    onPress={() => setTable(null, null)}
                  >
                    <Text style={[s.chipText, !tableId && { color: c.textInverse }]}>Sin mesa</Text>
                  </TouchableOpacity>
                  {tables.filter((t) => t.status !== 'occupied').map((t) => (
                    <TouchableOpacity
                      key={t.id}
                      style={[s.chip, { marginLeft: 8 }, tableId === t.id && { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
                      onPress={() => setTable(t.id, t.name)}
                    >
                      <Text style={[s.chipText, tableId === t.id && { color: c.textInverse }]}>{t.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Cliente */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>Cliente (opcional)</Text>
              <TextInput
                style={s.cartInput}
                value={customerName}
                onChangeText={setCustomerName}
                placeholder="Nombre del cliente"
                placeholderTextColor={c.textMuted}
              />
            </View>

            {/* Campos de domicilio */}
            {isDelivery && (
              <View style={s.section}>
                <Text style={s.sectionLabel}>Datos del domicilio</Text>
                {(dfFields?.phone ?? true) && (
                  <TextInput
                    style={[s.cartInput, { marginBottom: 8 }]}
                    value={customerPhone}
                    onChangeText={setCustomerPhone}
                    placeholder="Teléfono de contacto"
                    placeholderTextColor={c.textMuted}
                    keyboardType="phone-pad"
                  />
                )}
                {(dfFields?.address ?? true) && (
                  <TextInput
                    style={[s.cartInput, { marginBottom: 8 }]}
                    value={customerAddress}
                    onChangeText={setCustomerAddress}
                    placeholder="Dirección de entrega *"
                    placeholderTextColor={c.textMuted}
                  />
                )}
                {(dfFields?.notes ?? true) && (
                  <TextInput
                    style={[s.cartInput, { marginBottom: 8 }]}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Notas del domicilio"
                    placeholderTextColor={c.textMuted}
                    multiline
                  />
                )}
                {(dfFields?.fee ?? true) && (
                  <TextInput
                    style={s.cartInput}
                    value={deliveryFee}
                    onChangeText={setDeliveryFee}
                    placeholder={`Costo de envío (${sign})`}
                    placeholderTextColor={c.textMuted}
                    keyboardType="numeric"
                  />
                )}
              </View>
            )}

            {/* Productos */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>Productos</Text>
              {items.length === 0 && (
                <Text style={s.emptyText}>El carrito está vacío</Text>
              )}
              {items.map((item) => {
                const mods      = item.modifiers.reduce((sum, m) => sum + m.priceDelta, 0)
                const lineTotal = (item.unitPrice + mods) * item.quantity
                return (
                  <View key={item.localId} style={s.cartItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.cartItemName}>{item.name}</Text>
                      {item.modifiers.length > 0 && (
                        <Text style={s.cartItemMods}>
                          {item.modifiers.map((m) => m.modifierName).join(', ')}
                        </Text>
                      )}
                      {item.notes ? <Text style={s.cartItemNotes}>⚠ {item.notes}</Text> : null}
                      <Text style={[s.cartItemPrice, { color: PRIMARY }]}>{formatCurrency(lineTotal, sign)}</Text>
                    </View>
                    <View style={s.cartQtyRow}>
                      <TouchableOpacity style={[s.qtyBtn, { borderColor: PRIMARY }]} onPress={() => updateQty(item.localId, item.quantity - 1)}>
                        <Ionicons name="remove" size={14} color={PRIMARY} />
                      </TouchableOpacity>
                      <Text style={s.qtyNum}>{item.quantity}</Text>
                      <TouchableOpacity style={[s.qtyBtn, { borderColor: PRIMARY }]} onPress={() => updateQty(item.localId, item.quantity + 1)}>
                        <Ionicons name="add" size={14} color={PRIMARY} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => removeItem(item.localId)} style={{ marginLeft: 4 }}>
                        <Ionicons name="trash-outline" size={18} color={c.danger} />
                      </TouchableOpacity>
                    </View>
                  </View>
                )
              })}
            </View>

            {/* Notas generales */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>Notas (opcional)</Text>
              <TextInput
                style={[s.cartInput, { height: 60 }]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Instrucciones especiales..."
                placeholderTextColor={c.textMuted}
                multiline
              />
            </View>
          </ScrollView>

          {/* Footer — paddingBottom extra para la barra de navegación del sistema */}
          <View style={[s.cartFooter, { paddingBottom: Math.max(20, bottomInset + 12) }]}>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>{isDelivery ? 'Subtotal' : 'Total'}</Text>
              <Text style={isDelivery ? s.totalSubValue : s.totalValue}>{formatCurrency(subtotal, sign)}</Text>
            </View>
            {isDelivery && (
              <>
                <View style={[s.totalRow, { marginBottom: 8 }]}>
                  <Text style={s.totalLabel}>Domicilio</Text>
                  <Text style={s.totalSubValue}>{formatCurrency(deliveryFeeNum, sign)}</Text>
                </View>
                <View style={[s.totalRow, { marginBottom: 14 }]}>
                  <Text style={[s.totalLabel, { fontWeight: '700', color: c.text }]}>Total</Text>
                  <Text style={s.totalValue}>{formatCurrency(total, sign)}</Text>
                </View>
              </>
            )}
            <TouchableOpacity
              style={[s.createBtn, { backgroundColor: PRIMARY }, (submitting || items.length === 0) && s.btnDisabled]}
              onPress={handleCreate}
              disabled={submitting || items.length === 0}
            >
              {submitting
                ? <ActivityIndicator color={c.textInverse} />
                : <Text style={s.createBtnText}>Crear pedido</Text>
              }
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

function makeCartStyles(c: ReturnType<typeof useAppColors>) {
  return StyleSheet.create({
    cartRoot: { flex: 1, backgroundColor: c.surface },
    cartHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingVertical: 16,
      borderBottomWidth: 1, borderBottomColor: c.surfaceAlt,
    },
    cartTitle:       { fontSize: 18, fontWeight: '700', color: c.text },
    cartAddMore:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
    cartAddMoreText: { fontSize: 14, fontWeight: '600' },
    section:     { paddingHorizontal: 20, paddingVertical: 12 },
    sectionLabel:{ fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 10, letterSpacing: 0.5 },
    chipRow:     { flexDirection: 'row', gap: 8 },
    chip: {
      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
      borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceAlt,
    },
    chipText:    { fontSize: 13, color: c.textSecondary, fontWeight: '500' },
    cartInput: {
      borderWidth: 1, borderColor: c.border, borderRadius: 8,
      padding: 10, fontSize: 14, color: c.text, backgroundColor: c.surfaceAlt,
    },
    emptyText: { color: c.textMuted, fontSize: 14 },
    cartItem: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.background, gap: 8,
    },
    cartItemName:  { fontSize: 14, fontWeight: '600', color: c.text },
    cartItemMods:  { fontSize: 12, color: c.textMuted, marginTop: 1 },
    cartItemNotes: { fontSize: 12, color: '#f97316', marginTop: 1 },
    cartItemPrice: { fontSize: 13, fontWeight: '600', marginTop: 2 },
    cartQtyRow:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
    qtyBtn: {
      width: 32, height: 32, borderRadius: 16,
      borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
    },
    qtyNum:       { fontSize: 16, fontWeight: '700', color: c.text, minWidth: 24, textAlign: 'center' },
    cartFooter:   { padding: 20, borderTopWidth: 1, borderTopColor: c.surfaceAlt },
    totalRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
    totalLabel:   { fontSize: 15, fontWeight: '600', color: c.textSecondary },
    totalValue:   { fontSize: 22, fontWeight: '800', color: c.text },
    totalSubValue:{ fontSize: 15, fontWeight: '600', color: c.textMuted },
    createBtn:    { borderRadius: 12, padding: 16, alignItems: 'center' },
    btnDisabled:  { opacity: 0.5 },
    createBtnText:{ color: '#fff', fontWeight: '700', fontSize: 16 },
  })
}

// ─── Pantalla principal POS ───────────────────────────────────────────────────

export default function PosScreen() {
  const c = useAppColors()
  const { data: _products, isLoading: loadingProds, isError: errorProds, isRefetching: refetchingProds, refetch: refetchProds } = useProducts()
  const { data: _categories, refetch: refetchCats } = useCategories()
  const { data: _tables, refetch: refetchTables }   = useTables()

  async function handleRefresh() {
    await Promise.all([refetchProds(), refetchCats(), refetchTables()])
  }

  const products   = Array.isArray(_products)   ? _products   : []
  const categories = Array.isArray(_categories) ? _categories : []
  const tables     = Array.isArray(_tables)     ? _tables     : []
  const { addItem, itemCount, getSubtotal } = usePosStore()
  const { tenant } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const sign    = tenant?.currencySign ?? '$'

  const searchRef = useRef<TextInput>(null)

  const [categoryId,    setCategoryId]    = useState<string | null>(null)
  const [search,        setSearch]        = useState('')
  const [sheetProduct,  setSheetProduct]  = useState<Product | null>(null)
  const [cartOpen,      setCartOpen]      = useState(false)
  const [freeOpen,      setFreeOpen]      = useState(false)
  const [modProduct,    setModProduct]    = useState<Product | null>(null)

  const isSearchMode = search.length > 0

  // Solo limpia la búsqueda, sin enfocar — el foco lo da el usuario cuando quiere buscar
  function clearSearch() {
    setSearch('')
  }

  // Productos filtrados para la vista de búsqueda o la vista de categoría
  const visibleProducts = useMemo(() => {
    const available = products.filter((p) => p.isAvailable)
    if (isSearchMode) {
      return available.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    }
    if (categoryId) {
      return available.filter((p) => p.categoryId === categoryId)
    }
    return []
  }, [products, search, categoryId, isSearchMode])

  // Categorías que tienen al menos un producto disponible
  const activeCategories = useMemo(() => {
    const ids = new Set(products.filter((p) => p.isAvailable).map((p) => p.categoryId))
    return categories.filter((c) => ids.has(c.id))
  }, [products, categories])

  function handleProductTap(product: Product) {
    if ((product.modifierGroups?.length ?? 0) > 0) {
      setModProduct(product)
    } else {
      setSheetProduct(product)
    }
  }

  function handleSheetAdd(qty: number) {
    if (!sheetProduct) return
    addItem({
      productId: sheetProduct.id,
      name: sheetProduct.name,
      unitPrice: parseFloat(sheetProduct.price),
      quantity: qty,
      modifiers: [],
      notes: '',
    })
    setSheetProduct(null)
    setCategoryId(null)  // vuelve al grid de categorías
    clearSearch()
  }

  function handleModAdd(product: Product, { modifiers, quantity, notes }: { modifiers: any[]; quantity: number; notes: string }) {
    addItem({ productId: product.id, name: product.name, unitPrice: parseFloat(product.price), quantity, modifiers, notes })
    setModProduct(null)
    setCategoryId(null)  // vuelve al grid de categorías
    clearSearch()
  }

  if (loadingProds) {
    return <View style={ps.centered}><ActivityIndicator size="large" color={PRIMARY} /></View>
  }

  if (errorProds) {
    return <ErrorView message="No se pudieron cargar los productos." onRetry={refetchProds} />
  }

  const showCategories = !isSearchMode && !categoryId
  const selectedCat    = categoryId ? categories.find((c) => c.id === categoryId) : null

  return (
    <View style={ps.root}>

      {/* ── Barra superior: búsqueda + producto libre ── */}
      <View style={[ps.topBar, { borderBottomColor: c.border }]}>
        <View style={[ps.searchWrap, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
          <Ionicons name="search-outline" size={15} color={c.textMuted} />
          <TextInput
            ref={searchRef}
            style={[ps.searchInput, { color: c.text }]}
            placeholder="Buscar..."
            placeholderTextColor={c.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 ? (
            <TouchableOpacity onPress={clearSearch} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={16} color={c.textMuted} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleRefresh} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name={refetchingProds ? 'sync' : 'refresh-outline'} size={16} color={refetchingProds ? PRIMARY : c.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity style={[ps.freeBtn, { borderColor: PRIMARY }]} onPress={() => setFreeOpen(true)}>
          <Ionicons name="add" size={16} color={PRIMARY} />
          <Text style={[ps.freeBtnText, { color: PRIMARY }]}>Libre</Text>
        </TouchableOpacity>
      </View>

      {/* ── Breadcrumb al estar dentro de una categoría ── */}
      {selectedCat && !isSearchMode && (
        <TouchableOpacity
          style={[ps.breadcrumb, { borderBottomColor: c.border, backgroundColor: c.surface }]}
          onPress={() => setCategoryId(null)}
        >
          <Ionicons name="chevron-back" size={18} color={PRIMARY} />
          <Text style={[ps.breadcrumbText, { color: PRIMARY }]}>{selectedCat.emoji} {selectedCat.name}</Text>
        </TouchableOpacity>
      )}

      {/* ── Contenido principal ── */}
      {showCategories ? (
        // Vista: grid de categorías
        // key="cats" fuerza remontaje al alternar con la lista de productos
        // (cambiar numColumns en un FlatList existente causa crash en RN)
        <FlatList
          key="cats"
          data={activeCategories}
          keyExtractor={(c) => c.id}
          numColumns={3}
          contentContainerStyle={ps.catGrid}
          refreshControl={<RefreshControl refreshing={refetchingProds} onRefresh={handleRefresh} tintColor={PRIMARY} colors={[PRIMARY]} />}
          renderItem={({ item }) => (
            <CategoryCard cat={item} onPress={() => setCategoryId(item.id)} c={c} />
          )}
          ListEmptyComponent={
            <View style={ps.centered}>
              <Ionicons name="grid-outline" size={48} color={c.border} />
              <Text style={[ps.emptyText, { color: c.textMuted }]}>Sin categorías</Text>
            </View>
          }
        />
      ) : (
        // Vista: productos (en categoría o búsqueda)
        <FlatList
          key="prods"
          data={visibleProducts}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingBottom: itemCount > 0 ? 100 : 20 }}
          refreshControl={<RefreshControl refreshing={refetchingProds} onRefresh={handleRefresh} tintColor={PRIMARY} colors={[PRIMARY]} />}
          renderItem={({ item }) => (
            <ProductRow
              product={item}
              onPress={() => handleProductTap(item)}
              PRIMARY={PRIMARY}
              sign={sign}
              c={c}
            />
          )}
          ListEmptyComponent={
            <View style={ps.centered}>
              <Ionicons name="fast-food-outline" size={48} color={c.border} />
              <Text style={[ps.emptyText, { color: c.textMuted }]}>
                {isSearchMode ? 'Sin resultados' : 'Sin productos en esta categoría'}
              </Text>
            </View>
          }
        />
      )}

      {/* ── FAB carrito ── */}
      {itemCount > 0 && (
        <TouchableOpacity style={[ps.fab, { backgroundColor: PRIMARY }]} onPress={() => setCartOpen(true)}>
          <Ionicons name="cart" size={22} color="#fff" />
          <View style={[ps.fabBadge, { backgroundColor: '#fff' }]}>
            <Text style={[ps.fabBadgeText, { color: PRIMARY }]}>{itemCount}</Text>
          </View>
          <Text style={ps.fabTotal}>{formatCurrency(getSubtotal(), sign)}</Text>
        </TouchableOpacity>
      )}

      {/* ── Sheet de cantidad ── */}
      {sheetProduct && (
        <QuantitySheet
          product={sheetProduct}
          onAdd={handleSheetAdd}
          onClose={() => setSheetProduct(null)}
          PRIMARY={PRIMARY}
          sign={sign}
          c={c}
        />
      )}

      <CartModal visible={cartOpen} onClose={() => setCartOpen(false)} tables={tables} />

      <FreeProductModal
        visible={freeOpen}
        onClose={() => setFreeOpen(false)}
        onAdd={(name, price) => {
          addItem({ productId: null, name, unitPrice: price, quantity: 1, modifiers: [], notes: '' })
          clearSearch()
        }}
      />

      {modProduct && (
        <ModifiersModal
          product={modProduct}
          onAdd={(opts) => handleModAdd(modProduct, opts)}
          onClose={() => setModProduct(null)}
        />
      )}
    </View>
  )
}

const ps = StyleSheet.create({
  root:    { flex: 1 },
  centered:{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyText:{ fontSize: 14 },

  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1,
  },
  searchWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  freeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
  },
  freeBtnText: { fontSize: 13, fontWeight: '600' },

  breadcrumb: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1,
  },
  breadcrumbText: { fontSize: 15, fontWeight: '600' },

  catGrid: { padding: 8, paddingBottom: 20 },

  fab: {
    position: 'absolute', bottom: 20, right: 16, left: 16,
    borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 13, paddingHorizontal: 20, gap: 10,
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  fabBadge:    { borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  fabBadgeText:{ fontWeight: '800', fontSize: 12 },
  fabTotal:    { color: '#fff', fontWeight: '700', fontSize: 15 },
})
