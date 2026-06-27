import { useEffect } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Switch, Alert, ActivityIndicator, RefreshControl } from 'react-native'
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

function ProductRow({ product, categories, primary, sign, onToggle, c }: {
  product: Product
  categories: Category[]
  primary: string
  sign: string
  onToggle: () => void
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
        </Text>
      </View>
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
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const c = useAppColors()
  const s = makeStyles(c)

  useEffect(() => {
    if (user && !['admin', 'cajero'].includes(user.role)) router.back()
  }, [user?.role])

  if (user && !['admin', 'cajero'].includes(user.role)) return null

  const sign    = tenant?.currencySign ?? '$'

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

      <FlatList
        data={products}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <ProductRow product={item} categories={categories} primary={PRIMARY} sign={sign} onToggle={onToggle} c={c} />
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
    </SafeAreaView>
  )
}

function makeStyles(c: ReturnType<typeof import('@/lib/theme').useAppColors>) {
  return StyleSheet.create({
    root:     { flex: 1, backgroundColor: c.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
    emptyText:{ color: c.textMuted, fontSize: 14 },

    topBar: {
      flexDirection: 'row', gap: 20, paddingHorizontal: 16, paddingVertical: 12,
      backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.surfaceAlt,
    },
    counter:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot:        { width: 10, height: 10, borderRadius: 5 },
    counterText:{ fontSize: 13, color: c.textSecondary },

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
  })
}
