import { useState, useMemo } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, Modal, ScrollView, ActivityIndicator,
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

// ─── FlavorPicker ─────────────────────────────────────────────────────────────

function FlavorPicker({ product, onAdd, onClose }: {
  product: Product
  onAdd: (flavor: string, qty: number) => void
  onClose: () => void
}) {
  const c = useAppColors()
  const { tenant } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const sign    = tenant?.currencySign ?? '$'
  const [sel, setSel] = useState<string | null>(null)
  const [qty, setQty] = useState(1)
  const price = parseFloat(product.price)

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[s.pickRoot, { backgroundColor: c.surface }]}>
        <View style={[s.pickHeader, { borderBottomColor: c.border }]}>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color={c.textSecondary} /></TouchableOpacity>
          <Text style={[s.pickTitle, { color: c.text }]} numberOfLines={1}>{product.name}</Text>
          <View style={{ width: 24 }} />
        </View>
        <ScrollView contentContainerStyle={s.pickBody}>
          <Text style={[s.groupName, { color: c.text }]}>Elige el sabor</Text>
          <View style={s.chipsWrap}>
            {product.flavors.map((fl) => {
              const selected = fl === sel
              return (
                <TouchableOpacity
                  key={fl}
                  style={[s.chip, { borderColor: selected ? PRIMARY : c.border, backgroundColor: selected ? PRIMARY : c.surfaceAlt }]}
                  onPress={() => setSel(fl)}
                >
                  <Text style={[s.chipText, { color: selected ? '#fff' : c.textSecondary }]}>{fl}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
          <View style={s.qtySection}>
            <Text style={[s.groupName, { color: c.text }]}>Cantidad</Text>
            <View style={s.qtyRow}>
              <TouchableOpacity style={[s.qtyBtn, { borderColor: PRIMARY }]} onPress={() => setQty((q) => Math.max(1, q - 1))}>
                <Ionicons name="remove" size={18} color={PRIMARY} />
              </TouchableOpacity>
              <Text style={[s.qtyNum, { color: c.text }]}>{qty}</Text>
              <TouchableOpacity style={[s.qtyBtn, { borderColor: PRIMARY }]} onPress={() => setQty((q) => q + 1)}>
                <Ionicons name="add" size={18} color={PRIMARY} />
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
        <View style={[s.pickFooter, { borderTopColor: c.border }]}>
          <TouchableOpacity
            style={[s.addBtn, { backgroundColor: PRIMARY }, !sel && { opacity: 0.4 }]}
            disabled={!sel}
            onPress={() => { onAdd(sel!, qty) }}
          >
            <Text style={s.addBtnText}>Agregar · {formatCurrency(price * qty, sign)}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

// ─── ModifierPicker ───────────────────────────────────────────────────────────

function ModifierPicker({ product, onAdd, onClose }: {
  product: Product
  onAdd: (opts: { modifiers: CartModifier[]; quantity: number; notes: string }) => void
  onClose: () => void
}) {
  const c = useAppColors()
  const { tenant } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const sign    = tenant?.currencySign ?? '$'
  const groups  = product.modifierGroups ?? []

  const defaultSelected = useMemo<Record<string, CartModifier[]>>(() => {
    const init: Record<string, CartModifier[]> = {}
    for (const g of groups) {
      const defs = g.modifiers.filter((m) => m.isDefault)
      if (defs.length > 0) {
        init[g.id] = defs.map((m) => ({
          groupId: g.id, groupName: g.name,
          modifierId: m.id, modifierName: m.name,
          priceDelta: parseFloat(m.priceDelta as any) || 0,
        }))
      }
    }
    return init
  }, [product.id])

  const [qty, setQty]     = useState(1)
  const [notes, setNotes] = useState('')
  const [selected, setSel] = useState<Record<string, CartModifier[]>>(defaultSelected)

  function toggle(g: ModifierGroup, modId: string, modName: string, delta: number) {
    setSel((prev) => {
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

  const canAdd = () => groups.every((g) => !g.isRequired || (selected[g.id]?.length ?? 0) >= (g.minSelections || 1))
  const allMods = Object.values(selected).flat()
  const modsDelta = allMods.reduce((sum, m) => sum + m.priceDelta, 0)
  const total = (parseFloat(product.price) + modsDelta) * qty

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[s.pickRoot, { backgroundColor: c.surface }]}>
        <View style={[s.pickHeader, { borderBottomColor: c.border }]}>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color={c.textSecondary} /></TouchableOpacity>
          <Text style={[s.pickTitle, { color: c.text }]} numberOfLines={1}>{product.name}</Text>
          <View style={{ width: 24 }} />
        </View>
        <ScrollView contentContainerStyle={s.pickBody}>
          <View style={s.qtySection}>
            <Text style={[s.groupName, { color: c.text }]}>Cantidad</Text>
            <View style={s.qtyRow}>
              <TouchableOpacity style={[s.qtyBtn, { borderColor: PRIMARY }]} onPress={() => setQty(Math.max(1, qty - 1))}>
                <Ionicons name="remove" size={16} color={PRIMARY} />
              </TouchableOpacity>
              <Text style={[s.qtyNum, { color: c.text }]}>{qty}</Text>
              <TouchableOpacity style={[s.qtyBtn, { borderColor: PRIMARY }]} onPress={() => setQty(qty + 1)}>
                <Ionicons name="add" size={16} color={PRIMARY} />
              </TouchableOpacity>
            </View>
          </View>
          {groups.map((g) => {
            const sel = selected[g.id] ?? []
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
                        onPress={() => toggle(g, mod.id, mod.name, delta)}
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
        </ScrollView>
        <View style={[s.pickFooter, { borderTopColor: c.border }]}>
          <TouchableOpacity
            style={[s.addBtn, { backgroundColor: PRIMARY }, !canAdd() && { opacity: 0.5 }]}
            disabled={!canAdd()}
            onPress={() => { onAdd({ modifiers: allMods, quantity: qty, notes }); onClose() }}
          >
            <Text style={s.addBtnText}>Agregar · {formatCurrency(total, sign)}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

// ─── SimpleQtyPicker (bottom sheet) ──────────────────────────────────────────

function SimpleQtyPicker({ product, onAdd, onClose }: {
  product: Product
  onAdd: (qty: number, notes: string) => void
  onClose: () => void
}) {
  const c = useAppColors()
  const { tenant } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const sign    = tenant?.currencySign ?? '$'
  const [qty, setQty]     = useState(1)
  const [notes, setNotes] = useState('')
  const price = parseFloat(product.price)

  return (
    <View style={s.sheetBackdrop} pointerEvents="box-none">
      <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />
      <View style={[s.sheet, { backgroundColor: c.surface }]}>
        <View style={s.handle} />
        <Text style={[s.sheetName, { color: c.text }]} numberOfLines={2}>{product.name}</Text>
        <Text style={[s.sheetPrice, { color: c.textMuted }]}>{formatCurrency(price, sign)} c/u</Text>
        <View style={s.qtyRow}>
          <TouchableOpacity style={[s.qtyBtn, { borderColor: c.border }]} onPress={() => setQty((q) => Math.max(1, q - 1))}>
            <Ionicons name="remove" size={22} color={c.text} />
          </TouchableOpacity>
          <Text style={[s.qtyNum, { color: c.text }]}>{qty}</Text>
          <TouchableOpacity style={[s.qtyBtn, { borderColor: c.border }]} onPress={() => setQty((q) => q + 1)}>
            <Ionicons name="add" size={22} color={c.text} />
          </TouchableOpacity>
        </View>
        <TextInput
          style={[s.sheetNotesInput, { borderColor: c.border, backgroundColor: c.surfaceAlt, color: c.text }]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Notas (ej: sin azúcar)..."
          placeholderTextColor={c.textMuted}
        />
        <TouchableOpacity style={[s.addBtn, { backgroundColor: PRIMARY }]} onPress={() => onAdd(qty, notes)}>
          <Text style={s.addBtnText}>Agregar {qty > 1 ? `${qty} · ` : ''}{formatCurrency(price * qty, sign)}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ─── ProductRow ───────────────────────────────────────────────────────────────

function ProdRow({ product, onPress }: { product: Product; onPress: () => void }) {
  const c = useAppColors()
  const { tenant } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const sign    = tenant?.currencySign ?? '$'
  const hasFlavors = (product.flavors?.length ?? 0) > 0
  const hasMods    = (product.modifierGroups?.length ?? 0) > 0

  return (
    <TouchableOpacity style={[s.prodRow, { borderBottomColor: c.border, backgroundColor: c.surface }]} onPress={onPress} activeOpacity={0.7}>
      <View style={{ flex: 1 }}>
        <Text style={[s.prodName, { color: c.text }]} numberOfLines={1}>{product.name}</Text>
        {hasFlavors && <Text style={[s.prodSub, { color: c.textMuted }]}>Con sabores</Text>}
        {!hasFlavors && hasMods && <Text style={[s.prodSub, { color: c.textMuted }]}>Personalizable</Text>}
      </View>
      <Text style={[s.prodPrice, { color: PRIMARY }]}>{formatCurrency(parseFloat(product.price), sign)}</Text>
      <View style={[s.prodAddIcon, { backgroundColor: PRIMARY + '18' }]}>
        <Ionicons name="add" size={20} color={PRIMARY} />
      </View>
    </TouchableOpacity>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ProductPickerModal({ visible, onClose, onConfirm, title = 'Agregar productos', confirmLabel = 'Confirmar' }: Props) {
  const c = useAppColors()
  const { tenant } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const sign    = tenant?.currencySign ?? '$'

  const { data: prodsData, isLoading: loadingProds } = useQuery({
    queryKey: ['products'],
    queryFn: () => api.get<{ data: Product[] }>('/api/tenant/products').then((r) => r.data ?? []),
    staleTime: 5 * 60_000, gcTime: 24 * 60 * 60_000,
  })
  const { data: catsData } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ data: Category[] }>('/api/tenant/categories').then((r) => r.data ?? []),
    staleTime: 10 * 60_000, gcTime: 24 * 60 * 60_000,
  })

  const products   = (Array.isArray(prodsData) ? prodsData : []).filter((p) => p.isAvailable)
  const categories = Array.isArray(catsData) ? catsData : []

  const [catId,    setCatId]    = useState<string | null>(null)
  const [search,   setSearch]   = useState('')
  const [staged,   setStaged]   = useState<PickedItem[]>([])
  const [pickerProd, setPicker] = useState<Product | null>(null)
  const [pickerType, setPickerType] = useState<'flavor' | 'modifier' | 'simple' | null>(null)
  const [submitting, setSub]    = useState(false)

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
    setPicker(product)
    if ((product.flavors?.length ?? 0) > 0) setPickerType('flavor')
    else if ((product.modifierGroups?.length ?? 0) > 0) setPickerType('modifier')
    else setPickerType('simple')
  }

  function addToStaged(item: PickedItem) {
    setStaged((prev) => [...prev, item])
    setPicker(null)
    setPickerType(null)
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

  function closePicker() { setPicker(null); setPickerType(null) }

  const showCategories = !isSearch && !catId
  const selectedCat    = catId ? categories.find((c) => c.id === catId) : null
  const stagedTotal    = staged.reduce((sum, i) => {
    const modsDelta = i.modifiers.reduce((ms, m) => ms + m.priceDelta, 0)
    return sum + (i.unitPrice + modsDelta) * i.quantity
  }, 0)

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[s.root, { backgroundColor: c.background }]} edges={['bottom']}>
        {/* Header */}
        <View style={[s.header, { borderBottomColor: c.border }]}>
          <Text style={[s.headerTitle, { color: c.text }]}>{title}</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={c.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Search bar */}
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

        {/* Staged items preview */}
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

        {/* Sub-modals */}
        {pickerProd && pickerType === 'flavor' && (
          <FlavorPicker
            product={pickerProd}
            onAdd={(flavor, qty) => addToStaged({
              productId: pickerProd.id, name: pickerProd.name,
              unitPrice: parseFloat(pickerProd.price), quantity: qty,
              modifiers: [], notes: `Sabor: ${flavor}`,
            })}
            onClose={closePicker}
          />
        )}
        {pickerProd && pickerType === 'modifier' && (
          <ModifierPicker
            product={pickerProd}
            onAdd={({ modifiers, quantity, notes }) => addToStaged({
              productId: pickerProd.id, name: pickerProd.name,
              unitPrice: parseFloat(pickerProd.price), quantity, modifiers, notes,
            })}
            onClose={closePicker}
          />
        )}
        {pickerProd && pickerType === 'simple' && (
          <SimpleQtyPicker
            product={pickerProd}
            onAdd={(qty, notes) => addToStaged({
              productId: pickerProd.id, name: pickerProd.name,
              unitPrice: parseFloat(pickerProd.price), quantity: qty, modifiers: [], notes,
            })}
            onClose={closePicker}
          />
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
  prodAddIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  footer:      { padding: 16, borderTopWidth: 1 },
  confirmBtn:  { borderRadius: 12, padding: 15, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Picker shared styles
  pickRoot:   { flex: 1 },
  pickHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  pickTitle:  { fontSize: 16, fontWeight: '700', flex: 1, textAlign: 'center' },
  pickBody:   { padding: 20, gap: 20 },
  pickFooter: { padding: 20, borderTopWidth: 1 },

  group:       { gap: 10 },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  groupName:   { fontSize: 15, fontWeight: '700' },
  groupHint:   { fontSize: 12 },
  requiredBadge: { backgroundColor: '#fef3c7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  requiredText:  { fontSize: 10, fontWeight: '700', color: '#d97706' },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  modsGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5 },
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

  // Bottom sheet for simple products
  sheetBackdrop: { position: 'absolute', bottom: 0, left: 0, right: 0, top: 0, justifyContent: 'flex-end' },
  sheet:         { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36, gap: 14, shadowOpacity: 0.15, shadowRadius: 20, elevation: 16 },
  handle:        { width: 40, height: 4, borderRadius: 2, backgroundColor: '#d1d5db', alignSelf: 'center', marginBottom: 4 },
  sheetName:     { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  sheetPrice:    { fontSize: 13, textAlign: 'center' },
  sheetNotesInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
  },
})
