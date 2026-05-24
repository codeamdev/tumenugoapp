import { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

type Range = 'today' | '7d' | '30d'

const RANGES: { key: Range; label: string }[] = [
  { key: 'today', label: 'Hoy' },
  { key: '7d',   label: '7 días' },
  { key: '30d',  label: '30 días' },
]

function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getFromTo(range: Range): { from: string; to: string } {
  const now = new Date()
  const to = localDateStr(now)
  if (range === 'today') return { from: to, to }
  const d = new Date(now)
  d.setDate(d.getDate() - (range === '7d' ? 7 : 30))
  return { from: localDateStr(d), to }
}

interface DayPoint  { date: string; sales: number }
interface TopProduct { name: string; qty: number; revenue: number }
interface ByCat      { name: string; emoji: string | null; revenue: number; qty: number }
interface LowItem    { name: string; qty: number }

interface InformeData {
  period: { from: string; to: string }
  kpis: { totalSales: number; totalOrders: number }
  byMethod: Record<string, number>
  paymentMethodLabels: Record<string, string>
  byType: Record<string, number>
  dailySeries: DayPoint[]
  topProducts: TopProduct[]
  byCategory: ByCat[]
  lowRotation: LowItem[]
}

// ── Simple bar for relative values ───────────────────────────────────────────

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <View style={bar.track}>
      <View style={[bar.fill, { width: `${pct}%` as any, backgroundColor: color }]} />
    </View>
  )
}
const bar = StyleSheet.create({
  track: { height: 6, backgroundColor: '#f1f5f9', borderRadius: 3, overflow: 'hidden', flex: 1 },
  fill:  { height: 6, borderRadius: 3 },
})

const COLORS = ['#2563eb', '#16a34a', '#ea580c', '#9333ea', '#0891b2', '#dc2626']

// ─── Pantalla ─────────────────────────────────────────────────────────────────

