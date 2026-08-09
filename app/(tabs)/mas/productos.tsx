import { useState, useEffect } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Switch, Alert, ActivityIndicator,
  RefreshControl, Modal, TextInput, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useNetworkStatus } from '@/hooks/use-network'
import { enqueueSync } from '@/lib/offline/sync-queue'
import { useAppColors } from '@/lib/theme'
import type { Product, Category } from '@/types'

function ProductRow({ product, categories, primary, sign, onToggle, onEdit, c }: {
  product: Product
  categories: Category[]
  primary: string
  sign: string
  onToggle: () => void
  onEdit: (p: Product) => void
  c: ReturnType<typeof import('@/lib/theme').useAppColors>
}) {
  const cat = categories.find((cat) => cat.id === product.categoryId)
  const { isConnected } = useNetworkStatus()

  async function toggle(value: boolean) {
    try {
      await api.patch(`/api/tenant/products/${product.id}`, { isAvailable: value })
      onToggle()
    } catch (err: any) {
      const isNetErr = !isConnected || err?.message?.includes('Network request failed')
      if (isNetErr) {
        enqueueSync('toggle_product', { productId: product.id, isAvailable: value })
        Alert.alert('Sin conexión', 'El cambio se sincronizará al reconectar.')
      } else {
        Alert.alert('Error', err.message)
      }
    }
  }

  const s = makeStyles(c)

  return (
    <View style={[s.row, !product.isAvailable && s.rowInactive]}>
      <View style={s.rowIcon}>
        <Ionicons name="fast-food-outline" size={20} color={product.isAvailable ? primary : c.textMuted} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.productName, !product.isAvailable && s.textInactive]}>
          {product.name}
        </Text>
        <Text style={s.productSub}>
          {cat ? `${cat.emoji ? cat.emoji + ' ' : ''}${cat.name}` : 'Sin categoría'}
          {'  ·  '}{formatCurrency(parseFloat(product.price), sign)}
          {(product.flavors?.length ?? 0) > 0 ? `  ·  ${product.flavors.length} sabor${product.flavors.length > 1 ? 'es' : ''}` : ''}
        </Text>
      </View>
      <TouchableOpacity onPress={() => onEdit(product)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginRight: 8 }}>
        <Ionicons name="pencil-outline" size={16} color={c.textMuted} />
      </TouchableOpacity>
      <Switch
        value={product.isAvailable}
        onValueChange={toggle}
        trackColor={{ false: c.border, true: primary + '60' }}
        thumbColor={product.isAvailable ? primary : c.textMuted}
      />
    </View>
  )
}

