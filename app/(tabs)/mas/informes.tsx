import { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useAppColors } from '@/lib/theme'
import { ErrorView } from '@/components/ErrorView'

type Range = 'today' | 'week' | 'month'

const RANGES: { key: Range; label: string }[] = [
  { key: 'today', label: 'Hoy' },
  { key: 'week',  label: 'Semana' },
  { key: 'month', label: 'Mes' },
]

function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getQueryParams(range: Range): string {
  const now = new Date()

  if (range === 'today') {
    return 'range=shift'
  }

  if (range === 'week') {
    const d = new Date(now)
    const day = d.getDay()
    const diffToMonday = day === 0 ? -6 : 1 - day
    d.setDate(d.getDate() + diffToMonday)
    const monday = localDateStr(d)
    const sun = new Date(d)
    sun.setDate(d.getDate() + 6)
    return `from=${monday}&to=${localDateStr(sun)}`
  }

  const year  = now.getFullYear()
  const month = now.getMonth()
  const first = new Date(year, month, 1)
  const last  = new Date(year, month + 1, 0)
  return `from=${localDateStr(first)}&to=${localDateStr(last)}`
}

interface DayPoint  { date: string; sales: number }
interface TopProduct { name: string; qty: number; revenue: number }
interface ByCat      { name: string; emoji: string | null; revenue: number; qty: number }
interface LowItem    { name: string; qty: number }

interface PendingPayment { id: string; closedAt: string | null; total: number; customerName: string; paymentNotes: string }
interface PaymentMethodCfg { key: string; label: string; isCredit?: boolean }

interface InformeData {
  period: { from: string; to: string }
  kpis: { totalSales: number; totalOrders: number; totalPending?: number; pendingCount?: number }
  byMethod: Record<string, number>
  paymentMethodLabels: Record<string, string>
  paymentMethods?: PaymentMethodCfg[]
  byType: Record<string, number>
  dailySeries: DayPoint[]
  topProducts: TopProduct[]
  byCategory: ByCat[]
  lowRotation: LowItem[]
  pendingPayments?: PendingPayment[]
}

interface CollectState {
  orderId: string
  customerName: string
  total: number
  method: string
  amount: string
  notes: string
  saving: boolean
}

// ── Simple bar for relative values ───────────────────────────────────────────

function Bar({ value, max, color, trackColor }: { value: number; max: number; color: string; trackColor: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <View style={[bar.track, { backgroundColor: trackColor }]}>
      <View style={[bar.fill, { width: `${pct}%` as any, backgroundColor: color }]} />
    </View>
  )
}
const bar = StyleSheet.create({
  track: { height: 6, borderRadius: 3, overflow: 'hidden', flex: 1 },
  fill:  { height: 6, borderRadius: 3 },
})

const COLORS = ['#2563eb', '#16a34a', '#ea580c', '#9333ea', '#0891b2', '#dc2626']

// ─── Pantalla ─────────────────────────────────────────────────────────────────

