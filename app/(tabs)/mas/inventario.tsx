import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  RefreshControl, TouchableOpacity,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '@/lib/api'
import { useAppColors } from '@/lib/theme'
import { useAuthStore } from '@/stores/auth-store'
import type { InventoryItem } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr + 'T00:00:00').getTime() - Date.now()) / 86400000)
}

function stockStatus(item: InventoryItem): 'ok' | 'low' | 'out' {
  const s = parseFloat(item.stock ?? '0')
  const m = parseFloat(item.minStock ?? '0')
  if (s <= 0) return 'out'
  if (m > 0 && s <= m) return 'low'
  return 'ok'
}

function fmt(n: string | null | undefined): string {
  if (n == null) return '—'
  const num = parseFloat(n)
  return isNaN(num) ? '—' : num.toLocaleString('es-CO', { maximumFractionDigits: 3 })
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function ItemRow({ item, c }: { item: InventoryItem; c: ReturnType<typeof useAppColors> }) {
  const s      = makeStyles(c)
  const status = stockStatus(item)
  const expiry = item.expiresAt ? daysUntil(item.expiresAt) : null

  const statusColor = status === 'out' ? c.danger : status === 'low' ? c.warning : c.success
  const statusLabel = status === 'out' ? 'Sin stock' : status === 'low' ? 'Stock bajo' : 'OK'
  const statusBg    = status === 'out' ? c.dangerLight : status === 'low' ? c.warningLight : c.successLight

  return (
    <View style={s.row}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={s.itemName} numberOfLines={1}>{item.name}</Text>
        <Text style={s.itemStock}>
          {fmt(item.stock)} {item.unit}
          {parseFloat(item.minStock ?? '0') > 0 && (
            <Text style={s.itemMin}> · mín {fmt(item.minStock)}</Text>
          )}
        </Text>
        {expiry !== null && expiry <= 30 && (
          <Text style={[s.expiryText, { color: expiry < 0 ? c.danger : expiry <= 7 ? c.warning : c.textMuted }]}>
            {expiry < 0 ? 'Vencido' : expiry === 0 ? 'Vence hoy' : `Vence en ${expiry}d`}
          </Text>
        )}
      </View>
      <View style={[s.badge, { backgroundColor: statusBg }]}>
        <Text style={[s.badgeText, { color: statusColor }]}>{statusLabel}</Text>
      </View>
    </View>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function InventarioScreen() {
  const router = useRouter()
  const { user } = useAuthStore()
  const c = useAppColors()
  const s = makeStyles(c)

  const { data, isLoading, isError, refetch, isFetching } = useQuery<InventoryItem[]>({
    queryKey: ['inventory', 'items'],
    queryFn: () => api.get<{ data: InventoryItem[] }>('/api/tenant/inventory/items').then((r) => r.data ?? []),
    staleTime: 60_000,
  })

  const items   = data ?? []
  const alerts  = items.filter((i) => stockStatus(i) !== 'ok')
  const expiring = items.filter((i) => {
    if (!i.expiresAt) return false
    const d = daysUntil(i.expiresAt)
    return d >= 0 && d <= 7
  })

  if (!['admin', 'cajero'].includes(user?.role ?? '')) {
    return (
      <SafeAreaView style={s.root}>
        <View style={s.center}>
          <Text style={s.errorText}>Sin acceso</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </TouchableOpacity>
        <Text style={s.title}>Inventario</Text>
      </View>

      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={c.text} />
        </View>
      ) : isError ? (
        <View style={s.center}>
          <Ionicons name="wifi-outline" size={40} color={c.textMuted} />
          <Text style={s.errorText}>No se pudo cargar</Text>
          <TouchableOpacity onPress={() => refetch()} style={s.retryBtn}>
            <Text style={s.retryText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />}
          contentContainerStyle={s.listContent}
          ListHeaderComponent={
            <>
              {/* Alertas */}
              {(alerts.length > 0 || expiring.length > 0) && (
                <View style={s.alertsRow}>
                  {alerts.length > 0 && (
                    <View style={[s.alertChip, { backgroundColor: c.warningLight }]}>
                      <Ionicons name="warning-outline" size={14} color={c.warning} />
                      <Text style={[s.alertChipText, { color: c.warning }]}>
                        {alerts.length} con stock bajo
                      </Text>
                    </View>
                  )}
                  {expiring.length > 0 && (
                    <View style={[s.alertChip, { backgroundColor: c.dangerLight }]}>
                      <Ionicons name="time-outline" size={14} color={c.danger} />
                      <Text style={[s.alertChipText, { color: c.danger }]}>
                        {expiring.length} vencen pronto
                      </Text>
                    </View>
                  )}
                </View>
              )}
              {/* Contador */}
              <Text style={s.countLabel}>{items.length} insumos</Text>
            </>
          }
          ListEmptyComponent={
            <View style={s.center}>
              <Ionicons name="cube-outline" size={48} color={c.textMuted} />
              <Text style={s.emptyText}>Sin insumos registrados</Text>
            </View>
          }
          renderItem={({ item }) => <ItemRow item={item} c={c} />}
          ItemSeparatorComponent={() => <View style={s.separator} />}
        />
      )}
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(c: ReturnType<typeof useAppColors>) {
  return StyleSheet.create({
    root:     { flex: 1, backgroundColor: c.background },
    center:   { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },

    header: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: c.border,
      backgroundColor: c.surface,
    },
    backBtn:  { padding: 4 },
    title:    { fontSize: 18, fontWeight: '700', color: c.text },

    listContent: { paddingBottom: 32 },

    alertsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16, paddingBottom: 0 },
    alertChip: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
    },
    alertChipText: { fontSize: 12, fontWeight: '600' },

    countLabel: { fontSize: 12, color: c.textMuted, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },

    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 14,
      backgroundColor: c.surface,
    },
    separator: { height: 1, backgroundColor: c.border, marginLeft: 16 },

    itemName:  { fontSize: 15, fontWeight: '600', color: c.text },
    itemStock: { fontSize: 13, color: c.textSecondary },
    itemMin:   { color: c.textMuted },
    expiryText: { fontSize: 12, fontWeight: '500' },

    badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    badgeText: { fontSize: 12, fontWeight: '700' },

    errorText: { fontSize: 15, color: c.textMuted, textAlign: 'center' },
    emptyText: { fontSize: 14, color: c.textMuted },
    retryBtn:  { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, backgroundColor: c.surfaceAlt },
    retryText: { fontSize: 14, fontWeight: '600', color: c.text },
  })
}
