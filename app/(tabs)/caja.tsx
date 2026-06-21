import { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, ActivityIndicator, RefreshControl, Modal, SafeAreaView,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { Ionicons } from '@expo/vector-icons'
import { api } from '@/lib/api'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useNetworkStatus } from '@/hooks/use-network'
import { ErrorView } from '@/components/ErrorView'
import { useAppColors } from '@/lib/theme'
import type { CashRegister, CajaSummary } from '@/types'

const GREEN = '#10b981'

interface CajaData {
  register: CashRegister | null
  summary: CajaSummary | null
  history: CashRegister[]
  currencySign: string
  paymentMethodLabels: Record<string, string>
}

// ─── Modal: Abrir caja ────────────────────────────────────────────────────────

function OpenModal({ visible, sign, onClose, onDone }: {
  visible: boolean; sign: string; onClose: () => void; onDone: () => void
}) {
  const { tenant, config } = useAuthStore()
  const { isConnected } = useNetworkStatus()
  const c = useAppColors()
  const styles = makeStyles(c)
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const defaultAmount = config?.defaultOpeningAmount ?? 0
  const [amount, setAmount] = useState(defaultAmount > 0 ? String(defaultAmount) : '')
  const [notes, setNotes]   = useState('')
  const [loading, setLoading] = useState(false)

  async function submit() {
    if (!isConnected) {
      Alert.alert('Sin conexión', 'Las operaciones de caja requieren conexión a internet.')
      return
    }
    setLoading(true)
    try {
      await api.post('/api/tenant/caja', {
        action: 'open',
        openingAmount: parseFloat(amount) || 0,
        notes: notes || undefined,
      })
      setAmount(''); setNotes('')
      onDone()
    } catch (err: any) {
      Alert.alert('Error', err.message)
    } finally { setLoading(false) }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet">
      <SafeAreaView style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Abrir caja</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={c.textSecondary} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.modalBody}>
          <Text style={styles.label}>Monto inicial ({sign})</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={c.textMuted}
            value={amount}
            onChangeText={setAmount}
          />
          <Text style={styles.label}>Notas (opcional)</Text>
          <TextInput
            style={[styles.input, styles.inputMulti]}
            placeholder="Observaciones..."
            placeholderTextColor={c.textMuted}
            value={notes}
            onChangeText={setNotes}
            multiline
          />
          <TouchableOpacity
            style={[styles.openSubmitBtn, { backgroundColor: PRIMARY }, loading && styles.btnDisabled]}
            onPress={submit} disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.primaryBtnText}>Abrir caja</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

// ─── Modal: Cerrar caja ───────────────────────────────────────────────────────

function CloseModal({ visible, expected, sign, onClose, onDone }: {
  visible: boolean; expected: number; sign: string; onClose: () => void; onDone: () => void
}) {
  const { isConnected } = useNetworkStatus()
  const c = useAppColors()
  const styles = makeStyles(c)
  const [counted, setCounted] = useState('')
  const [notes, setNotes]     = useState('')
  const [loading, setLoading] = useState(false)

  const diff = (parseFloat(counted) || 0) - expected

  async function submit() {
    if (!isConnected) {
      Alert.alert('Sin conexión', 'Las operaciones de caja requieren conexión a internet.')
      return
    }
    setLoading(true)
    try {
      await api.post('/api/tenant/caja', {
        action: 'close',
        countedCash: parseFloat(counted) || 0,
        notes: notes || undefined,
      })
      setCounted(''); setNotes('')
      onDone()
    } catch (err: any) {
      Alert.alert('Error', err.message)
    } finally { setLoading(false) }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet">
      <SafeAreaView style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Cerrar caja</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={c.textSecondary} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.modalBody}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Efectivo esperado</Text>
            <Text style={styles.infoValue}>{formatCurrency(expected, sign)}</Text>
          </View>

          <Text style={styles.label}>Efectivo contado ({sign})</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={c.textMuted}
            value={counted}
            onChangeText={setCounted}
          />

          {counted !== '' && (
            <View style={[styles.diffBox, diff >= 0 ? styles.diffPos : styles.diffNeg]}>
              <Text style={styles.diffLabel}>Diferencia</Text>
              <Text style={styles.diffValue}>
                {diff >= 0 ? '+' : ''}{formatCurrency(diff, sign)}
              </Text>
            </View>
          )}

          <Text style={styles.label}>Notas (opcional)</Text>
          <TextInput
            style={[styles.input, styles.inputMulti]}
            placeholder="Observaciones del arqueo..."
            placeholderTextColor={c.textMuted}
            value={notes}
            onChangeText={setNotes}
            multiline
          />

          <TouchableOpacity
            style={[styles.closeRegBtn, loading && styles.btnDisabled]}
            onPress={submit} disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.primaryBtnText}>Confirmar cierre</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

