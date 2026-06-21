import { useState, useMemo, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, Modal, ScrollView, Alert, ActivityIndicator,
  SafeAreaView, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '@/lib/api'
import { usePosStore } from '@/stores/pos-store'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { enqueueSync, saveOfflineOrder } from '@/lib/offline/sync-queue'
import { useNetworkStatus } from '@/hooks/use-network'
import { ErrorView } from '@/components/ErrorView'
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
  const modsDelta = allMods.reduce((s, m) => s + m.priceDelta, 0)
  const unitPrice = parseFloat(product.price) + modsDelta
  const total     = unitPrice * qty

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.modRoot}>
        <View style={styles.modHeader}>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color="#374151" />
          </TouchableOpacity>
          <Text style={styles.modTitle} numberOfLines={1}>{product.name}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={styles.modBody}>
          {/* Cantidad */}
          <View style={styles.qtyRow}>
            <Text style={styles.groupName}>Cantidad</Text>
            <View style={styles.qtyControls}>
              <TouchableOpacity style={[styles.qtyBtn, { borderColor: PRIMARY }]} onPress={() => setQty(Math.max(1, qty - 1))}>
                <Ionicons name="remove" size={16} color={PRIMARY} />
              </TouchableOpacity>
              <Text style={styles.qtyNum}>{qty}</Text>
              <TouchableOpacity style={[styles.qtyBtn, { borderColor: PRIMARY }]} onPress={() => setQty(qty + 1)}>
                <Ionicons name="add" size={16} color={PRIMARY} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Grupos de modificadores */}
          {groups.map((group) => {
            const groupSelected = selected[group.id] ?? []
            return (
              <View key={group.id} style={styles.group}>
                <View style={styles.groupHeader}>
                  <Text style={styles.groupName}>{group.name}</Text>
                  <View style={styles.groupMeta}>
                    {group.isRequired && <View style={styles.requiredBadge}><Text style={styles.requiredText}>Requerido</Text></View>}
                    <Text style={styles.groupHint}>
                      {group.selectionType === 'single' ? 'Elige 1' : `Elige hasta ${group.maxSelections ?? '∞'}`}
                    </Text>
                  </View>
                </View>
                <View style={styles.modsGrid}>
                  {group.modifiers.map((mod) => {
                    const isSelected = groupSelected.some((s) => s.modifierId === mod.id)
                    const delta = parseFloat(mod.priceDelta as any) || 0
                    return (
                      <TouchableOpacity
                        key={mod.id}
                        style={[styles.modChip, isSelected && { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
                        onPress={() => toggle(group, mod.id, mod.name, delta)}
                      >
                        <Text style={[styles.modChipText, isSelected && { color: '#fff' }]}>{mod.name}</Text>
                        {delta !== 0 && (
                          <Text style={[styles.modDelta, isSelected && { color: '#fff' }]}>
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
          <View style={styles.group}>
            <Text style={styles.groupName}>Notas (opcional)</Text>
            <TextInput
              style={styles.modNotesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="Ej: sin cebolla, extra picante..."
              multiline
            />
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={styles.modFooter}>
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: PRIMARY }, !canAdd() && styles.btnDisabled]}
            disabled={!canAdd()}
            onPress={() => { onAdd({ modifiers: allMods, quantity: qty, notes }); onClose() }}
          >
            <Text style={styles.addBtnText}>
              Agregar · {formatCurrency(total, sign)}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

// ─── Tarjeta de producto ──────────────────────────────────────────────────────

function ProductCard({ product, onPress }: { product: Product; onPress: () => void }) {
  const { tenant } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const sign    = tenant?.currencySign ?? '$'
  const hasModifiers = (product.modifierGroups?.length ?? 0) > 0

  return (
    <TouchableOpacity style={styles.productCard} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.productIcon, { backgroundColor: PRIMARY + '18' }]}>
        <Ionicons name="fast-food-outline" size={26} color={PRIMARY} />
      </View>
      <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
      <View style={styles.productBottom}>
        <Text style={[styles.productPrice, { color: PRIMARY }]}>{formatCurrency(parseFloat(product.price), sign)}</Text>
        {hasModifiers && (
          <View style={[styles.customBadge, { backgroundColor: PRIMARY + '18' }]}>
            <Text style={[styles.customBadgeText, { color: PRIMARY }]}>Personalizable</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  )
}

// ─── Modal: Producto libre ────────────────────────────────────────────────────

function FreeProductModal({ visible, onAdd, onClose }: {
  visible: boolean
  onAdd: (name: string, price: number) => void
  onClose: () => void
}) {
  const { tenant } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const [name, setName]   = useState('')
  const [price, setPrice] = useState('')

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.freeOverlay}>
        <View style={styles.freeCard}>
          <Text style={styles.freeTitle}>Producto libre</Text>
          <TextInput style={styles.cartInput} placeholder="Nombre" value={name} onChangeText={setName} />
          <TextInput style={styles.cartInput} placeholder="Precio" value={price} onChangeText={setPrice} keyboardType="numeric" />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <TouchableOpacity style={[styles.freeBtn, { borderColor: '#e5e7eb' }]} onPress={onClose}>
              <Text style={{ color: '#374151', fontWeight: '600' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.freeBtn, { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
              onPress={() => {
                if (!name || !price) return
                onAdd(name, parseFloat(price) || 0)
                setName(''); setPrice(''); onClose()
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '600' }}>Agregar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ─── Modal carrito ────────────────────────────────────────────────────────────

function CartModal({ visible, onClose, tables }: {
  visible: boolean
  onClose: () => void
  tables: Table[]
}) {
  const qc = useQueryClient()
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
  const subtotal     = getSubtotal()
  const deliveryFeeNum = parseFloat(deliveryFee) || 0
  const isDelivery   = orderType === 'delivery'
  const total        = subtotal + (isDelivery ? deliveryFeeNum : 0)

  async function handleCreate() {
    if (items.length === 0) return
    const needsAddress = dfFields?.address ?? true
    if (isDelivery && needsAddress && !customerAddress.trim()) {
      Alert.alert('Dirección requerida', 'Ingresa la dirección del domicilio.')
      return
    }
    setSubmitting(true)

    const localId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
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
      Alert.alert('Pedido creado', 'El pedido fue enviado correctamente.')
    } catch (err: any) {
      const isNetworkError = !isConnected || err?.message?.includes('Network request failed') || err?.message?.includes('fetch')
      if (isNetworkError) {
        saveOfflineOrder(localId, orderPayload)
        enqueueSync('create_order', orderPayload)
        clearCart()
        onClose()
        Alert.alert(
          'Sin conexión',
          'El pedido se guardó localmente y se enviará automáticamente cuando vuelva la conexión.',
        )
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
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.cartRoot}>
        <View style={styles.cartHeader}>
          <Text style={styles.cartTitle}>Carrito</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color="#374151" />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>

            {/* Tipo de pedido */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Tipo</Text>
              <View style={styles.chipRow}>
                {ORDER_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.chip, orderType === t.key && { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
                    onPress={() => {
                      setOrderType(t.key)
                      if (t.key === 'delivery' && config?.defaultDeliveryFee && !deliveryFee) {
                        setDeliveryFee(String(config.defaultDeliveryFee))
                      }
                    }}
                  >
                    <Text style={[styles.chipText, orderType === t.key && { color: '#fff' }]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Mesa */}
            {orderType === 'table' && tables.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Mesa</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <TouchableOpacity
                    style={[styles.chip, !tableId && { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
                    onPress={() => setTable(null, null)}
                  >
                    <Text style={[styles.chipText, !tableId && { color: '#fff' }]}>Sin mesa</Text>
                  </TouchableOpacity>
                  {tables.filter((t) => t.status !== 'occupied').map((t) => (
                    <TouchableOpacity
                      key={t.id}
                      style={[styles.chip, { marginLeft: 8 }, tableId === t.id && { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
                      onPress={() => setTable(t.id, t.name)}
                    >
                      <Text style={[styles.chipText, tableId === t.id && { color: '#fff' }]}>{t.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Cliente */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Cliente (opcional)</Text>
              <TextInput
                style={styles.cartInput}
                value={customerName}
                onChangeText={setCustomerName}
                placeholder="Nombre del cliente"
              />
            </View>

            {/* Campos de domicilio */}
            {isDelivery && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Datos del domicilio</Text>
                {(dfFields?.phone ?? true) && (
                  <TextInput
                    style={[styles.cartInput, { marginBottom: 8 }]}
                    value={customerPhone}
                    onChangeText={setCustomerPhone}
                    placeholder="Teléfono de contacto"
                    keyboardType="phone-pad"
                  />
                )}
                {(dfFields?.address ?? true) && (
                  <TextInput
                    style={[styles.cartInput, { marginBottom: 8 }]}
                    value={customerAddress}
                    onChangeText={setCustomerAddress}
                    placeholder="Dirección de entrega *"
                  />
                )}
                {(dfFields?.notes ?? true) && (
                  <TextInput
                    style={[styles.cartInput, { marginBottom: 8 }]}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Notas del domicilio"
                    multiline
                  />
                )}
                {(dfFields?.fee ?? true) && (
                  <TextInput
                    style={styles.cartInput}
                    value={deliveryFee}
                    onChangeText={setDeliveryFee}
                    placeholder={`Costo de envío (${sign})`}
                    keyboardType="numeric"
                  />
                )}
              </View>
            )}

            {/* Productos */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Productos</Text>
              {items.length === 0 && (
                <Text style={styles.emptyText}>El carrito está vacío</Text>
              )}
              {items.map((item) => {
                const mods    = item.modifiers.reduce((s, m) => s + m.priceDelta, 0)
                const lineTotal = (item.unitPrice + mods) * item.quantity
                return (
                  <View key={item.localId} style={styles.cartItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cartItemName}>{item.name}</Text>
                      {item.modifiers.length > 0 && (
                        <Text style={styles.cartItemMods}>
                          {item.modifiers.map((m) => m.modifierName).join(', ')}
                        </Text>
                      )}
                      {item.notes ? <Text style={styles.cartItemNotes}>⚠ {item.notes}</Text> : null}
                      <Text style={[styles.cartItemPrice, { color: PRIMARY }]}>{formatCurrency(lineTotal, sign)}</Text>
                    </View>
                    <View style={styles.cartQtyRow}>
                      <TouchableOpacity style={[styles.qtyBtn, { borderColor: PRIMARY }]} onPress={() => updateQty(item.localId, item.quantity - 1)}>
                        <Ionicons name="remove" size={14} color={PRIMARY} />
                      </TouchableOpacity>
                      <Text style={styles.qtyNum}>{item.quantity}</Text>
                      <TouchableOpacity style={[styles.qtyBtn, { borderColor: PRIMARY }]} onPress={() => updateQty(item.localId, item.quantity + 1)}>
                        <Ionicons name="add" size={14} color={PRIMARY} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => removeItem(item.localId)} style={{ marginLeft: 4 }}>
                        <Ionicons name="trash-outline" size={18} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                )
              })}
            </View>

            {/* Notas generales */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Notas (opcional)</Text>
              <TextInput
                style={[styles.cartInput, { height: 60 }]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Instrucciones especiales..."
                multiline
              />
            </View>
          </ScrollView>

          {/* Footer */}
          <View style={styles.cartFooter}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{isDelivery ? 'Subtotal' : 'Total'}</Text>
              <Text style={isDelivery ? styles.totalSubValue : styles.totalValue}>{formatCurrency(subtotal, sign)}</Text>
            </View>
            {isDelivery && (
              <>
                <View style={[styles.totalRow, { marginBottom: 8 }]}>
                  <Text style={styles.totalLabel}>Domicilio</Text>
                  <Text style={styles.totalSubValue}>{formatCurrency(deliveryFeeNum, sign)}</Text>
                </View>
                <View style={[styles.totalRow, { marginBottom: 14 }]}>
                  <Text style={[styles.totalLabel, { fontWeight: '700', color: '#0f172a' }]}>Total</Text>
                  <Text style={styles.totalValue}>{formatCurrency(total, sign)}</Text>
                </View>
              </>
            )}
            <TouchableOpacity
              style={[styles.createBtn, { backgroundColor: PRIMARY }, (submitting || items.length === 0) && styles.btnDisabled]}
              onPress={handleCreate}
              disabled={submitting || items.length === 0}
            >
              {submitting
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.createBtnText}>Crear pedido</Text>
              }
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

// ─── Pantalla principal POS ───────────────────────────────────────────────────

export default function PosScreen() {
  const { data: _products, isLoading: loadingProds, isError: errorProds, refetch: refetchProds } = useProducts()
  const { data: _categories } = useCategories()
  const { data: _tables }     = useTables()
  const products   = Array.isArray(_products)   ? _products   : []
  const categories = Array.isArray(_categories) ? _categories : []
  const tables     = Array.isArray(_tables)     ? _tables     : []
  const { addItem, itemCount, getSubtotal } = usePosStore()
  const { tenant } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const sign    = tenant?.currencySign ?? '$'

  const [categoryId, setCategoryId]           = useState<string | null>(null)
  const [search, setSearch]                   = useState('')
  const [cartOpen, setCartOpen]               = useState(false)
  const [freeOpen, setFreeOpen]               = useState(false)
  const [modProduct, setModProduct]           = useState<Product | null>(null)

  const filtered = useMemo(() => {
    let list = products.filter((p) => p.isAvailable)
    if (categoryId) list = list.filter((p) => p.categoryId === categoryId)
    if (search)     list = list.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    return list
  }, [products, categoryId, search])

  const handlePress = useCallback((product: Product) => {
    if ((product.modifierGroups?.length ?? 0) > 0) {
      setModProduct(product)
    } else {
      addItem({ productId: product.id, name: product.name, unitPrice: parseFloat(product.price), quantity: 1, modifiers: [], notes: '' })
    }
  }, [addItem])

  function handleModAdd(product: Product, { modifiers, quantity, notes }: { modifiers: any[]; quantity: number; notes: string }) {
    addItem({ productId: product.id, name: product.name, unitPrice: parseFloat(product.price), quantity, modifiers, notes })
  }

  if (loadingProds) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={PRIMARY} /></View>
  }

  if (errorProds) {
    return <ErrorView message="No se pudieron cargar los productos." onRetry={refetchProds} />
  }

  return (
    <View style={styles.root}>
      {/* Buscador */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color="#9ca3af" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar producto..."
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color="#9ca3af" />
          </TouchableOpacity>
        )}
      </View>

      {/* Categorías */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={styles.catScroll} contentContainerStyle={styles.catContent}
      >
        <TouchableOpacity
          style={[styles.catChip, !categoryId && { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
          onPress={() => setCategoryId(null)}
        >
          <Text style={[styles.catChipText, !categoryId && { color: '#fff' }]}>Todos</Text>
        </TouchableOpacity>
        {categories.map((c) => (
          <TouchableOpacity
            key={c.id}
            style={[styles.catChip, categoryId === c.id && { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
            onPress={() => setCategoryId(c.id)}
          >
            <Text style={[styles.catChipText, categoryId === c.id && { color: '#fff' }]}>
              {c.emoji ? `${c.emoji} ` : ''}{c.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Grid de productos */}
      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id}
        numColumns={2}
        renderItem={({ item }) => <ProductCard product={item} onPress={() => handlePress(item)} />}
        contentContainerStyle={styles.grid}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Ionicons name="fast-food-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyText}>Sin productos disponibles</Text>
          </View>
        }
      />

      {/* Botón producto libre */}
      <TouchableOpacity style={[styles.freeProductBtn, { borderColor: PRIMARY }]} onPress={() => setFreeOpen(true)}>
        <Ionicons name="add-circle-outline" size={16} color={PRIMARY} />
        <Text style={[styles.freeProductText, { color: PRIMARY }]}>Producto libre</Text>
      </TouchableOpacity>

      {/* FAB carrito */}
      {itemCount > 0 && (
        <TouchableOpacity style={[styles.fab, { backgroundColor: PRIMARY }]} onPress={() => setCartOpen(true)}>
          <Ionicons name="cart" size={24} color="#fff" />
          <View style={styles.fabBadge}>
            <Text style={[styles.fabBadgeText, { color: PRIMARY }]}>{itemCount}</Text>
          </View>
          <Text style={styles.fabTotal}>{formatCurrency(getSubtotal(), sign)}</Text>
        </TouchableOpacity>
      )}

      <CartModal visible={cartOpen} onClose={() => setCartOpen(false)} tables={tables} />

      <FreeProductModal
        visible={freeOpen}
        onClose={() => setFreeOpen(false)}
        onAdd={(name, price) => addItem({ productId: null, name, unitPrice: price, quantity: 1, modifiers: [], notes: '' })}
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

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:      { flex: 1, backgroundColor: '#f8fafc' },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyText: { color: '#9ca3af', fontSize: 14 },

  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', margin: 12, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: '#e5e7eb',
  },
  searchInput: { flex: 1, fontSize: 15, color: '#0f172a' },

  catScroll:   { flexGrow: 0, flexShrink: 0 },
  catContent:  { paddingHorizontal: 12, paddingVertical: 8, gap: 8, alignItems: 'center' },
  catChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0',
    alignSelf: 'center', flexShrink: 0,
  },
  catChipText: { fontSize: 13, color: '#475569', fontWeight: '500', flexShrink: 0 },

  grid: { padding: 8, paddingBottom: 120 },
  productCard: {
    flex: 1, margin: 6, backgroundColor: '#fff', borderRadius: 14, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  productIcon: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  productName:    { fontSize: 13, fontWeight: '600', color: '#1e293b', marginBottom: 6 },
  productBottom:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  productPrice:   { fontSize: 14, fontWeight: '700' },
  customBadge:    { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  customBadgeText:{ fontSize: 9, fontWeight: '700' },

  freeProductBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginHorizontal: 12, marginBottom: 8, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderStyle: 'dashed', backgroundColor: '#fff',
  },
  freeProductText: { fontSize: 13, fontWeight: '600' },

  fab: {
    position: 'absolute', bottom: 24, right: 16, left: 16,
    borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, paddingHorizontal: 20, gap: 10,
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
  },
  fabBadge:     { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  fabBadgeText: { fontWeight: '800', fontSize: 12 },
  fabTotal:     { color: '#fff', fontWeight: '700', fontSize: 16 },

  // Cart modal
  cartRoot: { flex: 1, backgroundColor: '#fff' },
  cartHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  cartTitle:   { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  section:     { paddingHorizontal: 20, paddingVertical: 12 },
  sectionLabel:{ fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', marginBottom: 10, letterSpacing: 0.5 },
  chipRow:     { flexDirection: 'row', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f9fafb',
  },
  chipText:    { fontSize: 13, color: '#374151', fontWeight: '500' },
  cartInput: {
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8,
    padding: 10, fontSize: 14, color: '#0f172a', backgroundColor: '#f9fafb',
  },
  cartItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f8fafc', gap: 8,
  },
  cartItemName:  { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  cartItemMods:  { fontSize: 12, color: '#94a3b8', marginTop: 1 },
  cartItemNotes: { fontSize: 12, color: '#f97316', marginTop: 1 },
  cartItemPrice: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  cartQtyRow:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cartFooter:    { padding: 20, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  totalRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  totalLabel:    { fontSize: 15, fontWeight: '600', color: '#374151' },
  totalValue:    { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  totalSubValue: { fontSize: 15, fontWeight: '600', color: '#6b7280' },
  createBtn:     { borderRadius: 12, padding: 16, alignItems: 'center' },
  btnDisabled:   { opacity: 0.5 },
  createBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  // Qty controls
  qtyRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  qtyControls:{ flexDirection: 'row', alignItems: 'center', gap: 14 },
  qtyBtn: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
  },
  qtyNum: { fontSize: 16, fontWeight: '700', color: '#1e293b', minWidth: 24, textAlign: 'center' },

  // Modifiers modal
  modRoot: { flex: 1, backgroundColor: '#fff' },
  modHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  modTitle:  { fontSize: 16, fontWeight: '700', color: '#0f172a', flex: 1, textAlign: 'center' },
  modBody:   { padding: 20, gap: 20 },
  modFooter: { padding: 20, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  addBtn:    { borderRadius: 12, padding: 16, alignItems: 'center' },
  addBtnText:{ color: '#fff', fontWeight: '700', fontSize: 16 },

  group:       { gap: 10 },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  groupName:   { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  groupMeta:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  groupHint:   { fontSize: 12, color: '#94a3b8' },
  requiredBadge: { backgroundColor: '#fef3c7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  requiredText:  { fontSize: 10, fontWeight: '700', color: '#d97706' },
  modsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#f8fafc',
  },
  modChipText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  modDelta:    { fontSize: 12, color: '#64748b' },
  modNotesInput: {
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10,
    padding: 12, fontSize: 14, color: '#0f172a', backgroundColor: '#f8fafc', minHeight: 70, textAlignVertical: 'top',
  },

  // Free product modal
  freeOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  freeCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, gap: 12 },
  freeTitle: { fontSize: 17, fontWeight: '700', color: '#1e293b' },
  freeBtn: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 12, alignItems: 'center' },
})