export default function InformesScreen() {
  const router = useRouter()
  const { tenant, user } = useAuthStore()
  const PRIMARY  = tenant?.primaryColor ?? '#2563eb'
  const sign     = tenant?.currencySign ?? '$'

  useEffect(() => {
    if (user && !['admin', 'cajero'].includes(user.role)) router.back()
  }, [user?.role])

  const [range, setRange] = useState<Range>('today')
  const { from, to } = getFromTo(range)

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['informes', range],
    queryFn:  () =>
      api.get<{ data: InformeData }>(`/api/tenant/informes?from=${from}&to=${to}`)
         .then((r) => r.data),
  })

  if (isLoading) {
    return <View style={s.centered}><ActivityIndicator size="large" color={PRIMARY} /></View>
  }

  const d = data
  const fmt = (n: number) => formatCurrency(n, sign)

  const maxSales  = d?.topProducts?.[0]?.qty ?? 1
  const maxCatRev = d?.byCategory?.[0]?.revenue ?? 1
  const maxDay    = Math.max(...(d?.dailySeries?.map((p) => p.sales) ?? [0]))

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={PRIMARY} />}
    >
      {/* ── Selector de rango ── */}
      <View style={s.rangeRow}>
        {RANGES.map((r) => (
          <TouchableOpacity
            key={r.key}
            style={[s.rangeBtn, range === r.key && { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
            onPress={() => setRange(r.key)}
          >
            <Text style={[s.rangeBtnText, range === r.key && s.rangeBtnTextActive]}>
              {r.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── KPIs ── */}
      <View style={s.kpiRow}>
        <View style={s.kpi}>
          <View style={[s.kpiIcon, { backgroundColor: '#10b98118' }]}>
            <Ionicons name="trending-up-outline" size={20} color="#10b981" />
          </View>
          <Text style={s.kpiValue}>{fmt(d?.kpis.totalSales ?? 0)}</Text>
          <Text style={s.kpiLabel}>Ventas totales</Text>
        </View>
        <View style={s.kpi}>
          <View style={[s.kpiIcon, { backgroundColor: PRIMARY + '18' }]}>
            <Ionicons name="bag-outline" size={20} color={PRIMARY} />
          </View>
          <Text style={s.kpiValue}>{d?.kpis.totalOrders ?? 0}</Text>
          <Text style={s.kpiLabel}>Pedidos cobrados</Text>
        </View>
      </View>

      {/* ── Ventas por día ── */}
      {d && (d.dailySeries?.length ?? 0) > 0 && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Ventas por día</Text>
          {d.dailySeries.map((pt) => (
            <View key={pt.date} style={s.dayRow}>
              <Text style={s.dayLabel}>
                {new Date(pt.date + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
              </Text>
              <View style={{ flex: 1 }}>
                <Bar value={pt.sales} max={maxDay} color={PRIMARY} />
              </View>
              <Text style={s.dayValue}>{fmt(pt.sales)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ── Por categoría ── */}
      {d && (d.byCategory?.length ?? 0) > 0 && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Ventas por categoría</Text>
          {d.byCategory.map((c, i) => (
            <View key={c.name} style={s.catRow}>
              <Text style={s.catEmoji}>{c.emoji ?? '📦'}</Text>
              <View style={{ flex: 1, gap: 4 }}>
                <View style={s.catMeta}>
                  <Text style={s.catName} numberOfLines={1}>{c.name}</Text>
                  <Text style={s.catSub}>{c.qty} uds · {fmt(c.revenue)}</Text>
                </View>
                <Bar value={c.revenue} max={maxCatRev} color={COLORS[i % COLORS.length]} />
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ── Métodos de pago ── */}
      {d && Object.keys(d.byMethod).length > 0 && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Métodos de pago</Text>
          {Object.entries(d.byMethod).map(([key, val], i) => (
            <View key={key} style={s.methodRow}>
              <View style={[s.dot, { backgroundColor: COLORS[i % COLORS.length] }]} />
              <Text style={s.methodLabel}>{d.paymentMethodLabels[key] ?? key}</Text>
              <Text style={s.methodValue}>{fmt(val)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ── Por tipo de pedido ── */}
      {d && Object.keys(d.byType).length > 0 && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Por tipo de pedido</Text>
          {Object.entries(d.byType).map(([key, val]) => (
            <View key={key} style={s.methodRow}>
              <Ionicons
                name={key === 'table' ? 'restaurant-outline' : key === 'delivery' ? 'bicycle-outline' : 'cafe-outline'}
                size={14} color="#94a3b8"
              />
              <Text style={s.methodLabel}>
                {key === 'table' ? 'Mesa' : key === 'bar' ? 'Barra' : 'Domicilio'}
              </Text>
              <Text style={s.methodValue}>{fmt(val)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ── Top 10 productos ── */}
      {d && d.topProducts.length > 0 && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Top 10 más vendidos</Text>
          {d.topProducts.slice(0, 10).map((p, i) => (
            <View key={p.name} style={s.topRow}>
              <Text style={s.rankNum}>{i + 1}</Text>
              <View style={{ flex: 1, gap: 4 }}>
                <View style={s.catMeta}>
                  <Text style={s.catName} numberOfLines={1}>{p.name}</Text>
                  <Text style={s.catSub}>{p.qty} uds · {fmt(p.revenue)}</Text>
                </View>
                <Bar value={p.qty} max={maxSales} color={PRIMARY} />
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ── Baja rotación ── */}
      {d && (d.lowRotation?.length ?? 0) > 0 && (
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Ionicons name="warning-outline" size={15} color="#f59e0b" />
            <Text style={s.sectionTitle}>Baja rotación</Text>
          </View>
          <Text style={s.sectionNote}>Productos con menos de 5 ventas en el período</Text>
          {d.lowRotation.map((p) => (
            <View key={p.name} style={s.lowRow}>
              <Text style={s.lowName} numberOfLines={1}>{p.name}</Text>
              <Text style={[s.lowQty, p.qty === 0 ? s.lowQtyZero : s.lowQtyLow]}>
                {p.qty === 0 ? 'Sin ventas' : `${p.qty} uds`}
              </Text>
            </View>
          ))}
        </View>
      )}

      {d?.kpis.totalOrders === 0 && (
        <View style={s.empty}>
          <Ionicons name="bar-chart-outline" size={48} color="#d1d5db" />
          <Text style={s.emptyText}>Sin ventas en este período</Text>
        </View>
      )}
    </ScrollView>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#f8fafc' },
  centered:{ flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll:  { padding: 16, gap: 14, paddingBottom: 40 },

  rangeRow: { flexDirection: 'row', gap: 8 },
  rangeBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0',
  },
  rangeBtnText:      { fontSize: 14, fontWeight: '600', color: '#64748b' },
  rangeBtnTextActive:{ color: '#fff' },

  kpiRow: { flexDirection: 'row', gap: 12 },
  kpi: {
    flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 6,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  kpiIcon:  { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  kpiValue: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  kpiLabel: { fontSize: 12, color: '#94a3b8', fontWeight: '500' },

  section: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 10,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle:  { fontSize: 11, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionNote:   { fontSize: 12, color: '#94a3b8', marginTop: -6 },

  dayRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  dayLabel: { fontSize: 12, color: '#64748b', width: 52 },
  dayValue: { fontSize: 12, fontWeight: '700', color: '#0f172a', width: 80, textAlign: 'right' },

  catRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
  catEmoji: { fontSize: 18, width: 26, textAlign: 'center' },
  catMeta:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  catName:  { fontSize: 13, fontWeight: '600', color: '#1e293b', flex: 1 },
  catSub:   { fontSize: 12, color: '#94a3b8', flexShrink: 0 },

  methodRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  dot:         { width: 8, height: 8, borderRadius: 4 },
  methodLabel: { flex: 1, fontSize: 14, color: '#374151' },
  methodValue: { fontSize: 14, fontWeight: '700', color: '#0f172a' },

  topRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  rankNum: { fontSize: 13, fontWeight: '700', color: '#94a3b8', width: 20, textAlign: 'right' },

  lowRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 1, borderTopColor: '#f8fafc' },
  lowName:    { fontSize: 13, color: '#374151', flex: 1 },
  lowQty:     { fontSize: 13, fontWeight: '700', marginLeft: 8 },
  lowQtyZero: { color: '#ef4444' },
  lowQtyLow:  { color: '#f59e0b' },

  empty:     { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyText: { color: '#9ca3af', fontSize: 14 },
})
