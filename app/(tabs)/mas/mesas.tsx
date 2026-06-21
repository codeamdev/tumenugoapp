import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, RefreshControl } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useNetworkStatus } from '@/hooks/use-network'
import { enqueueSync } from '@/lib/offline/sync-queue'
import { useAppColors } from '@/lib/theme'
import type { Table } from '@/types'

const STATUS_CONFIG = {
  available: { label: 'Disponible', color: '#10b981', bg: '#ecfdf5', next: 'occupied'  },
  occupied:  { label: 'Ocupada',    color: '#f59e0b', bg: '#fffbeb', next: 'cleaning'  },
  cleaning:  { label: 'Limpiando', color: '#6366f1', bg: '#eef2ff', next: 'available' },
  reserved:  { label: 'Reservada', color: '#64748b', bg: '#f1f5f9', next: 'available' },
} as const

type TableStatus = keyof typeof STATUS_CONFIG

function TableCard({ table, onUpdate, c }: { table: Table; onUpdate: () => void; c: ReturnType<typeof import('@/lib/theme').useAppColors> }) {
  const cfg = STATUS_CONFIG[table.status as TableStatus] ?? STATUS_CONFIG.available
  const { isConnected } = useNetworkStatus()
  const qc = useQueryClient()

  async function cycle() {
    const next = cfg.next
    // Optimistic update
    qc.setQueryData<Table[]>(['tables'], (old = []) =>
      old.map((t) => t.id === table.id ? { ...t, status: next } : t)
    )
    try {
      await api.patch(`/api/tenant/tables/${table.id}`, { status: next })
      onUpdate()
    } catch (err: any) {
      // Rollback
      qc.invalidateQueries({ queryKey: ['tables'] })
      const isNetErr = !isConnected || err?.message?.includes('Network request failed')
      if (isNetErr) {
        enqueueSync('toggle_table_status', { tableId: table.id, status: next })
        Alert.alert('Sin conexión', 'El cambio se sincronizará al reconectar.')
      } else {
        Alert.alert('Error', err.message)
      }
    }
  }

  const s = makeStyles(c)

  return (
    <TouchableOpacity style={[s.card, { borderLeftColor: cfg.color }]} onPress={cycle} activeOpacity={0.75}>
      <View style={{ flex: 1 }}>
        <Text style={s.tableName}>Mesa {table.name}</Text>
        {table.zone ? <Text style={s.tableSub}>{table.zone}</Text> : null}
        {table.capacity ? <Text style={s.tableSub}>{table.capacity} personas</Text> : null}
      </View>
      <View style={[s.badge, { backgroundColor: cfg.bg }]}>
        <Text style={[s.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
      </View>
    </TouchableOpacity>
  )
}

export default function MesasScreen() {
  const qc = useQueryClient()
  const { tenant } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const c = useAppColors()
  const s = makeStyles(c)

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['tables'],
    queryFn: () => api.get<{ data: Table[] }>('/api/tenant/tables').then((r) => r.data ?? []),
    refetchInterval: 30_000,
  })

  const tables = (data ?? []).filter((t) => (t as any).isActive !== false)

  function onUpdate() {
    qc.invalidateQueries({ queryKey: ['tables'] })
    refetch()
  }

  const available = tables.filter((t) => t.status === 'available').length
  const occupied  = tables.filter((t) => t.status === 'occupied').length

  if (isLoading) {
    return <View style={s.centered}><ActivityIndicator size="large" color={PRIMARY} /></View>
  }

  return (
    <View style={s.root}>
      {/* Counters */}
      <View style={s.topBar}>
        <View style={s.counter}>
          <View style={[s.dot, { backgroundColor: '#10b981' }]} />
          <Text style={s.counterText}>Disponibles: <Text style={{ fontWeight: '700' }}>{available}</Text></Text>
        </View>
        <View style={s.counter}>
          <View style={[s.dot, { backgroundColor: '#f59e0b' }]} />
          <Text style={s.counterText}>Ocupadas: <Text style={{ fontWeight: '700' }}>{occupied}</Text></Text>
        </View>
      </View>

      <FlatList
        data={tables}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => <TableCard table={item} onUpdate={onUpdate} c={c} />}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={PRIMARY} />}
        ListEmptyComponent={
          <View style={s.centered}>
            <Ionicons name="grid-outline" size={48} color={c.border} />
            <Text style={s.emptyText}>No hay mesas configuradas</Text>
          </View>
        }
      />
    </View>
  )
}

function makeStyles(c: ReturnType<typeof import('@/lib/theme').useAppColors>) {
  return StyleSheet.create({
    root:    { flex: 1, backgroundColor: c.background },
    centered:{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
    emptyText: { color: c.textMuted, fontSize: 14 },

    topBar: {
      flexDirection: 'row', gap: 20, paddingHorizontal: 16, paddingVertical: 12,
      backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.surfaceAlt,
    },
    counter:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot:         { width: 10, height: 10, borderRadius: 5 },
    counterText: { fontSize: 13, color: c.textSecondary },

    list: { padding: 12, gap: 10, paddingBottom: 32 },
    card: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: c.surface, borderRadius: 12, padding: 16,
      borderLeftWidth: 4,
      shadowColor: c.shadow, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
    },
    tableName: { fontSize: 16, fontWeight: '700', color: c.text },
    tableSub:  { fontSize: 12, color: c.textMuted, marginTop: 2 },
    badge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
    badgeText: { fontSize: 12, fontWeight: '600' },
  })
}