export default function ProductosScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const { tenant, user } = useAuthStore()
  const { isConnected } = useNetworkStatus()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const sign    = tenant?.currencySign ?? '$'
  const c = useAppColors()
  const s = makeStyles(c)

  // Modal state
  const [showNewProd,  setShowNewProd]  = useState(false)
  const [showNewCat,   setShowNewCat]   = useState(false)
  const [showEditProd, setShowEditProd] = useState(false)
  const [editingProd,  setEditingProd]  = useState<Product | null>(null)
  const [prodForm, setProdForm]   = useState({ name: '', price: '', categoryId: '', isAvailable: true, flavors: [] as string[] })
  const [editForm, setEditForm]   = useState({ name: '', price: '', categoryId: '', isAvailable: true, flavors: [] as string[] })
  const [catForm,  setCatForm]    = useState({ name: '', emoji: '' })
  const [creating, setCreating]   = useState(false)
  const [updating, setUpdating]   = useState(false)
  const [newFlavor,     setNewFlavor]     = useState('')
  const [newFlavorEdit, setNewFlavorEdit] = useState('')

  function openEdit(p: Product) {
    setEditingProd(p)
    setEditForm({
      name:        p.name,
      price:       p.price,
      categoryId:  p.categoryId,
      isAvailable: p.isAvailable,
      flavors:     p.flavors ?? [],
    })
    setNewFlavorEdit('')
    setShowEditProd(true)
  }

  async function updateProduct() {
    const priceNum = parseFloat(editForm.price)
    if (!editForm.name.trim())           { Alert.alert('Error', 'El nombre es requerido'); return }
    if (isNaN(priceNum) || priceNum < 0) { Alert.alert('Error', 'Precio inválido'); return }
    if (!editForm.categoryId)            { Alert.alert('Error', 'Selecciona una categoría'); return }
    if (!isConnected)                    { Alert.alert('Sin conexión', 'Se requiere conexión para editar productos'); return }
    setUpdating(true)
    try {
      await api.patch(`/api/tenant/products/${editingProd!.id}`, {
        name:        editForm.name.trim(),
        price:       priceNum.toFixed(2),
        categoryId:  editForm.categoryId,
        isAvailable: editForm.isAvailable,
        flavors:     editForm.flavors,
      })
      qc.invalidateQueries({ queryKey: ['products-mgmt'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      setShowEditProd(false)
      Alert.alert('Guardado', 'Producto actualizado correctamente.')
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'No se pudo actualizar')
    } finally { setUpdating(false) }
  }

  useEffect(() => {
    if (user && !['admin', 'cajero'].includes(user.role)) router.back()
  }, [user?.role])

  if (user && !['admin', 'cajero'].includes(user.role)) return null

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['products-mgmt'],
    queryFn: async () => {
      const [prods, cats] = await Promise.all([
        api.get<{ data: Product[] }>('/api/tenant/products?showAll=true').then((r) => r.data ?? []),
        api.get<{ data: Category[] }>('/api/tenant/categories').then((r) => r.data ?? []),
      ])
      return { products: prods, categories: cats }
    },
  })

  const products   = data?.products   ?? []
  const categories = data?.categories ?? []

  const available   = products.filter((p) => p.isAvailable).length
  const unavailable = products.length - available

  function onToggle() {
    qc.invalidateQueries({ queryKey: ['products-mgmt'] })
    qc.invalidateQueries({ queryKey: ['products'] })
    refetch()
  }

  async function createProduct() {
    const priceNum = parseFloat(prodForm.price)
    if (!prodForm.name.trim())          { Alert.alert('Error', 'El nombre es requerido'); return }
    if (isNaN(priceNum) || priceNum < 0){ Alert.alert('Error', 'Precio inválido'); return }
    if (!prodForm.categoryId)           { Alert.alert('Error', 'Selecciona una categoría'); return }
    if (!isConnected)                   { Alert.alert('Sin conexión', 'Se requiere conexión para crear productos'); return }
    setCreating(true)
    try {
      await api.post('/api/tenant/products', {
        name:        prodForm.name.trim(),
        price:       priceNum.toFixed(2),
        categoryId:  prodForm.categoryId,
        isAvailable: prodForm.isAvailable,
        flavors:     prodForm.flavors,
      })
      qc.invalidateQueries({ queryKey: ['products-mgmt'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      setShowNewProd(false)
      setProdForm({ name: '', price: '', categoryId: '', isAvailable: true, flavors: [] })
      setNewFlavor('')
      Alert.alert('Creado', 'Producto creado correctamente.')
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'No se pudo crear el producto')
    } finally { setCreating(false) }
  }

  async function createCategory() {
    if (!catForm.name.trim()) { Alert.alert('Error', 'El nombre es requerido'); return }
    if (!isConnected)         { Alert.alert('Sin conexión', 'Se requiere conexión para crear categorías'); return }
    setCreating(true)
    try {
      await api.post('/api/tenant/categories', {
        name:  catForm.name.trim(),
        ...(catForm.emoji.trim() ? { emoji: catForm.emoji.trim() } : {}),
      })
      qc.invalidateQueries({ queryKey: ['products-mgmt'] })
      setShowNewCat(false)
      setCatForm({ name: '', emoji: '' })
      Alert.alert('Creada', 'Categoría creada correctamente.')
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'No se pudo crear la categoría')
    } finally { setCreating(false) }
  }

  if (isLoading) {
    return <View style={s.centered}><ActivityIndicator size="large" color={PRIMARY} /></View>
  }

  return (
    <SafeAreaView style={s.root} edges={['bottom']}>
      {/* Stats bar */}
      <View style={s.topBar}>
        <View style={s.counter}>
          <View style={[s.dot, { backgroundColor: PRIMARY }]} />
          <Text style={s.counterText}>Disponibles: <Text style={{ fontWeight: '700' }}>{available}</Text></Text>
        </View>
        <View style={s.counter}>
          <View style={[s.dot, { backgroundColor: c.textMuted }]} />
          <Text style={s.counterText}>Pausados: <Text style={{ fontWeight: '700' }}>{unavailable}</Text></Text>
        </View>
      </View>

      {/* Action bar */}
      <View style={[s.actionBar, { borderBottomColor: c.border, backgroundColor: c.surface }]}>
        <TouchableOpacity
          style={[s.actionBtn, { borderColor: PRIMARY, borderWidth: 1 }]}
          onPress={() => setShowNewCat(true)}
          disabled={!isConnected}
        >
          <Ionicons name="folder-open-outline" size={14} color={isConnected ? PRIMARY : c.textMuted} />
          <Text style={[s.actionBtnText, { color: isConnected ? PRIMARY : c.textMuted }]}>+ Categoría</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.actionBtn, { backgroundColor: isConnected ? PRIMARY : c.textMuted }]}
          onPress={() => setShowNewProd(true)}
          disabled={!isConnected}
        >
          <Ionicons name="add-circle-outline" size={14} color="#fff" />
          <Text style={[s.actionBtnText, { color: '#fff' }]}>+ Producto</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={products}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <ProductRow product={item} categories={categories} primary={PRIMARY} sign={sign} onToggle={onToggle} onEdit={openEdit} c={c} />
        )}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={PRIMARY} />}
        ListEmptyComponent={
          <View style={s.centered}>
            <Ionicons name="fast-food-outline" size={48} color={c.border} />
            <Text style={s.emptyText}>Sin productos</Text>
          </View>
        }
      />

      {/* ── Modal: Editar producto ── */}
      <Modal visible={showEditProd} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowEditProd(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[s.modalHeader, { borderBottomColor: c.border }]}>
              <Text style={[s.modalTitle, { color: c.text }]}>Editar producto</Text>
              <TouchableOpacity onPress={() => setShowEditProd(false)}>
                <Ionicons name="close" size={24} color={c.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={s.modalBody} keyboardShouldPersistTaps="handled">
              <Text style={[s.fieldLabel, { color: c.textSecondary }]}>Nombre *</Text>
              <TextInput
                style={[s.fieldInput, { color: c.text, borderColor: c.border, backgroundColor: c.surfaceAlt }]}
                placeholder="Ej: Café americano"
                placeholderTextColor={c.textMuted}
                value={editForm.name}
                onChangeText={(v) => setEditForm((f) => ({ ...f, name: v }))}
                autoFocus
              />
              <Text style={[s.fieldLabel, { color: c.textSecondary, marginTop: 16 }]}>Precio *</Text>
              <TextInput
                style={[s.fieldInput, { color: c.text, borderColor: c.border, backgroundColor: c.surfaceAlt }]}
                placeholder="Ej: 5000"
                placeholderTextColor={c.textMuted}
                value={editForm.price}
                onChangeText={(v) => setEditForm((f) => ({ ...f, price: v }))}
                keyboardType="numeric"
              />
              <Text style={[s.fieldLabel, { color: c.textSecondary, marginTop: 16 }]}>Categoría *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                {categories.map((cat) => {
                  const sel = editForm.categoryId === cat.id
                  return (
                    <TouchableOpacity
                      key={cat.id}
                      style={[s.catChip, { borderColor: sel ? PRIMARY : c.border, backgroundColor: sel ? PRIMARY : c.surfaceAlt }]}
                      onPress={() => setEditForm((f) => ({ ...f, categoryId: cat.id }))}
                    >
                      <Text style={[s.catChipText, { color: sel ? '#fff' : c.textSecondary }]}>
                        {cat.emoji ? cat.emoji + ' ' : ''}{cat.name}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>
              <View style={[s.switchRow, { marginTop: 20 }]}>
                <Text style={[s.fieldLabel, { color: c.textSecondary }]}>Disponible</Text>
                <Switch
                  value={editForm.isAvailable}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, isAvailable: v }))}
                  trackColor={{ false: c.border, true: PRIMARY + '88' }}
                  thumbColor={editForm.isAvailable ? PRIMARY : c.textMuted}
                />
              </View>
              {/* Sabores */}
              <Text style={[s.fieldLabel, { color: c.textSecondary, marginTop: 20 }]}>Sabores (opcional)</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={[s.fieldInput, { color: c.text, borderColor: c.border, backgroundColor: c.surfaceAlt, flex: 1 }]}
                  placeholder="Ej: Fresa"
                  placeholderTextColor={c.textMuted}
                  value={newFlavorEdit}
                  onChangeText={setNewFlavorEdit}
                  onSubmitEditing={() => {
                    const t = newFlavorEdit.trim()
                    if (t && !editForm.flavors.includes(t)) {
                      setEditForm((f) => ({ ...f, flavors: [...f.flavors, t] }))
                      setNewFlavorEdit('')
                    }
                  }}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  style={[s.saveBtn, { backgroundColor: PRIMARY, paddingHorizontal: 16, paddingVertical: 10, marginTop: 0 }]}
                  onPress={() => {
                    const t = newFlavorEdit.trim()
                    if (t && !editForm.flavors.includes(t)) {
                      setEditForm((f) => ({ ...f, flavors: [...f.flavors, t] }))
                      setNewFlavorEdit('')
                    }
                  }}
                >
                  <Ionicons name="add" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
              {editForm.flavors.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {editForm.flavors.map((fl) => (
                    <TouchableOpacity
                      key={fl}
                      style={[s.catChip, { borderColor: PRIMARY, backgroundColor: PRIMARY + '18', flexDirection: 'row', alignItems: 'center', gap: 4 }]}
                      onPress={() => setEditForm((f) => ({ ...f, flavors: f.flavors.filter((x) => x !== fl) }))}
                    >
                      <Text style={[s.catChipText, { color: PRIMARY }]}>{fl}</Text>
                      <Ionicons name="close" size={12} color={PRIMARY} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <TouchableOpacity
                style={[s.saveBtn, { backgroundColor: PRIMARY, marginTop: 24 }, updating && { opacity: 0.6 }]}
                onPress={updateProduct}
                disabled={updating}
              >
                {updating
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.saveBtnText}>Guardar cambios</Text>}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── Modal: Nueva categoría ── */}
      <Modal visible={showNewCat} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowNewCat(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[s.modalHeader, { borderBottomColor: c.border }]}>
              <Text style={[s.modalTitle, { color: c.text }]}>Nueva categoría</Text>
              <TouchableOpacity onPress={() => setShowNewCat(false)}>
                <Ionicons name="close" size={24} color={c.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={s.modalBody}>
              <Text style={[s.fieldLabel, { color: c.textSecondary }]}>Nombre *</Text>
              <TextInput
                style={[s.fieldInput, { color: c.text, borderColor: c.border, backgroundColor: c.surfaceAlt }]}
                placeholder="Ej: Bebidas, Comidas rápidas..."
                placeholderTextColor={c.textMuted}
                value={catForm.name}
                onChangeText={(v) => setCatForm((f) => ({ ...f, name: v }))}
                autoFocus
              />
              <Text style={[s.fieldLabel, { color: c.textSecondary, marginTop: 16 }]}>Emoji (opcional)</Text>
              <TextInput
                style={[s.fieldInput, { color: c.text, borderColor: c.border, backgroundColor: c.surfaceAlt, width: 80 }]}
                placeholder="🍔"
                placeholderTextColor={c.textMuted}
                value={catForm.emoji}
                onChangeText={(v) => setCatForm((f) => ({ ...f, emoji: v }))}
              />
              <TouchableOpacity
                style={[s.saveBtn, { backgroundColor: PRIMARY, marginTop: 32 }, creating && { opacity: 0.6 }]}
                onPress={createCategory}
                disabled={creating}
              >
                {creating
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.saveBtnText}>Crear categoría</Text>}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── Modal: Nuevo producto ── */}
      <Modal visible={showNewProd} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowNewProd(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[s.modalHeader, { borderBottomColor: c.border }]}>
              <Text style={[s.modalTitle, { color: c.text }]}>Nuevo producto</Text>
              <TouchableOpacity onPress={() => setShowNewProd(false)}>
                <Ionicons name="close" size={24} color={c.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={s.modalBody}>
              <Text style={[s.fieldLabel, { color: c.textSecondary }]}>Nombre *</Text>
              <TextInput
                style={[s.fieldInput, { color: c.text, borderColor: c.border, backgroundColor: c.surfaceAlt }]}
                placeholder="Ej: Café americano"
                placeholderTextColor={c.textMuted}
                value={prodForm.name}
                onChangeText={(v) => setProdForm((f) => ({ ...f, name: v }))}
                autoFocus
              />

              <Text style={[s.fieldLabel, { color: c.textSecondary, marginTop: 16 }]}>Precio *</Text>
              <TextInput
                style={[s.fieldInput, { color: c.text, borderColor: c.border, backgroundColor: c.surfaceAlt }]}
                placeholder={`Ej: 5000`}
                placeholderTextColor={c.textMuted}
                value={prodForm.price}
                onChangeText={(v) => setProdForm((f) => ({ ...f, price: v }))}
                keyboardType="numeric"
              />

              <Text style={[s.fieldLabel, { color: c.textSecondary, marginTop: 16 }]}>Categoría *</Text>
              {categories.length === 0 ? (
                <Text style={{ color: c.textMuted, fontSize: 13 }}>
                  No hay categorías. Crea una primero.
                </Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                  {categories.map((cat) => {
                    const sel = prodForm.categoryId === cat.id
                    return (
                      <TouchableOpacity
                        key={cat.id}
                        style={[
                          s.catChip,
                          { borderColor: sel ? PRIMARY : c.border, backgroundColor: sel ? PRIMARY : c.surfaceAlt },
                        ]}
                        onPress={() => setProdForm((f) => ({ ...f, categoryId: cat.id }))}
                      >
                        <Text style={[s.catChipText, { color: sel ? '#fff' : c.textSecondary }]}>
                          {cat.emoji ? cat.emoji + ' ' : ''}{cat.name}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </ScrollView>
              )}

              <View style={[s.switchRow, { marginTop: 20 }]}>
                <Text style={[s.fieldLabel, { color: c.textSecondary }]}>Disponible al crear</Text>
                <Switch
                  value={prodForm.isAvailable}
                  onValueChange={(v) => setProdForm((f) => ({ ...f, isAvailable: v }))}
                  trackColor={{ false: c.border, true: PRIMARY + '88' }}
                  thumbColor={prodForm.isAvailable ? PRIMARY : c.textMuted}
                />
              </View>

              {/* Sabores */}
              <Text style={[s.fieldLabel, { color: c.textSecondary, marginTop: 20 }]}>Sabores (opcional)</Text>
              <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 8 }}>
                Si este producto tiene sabores, agrégalos aquí. Se pedirá al cajero elegir uno.
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={[s.fieldInput, { color: c.text, borderColor: c.border, backgroundColor: c.surfaceAlt, flex: 1 }]}
                  placeholder="Ej: Fresa"
                  placeholderTextColor={c.textMuted}
                  value={newFlavor}
                  onChangeText={setNewFlavor}
                  onSubmitEditing={() => {
                    const t = newFlavor.trim()
                    if (t && !prodForm.flavors.includes(t)) {
                      setProdForm((f) => ({ ...f, flavors: [...f.flavors, t] }))
                      setNewFlavor('')
                    }
                  }}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  style={[s.saveBtn, { backgroundColor: PRIMARY, paddingHorizontal: 16, paddingVertical: 10, marginTop: 0 }]}
                  onPress={() => {
                    const t = newFlavor.trim()
                    if (t && !prodForm.flavors.includes(t)) {
                      setProdForm((f) => ({ ...f, flavors: [...f.flavors, t] }))
                      setNewFlavor('')
                    }
                  }}
                >
                  <Ionicons name="add" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
              {prodForm.flavors.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {prodForm.flavors.map((fl) => (
                    <TouchableOpacity
                      key={fl}
                      style={[s.catChip, { borderColor: PRIMARY, backgroundColor: PRIMARY + '18', flexDirection: 'row', alignItems: 'center', gap: 4 }]}
                      onPress={() => setProdForm((f) => ({ ...f, flavors: f.flavors.filter((x) => x !== fl) }))}
                    >
                      <Text style={[s.catChipText, { color: PRIMARY }]}>{fl}</Text>
                      <Ionicons name="close" size={12} color={PRIMARY} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <TouchableOpacity
                style={[s.saveBtn, { backgroundColor: PRIMARY, marginTop: 24 }, creating && { opacity: 0.6 }]}
                onPress={createProduct}
                disabled={creating}
              >
                {creating
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.saveBtnText}>Crear producto</Text>}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

function makeStyles(c: ReturnType<typeof import('@/lib/theme').useAppColors>) {
  return StyleSheet.create({
    root:     { flex: 1, backgroundColor: c.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
    emptyText:{ color: c.textMuted, fontSize: 14 },

    topBar: {
      flexDirection: 'row', gap: 20, paddingHorizontal: 16, paddingVertical: 10,
      backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.surfaceAlt,
    },
    counter:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot:        { width: 10, height: 10, borderRadius: 5 },
    counterText:{ fontSize: 13, color: c.textSecondary },

    actionBar: {
      flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 8,
      borderBottomWidth: 1,
    },
    actionBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 8, paddingVertical: 8 },
    actionBtnText: { fontSize: 13, fontWeight: '600' },

    list: { paddingBottom: 32 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: c.surface, paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: c.background,
    },
    rowInactive:  { backgroundColor: c.surfaceAlt, opacity: 0.65 },
    rowIcon: {
      width: 40, height: 40, borderRadius: 10,
      backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center',
    },
    productName:  { fontSize: 15, fontWeight: '600', color: c.text },
    productSub:   { fontSize: 12, color: c.textMuted, marginTop: 2 },
    textInactive: { color: c.textMuted },

    modalHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1,
    },
    modalTitle: { fontSize: 18, fontWeight: '700' },
    modalBody:  { padding: 20 },

    fieldLabel: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
    fieldInput: {
      borderWidth: 1, borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: 10,
      fontSize: 15,
    },

    catChip:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
    catChipText: { fontSize: 13, fontWeight: '500' },

    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

    saveBtn:     { borderRadius: 12, padding: 16, alignItems: 'center' },
    saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  })
}
