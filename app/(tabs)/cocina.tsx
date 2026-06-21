import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, RefreshControl,
} from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { enqueueSync } from '@/lib/offline/sync-queue'
import { useNetworkStatus } from '@/hooks/use-network'
import { ErrorView } from '@/components/ErrorView'
import { useAppColors } from '@/lib/theme'
import type { Order } from '@/types'

// ─── Tarjeta de pedido ────────────────────────────────────────────────────────

function KitchenCard({ order, onUpdate }: { order: Order; onUpdate: () => void }) {
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

  async function advance(status: string) {
    // Optimistic update: preparing changes the dot color; ready removes the card
    qc.setQueryData<Order[]>(['kitchen'], (old = []) =>
      status === 'ready'
        ? old.filter((o) => o.id !== order.id)
        : old.map((o) => o.id === order.id ? { ...o, status: status as Order['status'] } : o)
    )
    try {
      await api.patch(`/api/tenant/orders/${order.id}`, { status })
      onUpdate()
    } catch (err: any) {
      // Rollback
      qc.invalidateQueries({ queryKey: ['kitchen'] })
      const isNetErr = !isConnected || err?.message?.includes('Network request failed')
      if (isNetErr) {
        enqueueSync('update_order_status', { orderId: order.id, status })
        Alert.alert('Sin conexión', 'El cambio se sincronizará al reconectar.')
      } else {
        Alert.alert('Error', err.message)
      }
    }
  }

  return (
    <View style={[styles.card, isUrgent && styles.cardUrgent]}>
      {/* Cabecera */}
      <View style={styles.cardTop}>
        <View>
          <Text style={styles.cardId}>{order.displayCode ?? '#' + order.id.slice(-6).toUpperCase()}</Text>
          {order.tableName    && <Text style={styles.cardSub}>Mesa {order.tableName}</Text>}
          {order.customerName && <Text style={styles.cardSub}>{order.customerName}</Text>}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <View style={[styles.dot, isSent ? styles.dotSent : styles.dotPreparing]} />
          {timeRef && <Text style={styles.cardTime}>{formatDateTime(timeRef)}</Text>}
          {elapsedMin !== null && (
            <Text style={[styles.elapsed, isUrgent && styles.elapsedUrgent]}>
              {elapsedMin} min
            </Text>
          )}
        </View>
      </View>

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
    </View>
  )
}

// ─── Pantalla principal ───────────────────────────────────────────────────────

export default function CocinaScreen() {
  const qc = useQueryClient()
  const { tenant } = useAuthStore()
  const c = useAppColors()
  const styles = makeStyles(c)
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'

  const { data, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ['kitchen'],
    queryFn: () => api.get<{ data: Order[] }>('/api/tenant/kitchen').then((r) => r.data ?? []),
    refetchInterval: 5_000,
  })

  const orders   = data ?? []
  const sent     = orders.filter((o) => o.status === 'sent')
  const preparing = orders.filter((o) => o.status === 'preparing')
  const all      = [...sent, ...preparing]

  function onUpdate() {
    qc.invalidateQueries({ queryKey: ['kitchen'] })
    qc.invalidateQueries({ queryKey: ['orders'] })
    refetch()
  }

  if (isLoading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={PRIMARY} /></View>
  }

  if (isError) {
    return <ErrorView message="No se pudieron cargar los pedidos de cocina." onRetry={refetch} />
  }

  return (
    <View style={styles.root}>
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
        renderItem={({ item }) => <KitchenCard order={item} onUpdate={onUpdate} />}
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
    </View>
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
      borderLeftWidth: 4, borderLeftColor: '#f59e0b',
    },
    cardUrgent: { borderLeftColor: '#ef4444' },

    cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
    cardId:  { fontSize: 18, fontWeight: '800', color: c.text },
    cardSub: { fontSize: 13, color: c.textMuted, marginTop: 2 },
    cardTime: { fontSize: 11, color: c.textMuted, marginTop: 2 },
    elapsed: { fontSize: 13, fontWeight: '600', color: c.textMuted, marginTop: 2 },
    elapsedUrgent: { color: '#ef4444' },

    dot: { width: 10, height: 10, borderRadius: 5 },
    dotSent:      { backgroundColor: '#f59e0b' },
    dotPreparing: { backgroundColor: '#f97316' },

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
