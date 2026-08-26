import { useState, useMemo } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, Modal, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useAppColors } from '@/lib/theme'
import { formatCurrency } from '@/lib/utils'
import type { Product, Category, ModifierGroup, CartModifier } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PickedItem {
  productId: string | null
  name: string
  unitPrice: number
  quantity: number
  modifiers: CartModifier[]
  notes: string
}

interface Props {
  visible: boolean
  onClose: () => void
  onConfirm: (items: PickedItem[]) => Promise<void>
  title?: string
  confirmLabel?: string
}

// ─── ProductRow ───────────────────────────────────────────────────────────────

function ProdRow({ product, onPress }: { product: Product; onPress: () => void }) {
  const c = useAppColors()
  const { tenant } = useAuthStore()
  const PRIMARY    = tenant?.primaryColor ?? '#2563eb'
  const sign       = tenant?.currencySign ?? '$'
  const outOfStock = product.inStock === false
  const hasFlavors = (product.flavors?.length ?? 0) > 0
  const hasMods    = (product.modifierGroups?.length ?? 0) > 0

  return (
    <TouchableOpacity
      style={[s.prodRow, { borderBottomColor: c.border, backgroundColor: c.surface }, outOfStock && { opacity: 0.55 }]}
      onPress={outOfStock ? undefined : onPress}
      activeOpacity={outOfStock ? 1 : 0.7}
      disabled={outOfStock}
    >
      <View style={{ flex: 1 }}>
        <Text style={[s.prodName, { color: outOfStock ? c.textMuted : c.text }]} numberOfLines={1}>{product.name}</Text>
        {outOfStock
          ? <Text style={{ fontSize: 11, fontWeight: '700', color: '#ef4444', marginTop: 2 }}>Agotado</Text>
          : hasFlavors
            ? <Text style={[s.prodSub, { color: c.textMuted }]}>Con sabores</Text>
            : hasMods
              ? <Text style={[s.prodSub, { color: c.textMuted }]}>Personalizable</Text>
              : null
        }
      </View>
      {!outOfStock && <Text style={[s.prodPrice, { color: PRIMARY }]}>{formatCurrency(parseFloat(product.price), sign)}</Text>}
    </TouchableOpacity>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ProductPickerModal({ visible, onClose, onConfirm, title = 'Agregar productos', confirmLabel = 'Confirmar' }: Props) {
  const c = useAppColors()
  const { tenant } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const sign    = tenant?.currencySign ?? '$'

  // Product/category data
  const { data: products = [], isLoading: loadingProds } = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: async () => {
      const res = await api.get<{ data: Product[] }>('/api/tenant/products')
      return res.data ?? []
    },
  })
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: async () => {
      const res = await api.get<{ data: Category[] }>('/api/tenant/categories')
      return res.data ?? []
    },
  })

  // List navigation state
  const [catId,  setCatId]  = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [staged, setStaged] = useState<PickedItem[]>([])
  const [submitting, setSub] = useState(false)

  // Picker state — shown when a product is tapped or "Libre" is pressed
  const [pickerProd, setPicker]   = useState<Product | null>(null)
  const [pickerType, setPickerType] = useState<'flavor' | 'modifier' | 'simple' | 'libre' | null>(null)

  // Shared picker inputs (reset on each product tap)
  const [qty,        setQty]   = useState(1)
  const [notes,      setNotes] = useState('')
  const [selFlavor,  setFlavor] = useState<string | null>(null)
  const [selMods,    setSelMods] = useState<Record<string, CartModifier[]>>({})
  // Libre product inputs
  const [libreName,  setLibreName]  = useState('')
  const [librePrice, setLibrePrice] = useState('')

  const isSearch = search.length > 0
  const activeCategories = useMemo(() => {
    const ids = new Set(products.map((p) => p.categoryId))
    return categories.filter((c) => ids.has(c.id))
  }, [products, categories])

  const visibleProducts = useMemo(() => {
    if (isSearch) return products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    if (catId) return products.filter((p) => p.categoryId === catId)
    return []
  }, [products, search, catId, isSearch])

  function handleProductTap(product: Product) {
    setQty(1)
    setNotes('')
    setFlavor(null)
    // Pre-select default modifiers
    const groups = product.modifierGroups ?? []
    const defaults: Record<string, CartModifier[]> = {}
    for (const g of groups) {
      const defs = g.modifiers.filter((m) => m.isDefault)
      if (defs.length > 0) {
        defaults[g.id] = defs.map((m) => ({
          groupId: g.id, groupName: g.name,
          modifierId: m.id, modifierName: m.name,
          priceDelta: parseFloat(m.priceDelta as any) || 0,
        }))
      }
    }
    setSelMods(defaults)
    setPicker(product)
    if ((product.flavors?.length ?? 0) > 0) setPickerType('flavor')
    else if (groups.length > 0) setPickerType('modifier')
    else setPickerType('simple')
  }

  function openLibre() {
    setLibreName('')
    setLibrePrice('')
    setQty(1)
    setPicker(null)
    setPickerType('libre')
  }

  function closePicker() {
    setPicker(null)
    setPickerType(null)
    setQty(1)
    setNotes('')
    setFlavor(null)
    setSelMods({})
    setLibreName('')
    setLibrePrice('')
  }

  function addToStaged(item: PickedItem) {
    setStaged((prev) => [...prev, item])
    closePicker()
  }

  function removeStaged(idx: number) {
    setStaged((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleConfirm() {
    if (staged.length === 0) return
    setSub(true)
    try {
      await onConfirm(staged)
      setStaged([])
      setCatId(null)
      setSearch('')
    } finally {
      setSub(false)
    }
  }

  function handlePickerAdd() {
    if (pickerType === 'libre') {
      const price = parseFloat(librePrice) || 0
      if (!libreName.trim() || price <= 0) return
      addToStaged({ productId: null, name: libreName.trim(), unitPrice: price, quantity: qty, modifiers: [], notes })
      return
    }
    if (!pickerProd) return
    const price = parseFloat(pickerProd.price)
    if (pickerType === 'simple') {
      addToStaged({ productId: pickerProd.id, name: pickerProd.name, unitPrice: price, quantity: qty, modifiers: [], notes })
    } else if (pickerType === 'flavor' && selFlavor) {
      addToStaged({ productId: pickerProd.id, name: pickerProd.name, unitPrice: price, quantity: qty, modifiers: [], notes: `Sabor: ${selFlavor}` })
    } else if (pickerType === 'modifier') {
      const groups = pickerProd.modifierGroups ?? []
      const canAdd = groups.every((g) => !g.isRequired || (selMods[g.id]?.length ?? 0) >= (g.minSelections || 1))
      if (!canAdd) return
      const allMods = Object.values(selMods).flat()
      addToStaged({ productId: pickerProd.id, name: pickerProd.name, unitPrice: price, quantity: qty, modifiers: allMods, notes })
    }
  }

  // Compute picker totals for the "Agregar" button label
  const pickerPrice = pickerType === 'libre' ? (parseFloat(librePrice) || 0) : pickerProd ? parseFloat(pickerProd.price) : 0
  const modsDelta   = pickerType === 'modifier' ? Object.values(selMods).flat().reduce((s, m) => s + m.priceDelta, 0) : 0
  const pickerTotal = (pickerPrice + modsDelta) * qty

  const canPickerAdd = pickerType === 'libre' ? (!!libreName.trim() && parseFloat(librePrice) > 0) :
    pickerType === 'flavor' ? !!selFlavor :
    pickerType === 'modifier' ? (pickerProd?.modifierGroups ?? []).every((g) => !g.isRequired || (selMods[g.id]?.length ?? 0) >= (g.minSelections || 1)) :
    true

  const showCategories = !isSearch && !catId
  const selectedCat    = catId ? categories.find((c) => c.id === catId) : null
  const stagedTotal    = staged.reduce((sum, i) => {
    const modsDelta = i.modifiers.reduce((ms, m) => ms + m.priceDelta, 0)
    return sum + (i.unitPrice + modsDelta) * i.quantity
  }, 0)

  function toggleMod(g: ModifierGroup, modId: string, modName: string, delta: number) {
    setSelMods((prev) => {
      const cur = prev[g.id] ?? []
      const exists = cur.find((m) => m.modifierId === modId)
      if (g.selectionType === 'single') {
        return exists ? { ...prev, [g.id]: [] } : { ...prev, [g.id]: [{ groupId: g.id, groupName: g.name, modifierId: modId, modifierName: modName, priceDelta: delta }] }
      }
      return exists
        ? { ...prev, [g.id]: cur.filter((m) => m.modifierId !== modId) }
        : { ...prev, [g.id]: [...cur, { groupId: g.id, groupName: g.name, modifierId: modId, modifierName: modName, priceDelta: delta }] }
    })
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={pickerProd ? closePicker : onClose}>
      <SafeAreaView style={[s.root, { backgroundColor: c.background }]} edges={['bottom']}>

        {/* ── Picker view (when product selected or libre) ── */}
        {(pickerProd || pickerType === 'libre') ? (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            {/* Header with back button */}
            <View style={[s.header, { borderBottomColor: c.border }]}>
              <TouchableOpacity onPress={closePicker} style={{ padding: 2 }}>
                <Ionicons name="chevron-back" size={26} color={c.textSecondary} />
              </TouchableOpacity>
              <Text style={[s.headerTitle, { color: c.text, flex: 1, textAlign: 'center' }]} numberOfLines={1}>
                {pickerType === 'libre' ? 'Producto libre' : pickerProd!.name}
              </Text>
              <View style={{ width: 30 }} />
            </View>

            <ScrollView contentContainerStyle={s.pickBody} keyboardShouldPersistTaps="handled">
              {/* Libre form */}
              {pickerType === 'libre' && (
                <>
                  <View style={s.group}>
                    <Text style={[s.groupName, { color: c.text }]}>Nombre del producto</Text>
                    <TextInput
                      style={[s.notesInput, { borderColor: c.border, backgroundColor: c.surfaceAlt, color: c.text, minHeight: 48, textAlignVertical: 'center' }]}
                      value={libreName}
                      onChangeText={setLibreName}
                      placeholder="Ej: Gaseosa, Agua, Servicio..."
                      placeholderTextColor={c.textMuted}
                      autoFocus
                    />
                  </View>
                  <View style={s.group}>
                    <Text style={[s.groupName, { color: c.text }]}>Precio unitario</Text>
                    <TextInput
                      style={[s.notesInput, { borderColor: c.border, backgroundColor: c.surfaceAlt, color: c.text, minHeight: 48, textAlignVertical: 'center' }]}
                      value={librePrice}
                      onChangeText={setLibrePrice}
                      placeholder="0"
                      placeholderTextColor={c.textMuted}
                      keyboardType="numeric"
                    />
                  </View>
                </>
              )}

              {/* Price (non-libre products) */}
              {pickerType !== 'libre' && (
                <Text style={[s.sheetPrice, { color: c.textMuted, textAlign: 'center' }]}>
                  {formatCurrency(pickerPrice, sign)} c/u
                </Text>
              )}

              {/* Qty selector (always shown) */}
              <View style={s.qtySection}>
                <Text style={[s.groupName, { color: c.text }]}>Cantidad</Text>
                <View style={s.qtyRow}>
                  <TouchableOpacity style={[s.qtyBtn, { borderColor: PRIMARY }]} onPress={() => setQty((q) => Math.max(1, q - 1))}>
                    <Ionicons name="remove" size={22} color={PRIMARY} />
                  </TouchableOpacity>
                  <Text style={[s.qtyNum, { color: c.text }]}>{qty}</Text>
                  <TouchableOpacity style={[s.qtyBtn, { borderColor: PRIMARY }]} onPress={() => setQty((q) => q + 1)}>
                    <Ionicons name="add" size={22} color={PRIMARY} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Flavor picker */}
              {pickerType === 'flavor' && (
                <View style={s.group}>
                  <Text style={[s.groupName, { color: c.text }]}>Elige el sabor</Text>
                  <View style={s.chipsWrap}>
                    {pickerProd!.flavors.map((fl) => {
                      const selected = fl === selFlavor
                      return (
                        <TouchableOpacity
                          key={fl}
                          style={[s.chip, { borderColor: selected ? PRIMARY : c.border, backgroundColor: selected ? PRIMARY : c.surfaceAlt }]}
                          onPress={() => setFlavor(fl)}
                        >
                          <Text style={[s.chipText, { color: selected ? '#fff' : c.textSecondary }]}>{fl}</Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                </View>
              )}

              {/* Modifier groups */}
              {pickerType === 'modifier' && (pickerProd!.modifierGroups ?? []).map((g) => {
                const sel = selMods[g.id] ?? []
                return (
                  <View key={g.id} style={s.group}>
                    <View style={s.groupHeader}>
                      <Text style={[s.groupName, { color: c.text }]}>{g.name}</Text>
                      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                        {g.isRequired && <View style={s.requiredBadge}><Text style={s.requiredText}>Requerido</Text></View>}
                        <Text style={[s.groupHint, { color: c.textMuted }]}>{g.selectionType === 'single' ? 'Elige 1' : `Hasta ${g.maxSelections ?? '∞'}`}</Text>
                      </View>
                    </View>
                    <View style={s.modsGrid}>
                      {g.modifiers.map((mod) => {
                        const isSel = sel.some((m) => m.modifierId === mod.id)
                        const delta = parseFloat(mod.priceDelta as any) || 0
                        return (
                          <TouchableOpacity
                            key={mod.id}
                            style={[s.chip, isSel && { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
                            onPress={() => toggleMod(g, mod.id, mod.name, delta)}
                          >
                            <Text style={[s.chipText, { color: isSel ? '#fff' : c.textSecondary }]}>{mod.name}</Text>
                            {delta !== 0 && <Text style={[s.modDelta, { color: isSel ? '#fff' : c.textMuted }]}>{delta > 0 ? '+' : ''}{formatCurrency(delta, sign)}</Text>}
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  </View>
                )
              })}

              {/* Notes (shown for simple and modifier pickers) */}
              {(pickerType === 'simple' || pickerType === 'modifier') && (
                <View style={s.group}>
                  <Text style={[s.groupName, { color: c.text }]}>Notas (opcional)</Text>
                  <TextInput
                    style={[s.notesInput, { borderColor: c.border, backgroundColor: c.surfaceAlt, color: c.text }]}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Ej: sin cebolla, extra picante..."
                    placeholderTextColor={c.textMuted}
                    multiline
                  />
                </View>
              )}
            </ScrollView>

            {/* Add button */}
            <View style={[s.footer, { borderTopColor: c.border }]}>
              <TouchableOpacity
                style={[s.confirmBtn, { backgroundColor: PRIMARY }, !canPickerAdd && { opacity: 0.4 }]}
                onPress={handlePickerAdd}
                disabled={!canPickerAdd}
              >
                <Text style={s.confirmBtnText}>
                  Agregar {qty > 1 ? `${qty} × ` : ''}{formatCurrency(pickerTotal, sign)}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>

        ) : (
          /* ── List view (categories / products) ── */
          <>
            {/* Header */}
            <View style={[s.header, { borderBottomColor: c.border }]}>
              <Text style={[s.headerTitle, { color: c.text }]}>{title}</Text>
              <TouchableOpacity onPress={onClose}>
                <Ionicons name="close" size={24} color={c.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Search */}
            <View style={[s.searchRow, { borderBottomColor: c.border }]}>
              <View style={[s.searchWrap, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
                <Ionicons name="search-outline" size={15} color={c.textMuted} />
                <TextInput
                  style={[s.searchInput, { color: c.text }]}
                  placeholder="Buscar producto..."
                  placeholderTextColor={c.textMuted}
                  value={search}
                  onChangeText={(t) => { setSearch(t); if (t) setCatId(null) }}
                />
                {search.length > 0 && (
                  <TouchableOpacity onPress={() => setSearch('')}>
                    <Ionicons name="close-circle" size={15} color={c.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Staged items */}
            {staged.length > 0 && (
              <View style={[s.staged, { backgroundColor: PRIMARY + '12', borderBottomColor: PRIMARY + '30' }]}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingVertical: 8 }}>
                  {staged.map((item, idx) => (
                    <View key={idx} style={[s.stagedChip, { backgroundColor: PRIMARY + '20', borderColor: PRIMARY }]}>
                      <Text style={[s.stagedChipText, { color: PRIMARY }]} numberOfLines={1}>
                        {item.quantity}× {item.name}{item.notes ? ` (${item.notes})` : ''}
                      </Text>
                      <TouchableOpacity onPress={() => removeStaged(idx)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Ionicons name="close-circle" size={14} color={PRIMARY} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Breadcrumb */}
            {selectedCat && !isSearch && (
              <TouchableOpacity style={[s.breadcrumb, { borderBottomColor: c.border }]} onPress={() => setCatId(null)}>
                <Ionicons name="chevron-back" size={16} color={PRIMARY} />
                <Text style={[s.breadcrumbText, { color: PRIMARY }]}>{selectedCat.emoji} {selectedCat.name}</Text>
              </TouchableOpacity>
            )}

            {/* Libre button */}
            <TouchableOpacity
              style={[s.libreBtn, { borderColor: c.border, backgroundColor: c.surfaceAlt }]}
              onPress={openLibre}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={18} color={PRIMARY} />
              <Text style={[s.libreBtnText, { color: PRIMARY }]}>Producto libre (precio manual)</Text>
            </TouchableOpacity>

            {/* Content */}
            {showCategories ? (
              loadingProds ? (
                <View style={s.centered}><ActivityIndicator size="large" color={PRIMARY} /></View>
              ) : (
                <FlatList
                  key="cats"
                  data={activeCategories}
                  keyExtractor={(c) => c.id}
                  numColumns={3}
                  contentContainerStyle={s.catGrid}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[s.catCard, { backgroundColor: c.surface, shadowColor: c.shadow }]}
                      onPress={() => setCatId(item.id)}
                      activeOpacity={0.75}
                    >
                      <Text style={s.catEmoji}>{item.emoji ?? '📦'}</Text>
                      <Text style={[s.catName, { color: c.text }]} numberOfLines={2}>{item.name}</Text>
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={<View style={s.centered}><Text style={{ color: c.textMuted }}>Sin categorías</Text></View>}
                />
              )
            ) : (
              <FlatList
                key="prods"
                data={visibleProducts}
                keyExtractor={(p) => p.id}
                contentContainerStyle={{ paddingBottom: 20 }}
                renderItem={({ item }) => <ProdRow product={item} onPress={() => handleProductTap(item)} />}
                ListEmptyComponent={<View style={s.centered}><Text style={{ color: c.textMuted }}>Sin resultados</Text></View>}
              />
            )}

            {/* Confirm footer */}
            {staged.length > 0 && (
              <View style={[s.footer, { borderTopColor: c.border }]}>
                <TouchableOpacity
                  style={[s.confirmBtn, { backgroundColor: PRIMARY }, submitting && { opacity: 0.6 }]}
                  onPress={handleConfirm}
                  disabled={submitting}
                >
                  {submitting
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={s.confirmBtnText}>
                        {confirmLabel} · {staged.reduce((n, i) => n + i.quantity, 0)} ítem(s) · {formatCurrency(stagedTotal, sign)}
                      </Text>
                  }
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </SafeAreaView>
    </Modal>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1 },
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  centered:{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  searchRow:  { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  searchInput:{ flex: 1, fontSize: 14, padding: 0 },

  staged:         { borderBottomWidth: 1 },
  stagedChip:     { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 16, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  stagedChipText: { fontSize: 12, fontWeight: '600', maxWidth: 180 },

  breadcrumb:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1 },
  breadcrumbText: { fontSize: 14, fontWeight: '600' },

  catGrid: { padding: 8, paddingBottom: 20 },
  catCard: { flex: 1, margin: 5, borderRadius: 14, padding: 14, alignItems: 'center', gap: 6, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  catEmoji:{ fontSize: 30 },
  catName: { fontSize: 12, fontWeight: '600', textAlign: 'center' },

  prodRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, gap: 12 },
  prodName:    { fontSize: 15, fontWeight: '600' },
  prodSub:     { fontSize: 12, marginTop: 2 },
  prodPrice:   { fontSize: 14, fontWeight: '700', minWidth: 64, textAlign: 'right' },

  footer:      { padding: 16, borderTopWidth: 1 },
  confirmBtn:  { borderRadius: 12, padding: 15, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  pickBody:   { padding: 20, gap: 20 },

  group:       { gap: 10 },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  groupName:   { fontSize: 15, fontWeight: '700' },
  groupHint:   { fontSize: 12 },
  requiredBadge: { backgroundColor: '#fef3c7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  requiredText:  { fontSize: 10, fontWeight: '700', color: '#d97706' },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  modsGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: '#d1d5db' },
  chipText:  { fontSize: 14, fontWeight: '600' },
  modDelta:  { fontSize: 12 },

  notesInput: {
    borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, minHeight: 70, textAlignVertical: 'top',
  },
  qtySection: { gap: 10 },
  qtyRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },
  qtyBtn:    { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  qtyNum:    { fontSize: 26, fontWeight: '800', minWidth: 36, textAlign: 'center' },

  addBtn:    { borderRadius: 12, padding: 16, alignItems: 'center' },
  addBtnText:{ color: '#fff', fontWeight: '700', fontSize: 16 },

  libreBtn:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1 },
  libreBtnText: { fontSize: 14, fontWeight: '600' },

  sheetPrice: { fontSize: 14, fontWeight: '600' },
})
