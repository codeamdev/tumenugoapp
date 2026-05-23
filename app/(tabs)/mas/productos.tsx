import { useEffect } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Switch, Alert, ActivityIndicator, RefreshControl } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import type { Product, Category } from '@/types'

function ProductRow({ product, categories, primary, sign, onToggle }: {
  product: Product
  categories: Category[]
  primary: string
  sign: string
  onToggle: () => void
}) {
  const cat = categories.find((c) => c.id === product.categoryId)

  async function toggle(value: boolean) {
    try {
      await api.patch(`/api/tenant/products/${product.id}`, { isAvailable: value })
      onToggle()
    } catch (err: any) {
      Alert.alert('Error', err.message)
    }
  }

  return (
    <View style={[styles.row, !product.isAvailable && styles.rowInactive]}>
      <View style={styles.rowIcon}>
        <Ionicons name="fast-food-outline" size={20} color={product.isAvailable ? primary : '#94a3b8'} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.productName, !product.isAvailable && styles.textInactive]}>
          {product.name}
        </Text>
        <Text style={styles.productSub}>
          {cat ? `${cat.emoji ? cat.emoji + ' ' : ''}${cat.name}` : 'Sin categoría'}
          {'  ·  '}{formatCurrency(parseFloat(product.price), sign)}
        </Text>
      </View>
      <Switch
        value={product.isAvailable}
        onValueChange={toggle}
        trackColor={{ false: '#e5e7eb', true: primary + '60' }}
        thumbColor={product.isAvailable ? primary : '#9ca3af'}
      />
    </View>
  )
}

export default function ProductosScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const { tenant, user } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'

  useEffect(() => {
    if (user && !['admin', 'cajero'].includes(user.role)) router.back()
  }, [user?.role])
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
    return <View style={styles.centered}><ActivityIndicator size="large" color={PRIMARY} /></View>
  }

  return (
    <View style={styles.root}>
      {/* Stats bar */}
      <View style={styles.topBar}>
        <View style={styles.counter}>
          <View style={[styles.dot, { backgroundColor: PRIMARY }]} />
          <Text style={styles.counterText}>Disponibles: <Text style={{ fontWeight: '700' }}>{available}</Text></Text>
        </View>
        <View style={styles.counter}>
          <View style={[styles.dot, { backgroundColor: '#94a3b8' }]} />
          <Text style={styles.counterText}>Pausados: <Text style={{ fontWeight: '700' }}>{unavailable}</Text></Text>
        </View>
      </View>

      <FlatList
        data={products}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <ProductRow product={item} categories={categories} primary={PRIMARY} sign={sign} onToggle={onToggle} />
        )}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={PRIMARY} />}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Ionicons name="fast-food-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyText}>Sin productos</Text>
          </View>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: '#f8fafc' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  emptyText:{ color: '#9ca3af', fontSize: 14 },

  topBar: {
    flexDirection: 'row', gap: 20, paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  counter:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot:        { width: 10, height: 10, borderRadius: 5 },
  counterText:{ fontSize: 13, color: '#374151' },

  list: { paddingBottom: 32 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#f8fafc',
  },
  rowInactive:  { backgroundColor: '#fafafa' },
  rowIcon: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center',
  },
  productName:  { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  productSub:   { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  textInactive: { color: '#94a3b8' },
})