export default function InformesScreen() {
  const router = useRouter()
  const { tenant, user } = useAuthStore()
  const PRIMARY  = tenant?.primaryColor ?? '#2563eb'
  const sign     = tenant?.currencySign ?? '$'
  const c = useAppColors()
  const s = makeStyles(c)

  useEffect(() => {
    if (user && !['admin', 'cajero'].includes(user.role)) router.back()
  }, [user?.role])

  if (user && !['admin', 'cajero'].includes(user.role)) return null

  const [range, setRange] = useState<Range>('today')
  const [collect, setCollect] = useState<CollectState | null>(null)

  const { data, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ['informes', range],
    queryFn:  () =>
      api.get<{ data: InformeData }>(`/api/tenant/informes?${getQueryParams(range)}`)
         .then((r) => r.data),
  })

  if (isLoading) {
    return <View style={s.centered}><ActivityIndicator size="large" color={PRIMARY} /></View>
  }

  if (isError) {
    return <ErrorView message="No se pudo cargar el informe." onRetry={refetch} />
  }

  const d = data
  const fmt = (n: number) => formatCurrency(n, sign)

  function openCollect(p: PendingPayment) {
    const methods = (d?.paymentMethods ?? []).filter((m) => !m.isCredit)
    setCollect({
      orderId: p.id,
      customerName: p.customerName,
      total: p.total,
      method: methods[0]?.key ?? 'cash',
      amount: String(p.total),
      notes: '',
      saving: false,
    })
  }

  async function saveCollect() {
    if (!collect) return
    setCollect((c) => c && ({ ...c, saving: true }))
    try {
      await api.patch(`/api/tenant/orders/${collect.orderId}`, {
        action: 'collect_credit',
        payments: [{ method: collect.method, amount: parseFloat(collect.amount) || collect.total }],
        paymentNotes: collect.notes || undefined,
      })
      setCollect(null)
      refetch()
    } catch (e: any) {
      alert(e?.message ?? 'Error al cobrar')
      setCollect((c) => c && ({ ...c, saving: false }))
    }
  }

  const maxSales  = d?.topProducts?.[0]?.qty ?? 1
  const maxCatRev = d?.byCategory?.[0]?.revenue ?? 1
  const maxDay    = Math.max(...(d?.dailySeries?.map((p) => p.sales) ?? [0]))

  return (
    <SafeAreaView style={s.root} edges={['bottom']}>
    <ScrollView
      style={{ flex: 1 }}
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
                <Bar value={pt.sales} max={maxDay} color={PRIMARY} trackColor={c.surfaceAlt} />
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
          {d.byCategory.map((cat, i) => (
            <View key={cat.name} style={s.catRow}>
              <Text style={s.catEmoji}>{cat.emoji ?? '📦'}</Text>
              <View style={{ flex: 1, gap: 4 }}>
                <View style={s.catMeta}>
                  <Text style={s.catName} numberOfLines={1}>{cat.name}</Text>
                  <Text style={s.catSub}>{cat.qty} uds · {fmt(cat.revenue)}</Text>
                </View>
                <Bar value={cat.revenue} max={maxCatRev} color={COLORS[i % COLORS.length]} trackColor={c.surfaceAlt} />
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
                size={14} color={c.textMuted}
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
                <Bar value={p.qty} max={maxSales} color={PRIMARY} trackColor={c.surfaceAlt} />
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

      {/* ── Cuentas por cobrar ── */}
      {(d?.pendingPayments?.length ?? 0) > 0 && (
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Ionicons name="time-outline" size={15} color="#f59e0b" />
            <Text style={s.sectionTitle}>Cuentas por cobrar</Text>
          </View>
          {d!.pendingPayments!.map((p) => (
            <View key={p.id} style={s.pendingRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.pendingName} numberOfLines={1}>{p.customerName}</Text>
                {!!p.paymentNotes && <Text style={s.pendingNote} numberOfLines={1}>{p.paymentNotes}</Text>}
              </View>
              <Text style={s.pendingAmt}>{fmt(p.total)}</Text>
              <TouchableOpacity style={s.cobrarBtn} onPress={() => openCollect(p)}>
                <Text style={s.cobrarBtnText}>Cobrar</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {d?.kpis.totalOrders === 0 && (
        <View style={s.empty}>
          <Ionicons name="bar-chart-outline" size={48} color={c.border} />
          <Text style={s.emptyText}>Sin ventas en este período</Text>
        </View>
      )}
    </ScrollView>

    {/* ── Modal cobrar ── */}
    <Modal visible={collect !== null} transparent animationType="fade" onRequestClose={() => !collect?.saving && setCollect(null)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => !collect?.saving && setCollect(null)}>
          <TouchableOpacity style={s.modalCard} activeOpacity={1}>
            {collect && (
              <>
                <Text style={s.modalTitle}>Cobrar — {collect.customerName}</Text>
                <Text style={s.modalSub}>Total pendiente: <Text style={s.modalSubBold}>{fmt(collect.total)}</Text></Text>

                <Text style={s.fieldLabel}>Forma de pago</Text>
                <View style={s.methodChips}>
                  {(d?.paymentMethods ?? []).filter((m) => !m.isCredit).map((m) => (
                    <TouchableOpacity
                      key={m.key}
                      style={[s.chip, collect.method === m.key && s.chipActive]}
                      onPress={() => setCollect((c) => c && ({ ...c, method: m.key }))}
                    >
                      <Text style={[s.chipText, collect.method === m.key && s.chipTextActive]}>{m.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={s.fieldLabel}>Monto recibido</Text>
                <TextInput
                  style={s.input}
                  keyboardType="numeric"
                  value={collect.amount}
                  onChangeText={(v) => setCollect((c) => c && ({ ...c, amount: v }))}
                  placeholder={String(collect.total)}
                  placeholderTextColor={c.textMuted}
                />

                <Text style={s.fieldLabel}>Observaciones (opcional)</Text>
                <TextInput
                  style={s.input}
                  value={collect.notes}
                  onChangeText={(v) => setCollect((c) => c && ({ ...c, notes: v }))}
                  placeholder="Ej: pagó en dos cuotas..."
                  placeholderTextColor={c.textMuted}
                />

                <View style={s.modalBtns}>
                  <TouchableOpacity style={s.cancelBtn} onPress={() => setCollect(null)} disabled={collect.saving}>
                    <Text style={s.cancelBtnText}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.confirmBtn} onPress={saveCollect} disabled={collect.saving}>
                    {collect.saving
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={s.confirmBtnText}>Confirmar cobro</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
    </SafeAreaView>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

function makeStyles(c: ReturnType<typeof import('@/lib/theme').useAppColors>) {
  return StyleSheet.create({
    root:    { flex: 1, backgroundColor: c.background },
    centered:{ flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll:  { padding: 16, gap: 14, paddingBottom: 40 },

    rangeRow: { flexDirection: 'row', gap: 8 },
    rangeBtn: {
      flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
      backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
    },
    rangeBtnText:      { fontSize: 14, fontWeight: '600', color: c.textMuted },
    rangeBtnTextActive:{ color: c.textInverse },

    kpiRow: { flexDirection: 'row', gap: 12 },
    kpi: {
      flex: 1, backgroundColor: c.surface, borderRadius: 14, padding: 16, gap: 6,
      shadowColor: c.shadow, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
    },
    kpiIcon:  { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    kpiValue: { fontSize: 20, fontWeight: '800', color: c.text },
    kpiLabel: { fontSize: 12, color: c.textMuted, fontWeight: '500' },

    section: {
      backgroundColor: c.surface, borderRadius: 14, padding: 16, gap: 10,
      shadowColor: c.shadow, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
    },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    sectionTitle:  { fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
    sectionNote:   { fontSize: 12, color: c.textMuted, marginTop: -6 },

    dayRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
    dayLabel: { fontSize: 12, color: c.textMuted, width: 52 },
    dayValue: { fontSize: 12, fontWeight: '700', color: c.text, width: 80, textAlign: 'right' },

    catRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
    catEmoji: { fontSize: 18, width: 26, textAlign: 'center' },
    catMeta:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    catName:  { fontSize: 13, fontWeight: '600', color: c.text, flex: 1 },
    catSub:   { fontSize: 12, color: c.textMuted, flexShrink: 0 },

    methodRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
    dot:         { width: 8, height: 8, borderRadius: 4 },
    methodLabel: { flex: 1, fontSize: 14, color: c.textSecondary },
    methodValue: { fontSize: 14, fontWeight: '700', color: c.text },

    topRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
    rankNum: { fontSize: 13, fontWeight: '700', color: c.textMuted, width: 20, textAlign: 'right' },

    lowRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 1, borderTopColor: c.background },
    lowName:    { fontSize: 13, color: c.textSecondary, flex: 1 },
    lowQty:     { fontSize: 13, fontWeight: '700', marginLeft: 8 },
    lowQtyZero: { color: c.danger },
    lowQtyLow:  { color: '#f59e0b' },

    empty:     { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
    emptyText: { color: c.textMuted, fontSize: 14 },

    pendingRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: c.background },
    pendingName: { fontSize: 13, fontWeight: '600', color: c.text },
    pendingNote: { fontSize: 11, color: c.textMuted },
    pendingAmt:  { fontSize: 14, fontWeight: '700', color: '#d97706' },
    cobrarBtn:   { backgroundColor: '#16a34a', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
    cobrarBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 16 },
    modalCard:    { backgroundColor: c.surface, borderRadius: 20, padding: 24, width: '100%', maxWidth: 380, gap: 12 },
    modalTitle:   { fontSize: 16, fontWeight: '800', color: c.text },
    modalSub:     { fontSize: 13, color: c.textMuted },
    modalSubBold: { fontWeight: '700', color: c.text },
    fieldLabel:   { fontSize: 11, fontWeight: '600', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
    methodChips:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip:         { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceAlt },
    chipActive:   { backgroundColor: '#2563eb', borderColor: '#2563eb' },
    chipText:     { fontSize: 13, color: c.textSecondary, fontWeight: '600' },
    chipTextActive: { color: '#fff' },
    input:        { borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: c.text, backgroundColor: c.surfaceAlt },
    modalBtns:    { flexDirection: 'row', gap: 10, marginTop: 4 },
    cancelBtn:    { flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 12, alignItems: 'center' },
    cancelBtnText: { fontSize: 14, fontWeight: '600', color: c.textSecondary },
    confirmBtn:   { flex: 1, backgroundColor: '#16a34a', borderRadius: 10, padding: 12, alignItems: 'center' },
    confirmBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  })
}
