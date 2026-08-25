import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, RefreshControl, Animated, Vibration,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '@/lib/api'
import { playBeep } from '@/lib/beep'
import { formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { enqueueSync } from '@/lib/offline/sync-queue'
import { saveKitchenOrdersToCache, getKitchenOrdersFromCache, updateOrderStatusInCache, upsertOrderInCache, removeOrderFromCache } from '@/lib/offline/cache'
import { useNetworkStatus } from '@/hooks/use-network'
import { ErrorView } from '@/components/ErrorView'
import { useAppColors } from '@/lib/theme'
import type { Order } from '@/types'
import { useRef, useEffect } from 'react'

// ─── Tarjeta de pedido ────────────────────────────────────────────────────────

function KitchenCard({ order, onUpdate, alertMinutes }: { order: Order; onUpdate: () => void; alertMinutes: number }) {
  const { tenant } = useAuthStore()
  const { isConnected } = useNetworkStatus()
  const qc = useQueryClient()
  const c = useAppColors()
  const styles = makeStyles(c)
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const isSent      = order.status === 'sent'
  const isPreparing = order.status === 'preparing'

  const timeRef = order.createdAt
  const elapsedMin = timeRef
    ? Math.floor((Date.now() - new Date(timeRef).getTime()) / 60_000)
    : null

  const isUrgent = elapsedMin !== null && elapsedMin >= 15
  const isLate   = (isSent || isPreparing) && alertMinutes > 0 && elapsedMin !== null && elapsedMin >= alertMinutes

  const blinkAnim = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (!isLate) { blinkAnim.setValue(1); return }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blinkAnim, { toValue: 0,  duration: 400, useNativeDriver: true }),
        Animated.timing(blinkAnim, { toValue: 1,  duration: 400, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [isLate])

  const wasLate = useRef(false)
  useEffect(() => {
    if (isLate && !wasLate.current) {
      playBeep()
      Vibration.vibrate([0, 300, 200, 300])
      wasLate.current = true
    }
    if (!isLate) wasLate.current = false
  }, [isLate])

  async function advance(status: string) {
    // Optimistic update TanStack Query
    qc.setQueryData<Order[]>(['kitchen'], (old = []) =>
      status === 'ready'
        ? old.filter((o) => o.id !== order.id)
        : old.map((o) => o.id === order.id ? { ...o, status: status as Order['status'] } : o)
    )
    // Optimistic update SQLite
    if (status === 'ready') {
      removeOrderFromCache(order.id)
    } else {
      updateOrderStatusInCache(order.id, status as Order['status'])
    }

    try {
      await api.patch(`/api/tenant/orders/${order.id}`, { status })
      onUpdate()
    } catch (err: any) {
      const isNetErr = !isConnected || (err as any)?.status === 0 || err?.message?.includes('Network request failed')
      if (isNetErr) {
        enqueueSync('update_order_status', { orderId: order.id, status })
        // Mantener cambios optimistas (TQ + SQLite) — OfflineBanner muestra el estado
      } else {
        // Error de servidor: revertir ambos
        qc.setQueryData<Order[]>(['kitchen'], (old = []) =>
          status === 'ready'
            ? [...(old ?? []), order]
            : (old ?? []).map((o) => o.id === order.id ? order : o)
        )
        upsertOrderInCache(order)
        Alert.alert('Error', err.message)
      }
    }
  }

  return (
    <Animated.View style={[styles.card, isPreparing && styles.cardPreparing, isUrgent && styles.cardUrgent, isLate && styles.cardLate, { opacity: isLate ? blinkAnim : 1 }]}>
      {/* Cabecera */}
      {isLate && (
        <View style={styles.lateBar}>
          <Text style={styles.lateText}>⚠ DEMORADO — {elapsedMin} min en preparación</Text>
        </View>
      )}
      <View style={styles.cardTop}>
        <View>
          <Text style={styles.cardId}>{order.displayCode ?? '#' + order.id.slice(-6).toUpperCase()}</Text>
          {order.customerName && <Text style={styles.cardSub}>{order.customerName}</Text>}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <View style={[styles.dot, isSent ? styles.dotSent : styles.dotPreparing]} />
          {elapsedMin !== null && (
            <Text style={[styles.elapsed, isUrgent && styles.elapsedUrgent]}>
              {elapsedMin} min
            </Text>
          )}
        </View>
      </View>

      {/* Nota del pedido */}
      {order.notes ? (
        <View style={styles.orderNotes}>
          <Text style={styles.orderNotesText}>📝 {order.notes}</Text>
        </View>
      ) : null}

      {/* Productos */}
      <View style={styles.itemList}>
        {(order.items ?? []).map((item) => {
          const name = (item.productSnapshot as any)?.name ?? 'Producto'
          return (
            <View key={item.id} style={styles.itemRow}>
              <Text style={[styles.itemQty, { color: PRIMARY }]}>{item.quantity}×</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{name}</Text>
                {Array.isArray(item.modifierSnapshot) && item.modifierSnapshot.length > 0 && (
                  <Text style={styles.itemMods}>
                    {(item.modifierSnapshot as any[]).map((m) => m.modifierName).join(' · ')}
                  </Text>
                )}
                {item.notes ? <Text style={styles.itemNotes}>⚠ {item.notes}</Text> : null}
              </View>
            </View>
          )
        })}
      </View>

      {/* Acciones */}
      <View style={styles.cardActions}>
        {isSent && (
          <TouchableOpacity style={[styles.actionBtn, styles.btnPrepare]} onPress={() => advance('preparing')}>
            <Ionicons name="flame-outline" size={16} color="#fff" />
            <Text style={styles.actionBtnText}>Preparar</Text>
          </TouchableOpacity>
        )}
        {isPreparing && (
          <TouchableOpacity style={[styles.actionBtn, styles.btnReady]} onPress={() => advance('ready')}>
            <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
            <Text style={styles.actionBtnText}>Listo</Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  )
}

// ─── Pantalla principal ───────────────────────────────────────────────────────

export default function CocinaScreen() {
  const qc = useQueryClient()
  const { tenant, config } = useAuthStore()
  const c = useAppColors()
  const styles = makeStyles(c)
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const alertMinutes = config?.kitchenAlertMinutes ?? 0

  const { data, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ['kitchen'],
    queryFn: async () => {
      try {
        const orders = await api.get<{ data: Order[] }>('/api/tenant/kitchen').then((r) => r.data ?? [])
        saveKitchenOrdersToCache(orders)
        return orders
      } catch {
        const cached = getKitchenOrdersFromCache()
        if (cached) return cached
        throw new Error('Sin conexión y sin datos guardados')
      }
    },
    initialData: () => getKitchenOrdersFromCache() ?? undefined,
    initialDataUpdatedAt: 0,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  })

  const orders   = data ?? []
  const sent     = orders.filter((o) => o.status === 'sent')
  const preparing = orders.filter((o) => o.status === 'preparing')
  const all      = [...sent, ...preparing]

  // Sonar cuando llegan pedidos nuevos a cocina
  const knownOrderIds = useRef(new Set<string>())
  const initialLoadDone = useRef(false)
  useEffect(() => {
    if (!data) return
    const currentIds = new Set(data.map((o) => o.id))
    if (initialLoadDone.current && [...currentIds].some((id) => !knownOrderIds.current.has(id))) {
      playBeep()
      Vibration.vibrate([0, 200, 100, 200])
    }
    knownOrderIds.current = currentIds
    initialLoadDone.current = true
  }, [data])

  function onUpdate() {
    qc.invalidateQueries({ queryKey: ['kitchen'] })
    qc.invalidateQueries({ queryKey: ['orders'] })
    refetch()
  }

  if (isLoading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={PRIMARY} /></View>
  }

  if (isError && !orders.length) {
    return <ErrorView message="Sin conexión y sin datos guardados. Conecta a internet para continuar." onRetry={refetch} />
  }

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      {/* Barra de contadores */}
      <View style={styles.topBar}>
        <View style={styles.counter}>
          <View style={[styles.dot, styles.dotSent]} />
          <Text style={styles.counterText}>Por preparar: <Text style={{ fontWeight: '700' }}>{sent.length}</Text></Text>
        </View>
        <View style={styles.counter}>
          <View style={[styles.dot, styles.dotPreparing]} />
          <Text style={styles.counterText}>Preparando: <Text style={{ fontWeight: '700' }}>{preparing.length}</Text></Text>
        </View>
      </View>

      <FlatList
        data={all}
        keyExtractor={(o) => o.id}
        renderItem={({ item }) => <KitchenCard order={item} onUpdate={onUpdate} alertMinutes={alertMinutes} />}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={PRIMARY} />}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Ionicons name="checkmark-done-circle-outline" size={60} color={c.borderStrong} />
            <Text style={styles.emptyTitle}>Cocina al día</Text>
            <Text style={styles.emptyText}>No hay pedidos pendientes</Text>
          </View>
        }
      />
    </SafeAreaView>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

function makeStyles(c: ReturnType<typeof useAppColors>) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
    emptyTitle: { fontSize: 16, fontWeight: '700', color: c.textSecondary },
    emptyText: { fontSize: 14, color: c.textMuted },

    topBar: {
      flexDirection: 'row', gap: 20, paddingHorizontal: 16, paddingVertical: 12,
      backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border,
    },
    counter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    counterText: { fontSize: 13, color: c.textSecondary },

    list: { padding: 12, gap: 12, paddingBottom: 32 },

    card: {
      backgroundColor: c.surface, borderRadius: 14, padding: 16,
      shadowColor: c.shadow, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
      borderLeftWidth: 4, borderLeftColor: '#2563eb',
    },
    cardPreparing: { borderLeftColor: '#ea580c' },
    cardUrgent: { borderLeftColor: '#ef4444' },
    cardLate:   { borderLeftColor: '#ef4444', borderWidth: 2, borderColor: '#ef4444' },
    lateBar: {
      backgroundColor: '#fef2f2', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5,
      marginBottom: 10, flexDirection: 'row', alignItems: 'center',
    },
    lateText: { fontSize: 12, fontWeight: '700', color: '#dc2626', flex: 1 },

    cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
    cardId:  { fontSize: 18, fontWeight: '800', color: c.text },
    cardSub: { fontSize: 13, color: c.textMuted, marginTop: 2 },
    cardTime: { fontSize: 11, color: c.textMuted, marginTop: 2 },
    elapsed: { fontSize: 13, fontWeight: '600', color: c.textMuted, marginTop: 2 },
    elapsedUrgent: { color: '#ef4444' },

    dot: { width: 10, height: 10, borderRadius: 5 },
    dotSent:      { backgroundColor: '#2563eb' },
    dotPreparing: { backgroundColor: '#ea580c' },

    orderNotes: {
      backgroundColor: '#fefce8', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6,
      marginBottom: 10,
    },
    orderNotesText: { fontSize: 13, color: '#a16207', fontWeight: '600' },

    itemList: { gap: 8, marginBottom: 14 },
    itemRow:  { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
    itemQty:  { fontSize: 16, fontWeight: '800', minWidth: 30 },
    itemName: { fontSize: 15, fontWeight: '600', color: c.text },
    itemMods: { fontSize: 12, color: c.textMuted, marginTop: 2 },
    itemNotes: { fontSize: 12, color: '#f97316', marginTop: 2, fontWeight: '600' },

    cardActions: { flexDirection: 'row', gap: 10 },
    actionBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center',
      justifyContent: 'center', borderRadius: 10, padding: 12, gap: 6,
    },
    btnPrepare: { backgroundColor: '#f97316' },
    btnReady:   { backgroundColor: '#10b981' },
    actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  })
}