// ─── Tarjeta KPI ──────────────────────────────────────────────────────────────

function KpiCard({ label, value, icon, color }: {
  label: string; value: string; icon: string; color: string
}) {
  const c = useAppColors()
  const styles = makeStyles(c)
  return (
    <View style={styles.kpi}>
      <View style={[styles.kpiIcon, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon as any} size={20} color={color} />
      </View>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  )
}

// ─── Fila historial ───────────────────────────────────────────────────────────

function HistoryRow({ reg, sign }: { reg: CashRegister; sign: string }) {
  const c = useAppColors()
  const styles = makeStyles(c)
  const diff = parseFloat(reg.difference ?? '0')
  return (
    <View style={styles.histRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.histDate}>{reg.closedAt ? formatDateTime(reg.closedAt) : '—'}</Text>
        <Text style={styles.histSub}>
          Apertura {formatCurrency(parseFloat(reg.openingAmount ?? '0'), sign)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.histExpected}>{formatCurrency(parseFloat(reg.countedCash ?? '0'), sign)}</Text>
        {reg.difference !== null && (
          <Text style={[styles.histDiff, diff >= 0 ? styles.diffPosText : styles.diffNegText]}>
            {diff >= 0 ? '+' : ''}{formatCurrency(diff, sign)}
          </Text>
        )}
      </View>
    </View>
  )
}

// ─── Pantalla principal ───────────────────────────────────────────────────────

export default function CajaScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const { tenant, user } = useAuthStore()
  const c = useAppColors()
  const styles = makeStyles(c)
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'

  useEffect(() => {
    if (user && !['admin', 'cajero'].includes(user.role)) router.back()
  }, [user?.role])

  const [openModal, setOpenModal]   = useState(false)
  const [closeModal, setCloseModal] = useState(false)

  const { data, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ['caja'],
    queryFn: () => api.get<{ data: CajaData }>('/api/tenant/caja').then((r) => r.data),
    refetchInterval: 30_000,
    gcTime: 24 * 60 * 60 * 1000,
  })

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['caja'] })
    refetch()
  }

  if (isLoading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={PRIMARY} /></View>
  }

  if (isError) {
    return <ErrorView message="No se pudo cargar el estado de la caja." onRetry={refetch} />
  }

  const sign    = data?.currencySign ?? '$'
  const reg     = data?.register ?? null
  const summary = data?.summary ?? null
  const history = data?.history ?? []
  const labels  = data?.paymentMethodLabels ?? {}
  const isOpen  = !!reg

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={PRIMARY} />}
      >
        {/* ── Estado de caja ── */}
        <View style={[styles.statusCard, isOpen ? styles.statusOpen : styles.statusClosed]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>{isOpen ? 'Caja abierta' : 'Caja cerrada'}</Text>
            {isOpen && reg?.openedAt && (
              <Text style={styles.statusSub}>Desde {formatDateTime(reg.openedAt)}</Text>
            )}
            {isOpen && (
              <Text style={styles.statusSub}>
                Apertura {formatCurrency(parseFloat(reg!.openingAmount ?? '0'), sign)}
              </Text>
            )}
          </View>
          <View style={[styles.statusDot, { backgroundColor: isOpen ? GREEN : c.textMuted }]} />
        </View>

        {/* ── KPIs (sólo si hay caja abierta con ventas) ── */}
        {isOpen && summary && (
          <>
            <View style={styles.kpiGrid}>
              <KpiCard label="Pedidos" value={String(summary.totalOrders)} icon="receipt-outline" color={PRIMARY} />
              <KpiCard label="Ventas" value={formatCurrency(summary.totalSales, sign)} icon="cash-outline" color={GREEN} />
              <KpiCard label="Propinas" value={formatCurrency(summary.totalTips, sign)} icon="heart-outline" color="#f59e0b" />
              <KpiCard label="Efectivo esp." value={formatCurrency(summary.expectedCash, sign)} icon="wallet-outline" color="#6366f1" />
            </View>

            {/* ── Por método de pago ── */}
            {Object.keys(summary.byPaymentMethod).length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Por método de pago</Text>
                {Object.entries(summary.byPaymentMethod).map(([key, val]) => (
                  <View key={key} style={styles.methodRow}>
                    <Text style={styles.methodLabel}>{labels[key] ?? key}</Text>
                    <Text style={styles.methodValue}>{formatCurrency(val, sign)}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* ── Cerrar caja ── */}
            <TouchableOpacity style={styles.closeCajaBtn} onPress={() => setCloseModal(true)}>
              <Ionicons name="lock-closed-outline" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>Cerrar caja</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Abrir caja ── */}
        {!isOpen && (
          <TouchableOpacity style={[styles.openCajaBtn, { backgroundColor: PRIMARY }]} onPress={() => setOpenModal(true)}>
            <Ionicons name="lock-open-outline" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>Abrir caja</Text>
          </TouchableOpacity>
        )}

        {/* ── Historial ── */}
        {history.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Historial reciente</Text>
            {history.map((h) => <HistoryRow key={h.id} reg={h} sign={sign} />)}
          </View>
        )}

        {history.length === 0 && !isOpen && (
          <View style={styles.emptyHistory}>
            <Ionicons name="time-outline" size={40} color={c.borderStrong} />
            <Text style={styles.emptyText}>Sin historial de caja</Text>
          </View>
        )}
      </ScrollView>

      <OpenModal
        visible={openModal}
        sign={sign}
        onClose={() => setOpenModal(false)}
        onDone={() => { setOpenModal(false); invalidate(); router.replace('/(tabs)/pedidos' as any) }}
      />
      <CloseModal
        visible={closeModal}
        expected={summary?.expectedCash ?? 0}
        sign={sign}
        onClose={() => setCloseModal(false)}
        onDone={() => { setCloseModal(false); invalidate() }}
      />
    </View>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

function makeStyles(c: ReturnType<typeof useAppColors>) {
  return StyleSheet.create({
    root:    { flex: 1, backgroundColor: c.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll:  { padding: 16, gap: 14, paddingBottom: 40 },

    statusCard: {
      flexDirection: 'row', alignItems: 'center', padding: 18,
      borderRadius: 14, gap: 12,
    },
    statusOpen:   { backgroundColor: c.successLight },
    statusClosed: { backgroundColor: c.surfaceAlt },
    statusDot: { width: 14, height: 14, borderRadius: 7 },
    statusTitle: { fontSize: 16, fontWeight: '700', color: c.text },
    statusSub:   { fontSize: 13, color: c.textMuted, marginTop: 2 },

    kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    kpi: {
      flex: 1, minWidth: '45%', backgroundColor: c.surface, borderRadius: 12,
      padding: 14, alignItems: 'flex-start', gap: 6,
      shadowColor: c.shadow, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
    },
    kpiIcon:  { borderRadius: 8, padding: 6 },
    kpiValue: { fontSize: 18, fontWeight: '800', color: c.text },
    kpiLabel: { fontSize: 12, color: c.textMuted, fontWeight: '500' },

    section: {
      backgroundColor: c.surface, borderRadius: 14, padding: 16, gap: 10,
      shadowColor: c.shadow, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
    },
    sectionTitle: { fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },

    methodRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
    methodLabel: { fontSize: 14, color: c.textSecondary },
    methodValue: { fontSize: 14, fontWeight: '700', color: c.text },

    openSubmitBtn: {
      borderRadius: 12, padding: 15, alignItems: 'center',
    },
    openCajaBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      borderRadius: 14, padding: 16, gap: 8,
    },
    closeCajaBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: '#ef4444', borderRadius: 14, padding: 16, gap: 8,
    },
    primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

    histRow: {
      flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
      borderTopWidth: 1, borderTopColor: c.border,
    },
    histDate:     { fontSize: 13, fontWeight: '600', color: c.text },
    histSub:      { fontSize: 12, color: c.textMuted, marginTop: 2 },
    histExpected: { fontSize: 14, fontWeight: '700', color: c.text },
    histDiff:     { fontSize: 12, fontWeight: '600', marginTop: 2 },
    diffPosText:  { color: GREEN },
    diffNegText:  { color: '#ef4444' },

    emptyHistory: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32, gap: 10 },
    emptyText:    { fontSize: 14, color: c.textMuted },

    // Modal
    modalRoot:   { flex: 1, backgroundColor: c.surface },
    modalHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingVertical: 16,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    modalTitle: { fontSize: 18, fontWeight: '700', color: c.text },
    modalBody:  { padding: 20, gap: 12 },

    label: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    input: {
      borderWidth: 1, borderColor: c.border, borderRadius: 10,
      padding: 12, fontSize: 16, backgroundColor: c.surfaceAlt, color: c.text,
    },
    inputMulti: { minHeight: 80, textAlignVertical: 'top' },

    infoRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    infoLabel: { fontSize: 14, color: c.textMuted },
    infoValue: { fontSize: 16, fontWeight: '700', color: c.text },

    diffBox:  { borderRadius: 10, padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    diffPos:  { backgroundColor: c.successLight },
    diffNeg:  { backgroundColor: c.dangerLight },
    diffLabel:{ fontSize: 13, fontWeight: '600', color: c.textSecondary },
    diffValue:{ fontSize: 16, fontWeight: '800', color: c.text },

    closeRegBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: '#ef4444', borderRadius: 12, padding: 14, gap: 8, marginTop: 8,
    },
    btnDisabled: { opacity: 0.5 },
  })
}
