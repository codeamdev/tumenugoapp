import { useState, useCallback, useEffect, useRef } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Modal, ScrollView, Alert, ActivityIndicator,
  RefreshControl, TextInput, KeyboardAvoidingView, Platform, Vibration,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '@/lib/api'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { enqueueSync } from '@/lib/offline/sync-queue'
import { saveActiveOrdersToCache, getActiveOrdersFromCache, removeOrderFromCache } from '@/lib/offline/cache'
import { useNetworkStatus } from '@/hooks/use-network'
import { ErrorView } from '@/components/ErrorView'
import { useAppColors } from '@/lib/theme'
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS, ORDER_TYPE_LABELS } from '@/types'
import { ProductPickerModal, type PickedItem } from '@/components/ProductPickerModal'
import type { Order, OrderStatus } from '@/types'

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const ACTIVE_TABS: { key: OrderStatus | 'all'; label: string }[] = [
  { key: 'all',       label: 'Todos' },
  { key: 'new',       label: 'Nuevo' },
  { key: 'sent',      label: 'En cocina' },
  { key: 'preparing', label: 'Preparando' },
  { key: 'ready',     label: 'Listo' },
  { key: 'delivered', label: 'Entregado' },
]

const HIST_TABS: { key: 'all' | 'cancelled'; label: string }[] = [
  { key: 'all',       label: 'Completados' },
  { key: 'cancelled', label: 'Cancelados' },
]

// ─── Modal: Cobrar pedido ─────────────────────────────────────────────────────

interface PaymentRow { method: string; amount: string }

function PayModal({ order, onClose, onRefresh }: {
  order: Order
  onClose: () => void
  onRefresh: () => void
}) {
  const c = useAppColors()
  const s = makePayStyles(c)
  const { tenant, config } = useAuthStore()
  const { isConnected } = useNetworkStatus()
  const qc = useQueryClient()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const sign    = tenant?.currencySign ?? '$'
  const methods = config?.paymentMethods ?? [{ key: 'cash', label: 'Efectivo' }]

  const orderTotal = parseFloat(order.total)

  const [payments, setPayments] = useState<PaymentRow[]>([{ method: methods[0]?.key ?? 'cash', amount: '' }])
  const [customerName, setCustomerName] = useState(order.customerName ?? '')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [loading, setLoading]   = useState(false)

  const grandTotal = orderTotal
  const totalPaid  = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0)
  const remaining  = grandTotal - totalPaid
  const isCredit   = !!(methods.find((m) => m.key === payments[0]?.method)?.isCredit)

  const QUICK_AMOUNTS = [10000, 20000, 50000, 100000]

  useEffect(() => {
    if (isCredit) {
      setPayments((prev) => [{ method: prev[0]?.method, amount: String(Math.round(orderTotal)) }])
    }
  }, [isCredit, orderTotal])

  function fmtNum(raw: string) {
    const n = raw.replace(/\D/g, '')
    return n ? parseInt(n, 10).toLocaleString('es-CO') : ''
  }

  function updateRow(idx: number, field: keyof PaymentRow, value: string) {
    const stored = field === 'amount' ? value.replace(/\D/g, '') : value
    setPayments((prev) => prev.map((p, i) => i === idx ? { ...p, [field]: stored } : p))
  }

  function addRow() {
    setPayments((prev) => [...prev, { method: methods[0]?.key ?? 'cash', amount: '' }])
  }

  function removeRow(idx: number) {
    setPayments((prev) => prev.filter((_, i) => i !== idx))
  }

  async function confirm() {
    const validPayments = payments
      .map((p) => ({ method: p.method, amount: parseFloat(p.amount) || 0 }))
      .filter((p) => p.amount > 0)

    if (validPayments.length === 0 && !isCredit) {
      Alert.alert('Sin monto', 'Ingresa al menos un monto de pago.')
      return
    }
    if (!isCredit && totalPaid < grandTotal - 0.01) {
      Alert.alert('Monto insuficiente', `Faltan ${formatCurrency(remaining, sign)} por cubrir.`)
      return
    }
    if (isCredit && !customerName.trim()) {
      Alert.alert('Nombre requerido', 'Ingresa el nombre del cliente para el fiado.')
      return
    }
    if (isCredit && !paymentNotes.trim()) {
      Alert.alert('Observación requerida', 'Ingresa las observaciones para el fiado.')
      return
    }
    setLoading(true)
    try {
      await api.patch(`/api/tenant/orders/${order.id}`, {
        action: 'close',
        payments: validPayments,
        customerName: isCredit ? customerName.trim() : undefined,
        paymentNotes: isCredit ? paymentNotes.trim() : undefined,
      })
      qc.invalidateQueries({ queryKey: ['tables'] })
      onRefresh()
      onClose()
    } catch (err: any) {
      const isNetErr = !isConnected || (err as any)?.status === 0 || err?.message === 'Sin conexión'
      if (isNetErr) {
        enqueueSync('update_order_status', {
          orderId: order.id,
          action: 'close',
          payments: validPayments,
          customerName: isCredit ? customerName.trim() : undefined,
        })
        removeOrderFromCache(order.id)
        qc.setQueryData<Order[]>(['orders', 'active'], (old = []) => old.filter((o) => o.id !== order.id))
        onClose()
      } else {
        Alert.alert('Error', err.message)
      }
    } finally { setLoading(false) }
  }

  const methodLabel = (key: string) => methods.find((m) => m.key === key)?.label ?? key

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.detailRoot}>
        <View style={s.detailHeader}>
          <Text style={s.detailTitle}>Cobrar pedido</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={c.textSecondary} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>

            {/* Totales */}
            <View style={[s.payTotal, { borderColor: PRIMARY + '40' }]}>
              <View style={{ flex: 1, gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={s.payTotalLabel}>Pedido</Text>
                  <Text style={[s.payTotalLabel, { color: c.text }]}>{formatCurrency(orderTotal, sign)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: PRIMARY + '30' }}>
                  <Text style={[s.payTotalLabel, { fontWeight: '700' }]}>Total</Text>
                  <Text style={[s.payTotalValue, { color: PRIMARY }]}>{formatCurrency(grandTotal, sign)}</Text>
                </View>
              </View>
            </View>

            {/* Pagos */}
            <View style={{ gap: 8 }}>
              <Text style={s.payLabel}>Pagos</Text>
              {payments.map((row, idx) => (
                <View key={idx} style={s.payRow}>
                  {/* Selector de método */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 38 }} contentContainerStyle={{ gap: 6, paddingRight: 4 }}>
                    {methods.map((m) => (
                      <TouchableOpacity
                        key={m.key}
                        style={[s.methodChip, row.method === m.key && { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
                        onPress={() => updateRow(idx, 'method', m.key)}
                      >
                        <Text style={[s.methodChipText, row.method === m.key && { color: c.textInverse }]}>{m.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  {isCredit ? (
                    <View style={{ marginTop: 8, padding: 10, backgroundColor: c.surfaceAlt, borderRadius: 10, borderWidth: 1, borderColor: c.border }}>
                      <Text style={{ fontSize: 14, color: c.textSecondary }}>Total a registrar como deuda:</Text>
                      <Text style={{ fontSize: 20, fontWeight: '800', color: c.text, marginTop: 2 }}>{formatCurrency(grandTotal, sign)}</Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                      <TextInput
                        style={[s.payInput, { flex: 1 }]}
                        keyboardType="numeric"
                        placeholder={`Monto (${sign})`}
                        placeholderTextColor={c.textMuted}
                        value={fmtNum(row.amount)}
                        onChangeText={(v) => updateRow(idx, 'amount', v)}
                      />
                      {payments.length > 1 && (
                        <TouchableOpacity onPress={() => removeRow(idx)} style={s.removePayBtn}>
                          <Ionicons name="trash-outline" size={18} color={c.danger} />
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              ))}

              {!isCredit && (
                <TouchableOpacity style={[s.addPayBtn, { borderColor: PRIMARY }]} onPress={addRow}>
                  <Ionicons name="add-circle-outline" size={16} color={PRIMARY} />
                  <Text style={[s.addPayBtnText, { color: PRIMARY }]}>Agregar método</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Botones de monto rápido (ocultos para crédito) */}
            {!isCredit && (
              <View style={{ gap: 6 }}>
                <Text style={s.payLabel}>Monto rápido</Text>
                <View style={s.quickRow}>
                  <TouchableOpacity
                    style={[s.quickBtn, { borderColor: PRIMARY, backgroundColor: PRIMARY }]}
                    onPress={() => updateRow(0, 'amount', String(Math.round(grandTotal)))}
                  >
                    <Text style={[s.quickBtnText, { color: '#fff' }]}>Exacto</Text>
                  </TouchableOpacity>
                  {QUICK_AMOUNTS.map((amt) => (
                    <TouchableOpacity
                      key={amt}
                      style={[s.quickBtn, { borderColor: PRIMARY }]}
                      onPress={() => updateRow(0, 'amount', String(amt))}
                    >
                      <Text style={[s.quickBtnText, { color: PRIMARY }]}>+{amt >= 1000 ? `${amt / 1000}k` : amt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Resumen de cobro */}
            {totalPaid > 0 && (
              <View style={[s.changeBox, remaining <= 0.01 ? s.changePos : s.changeNeg]}>
                <Text style={s.changeLabel}>
                  {remaining <= 0.01 ? (remaining < -0.01 ? 'Cambio a devolver' : 'Exacto') : 'Falta por cubrir'}
                </Text>
                <Text style={s.changeValue}>
                  {remaining < -0.01 ? formatCurrency(Math.abs(remaining), sign) : remaining > 0.01 ? formatCurrency(remaining, sign) : '—'}
                </Text>
              </View>
            )}

            {/* Nombre + Observaciones — solo para crédito/fiado */}
            {isCredit && (
              <>
                <View style={{ gap: 8 }}>
                  <Text style={s.payLabel}>Nombre del cliente *</Text>
                  <TextInput
                    style={s.payInput}
                    placeholder="Nombre completo de quien debe"
                    placeholderTextColor={c.textMuted}
                    value={customerName}
                    onChangeText={setCustomerName}
                    autoCapitalize="words"
                  />
                </View>
                <View style={{ gap: 8 }}>
                  <Text style={s.payLabel}>Observaciones *</Text>
                  <TextInput
                    style={[s.payInput, { minHeight: 70, textAlignVertical: 'top' }]}
                    placeholder="Motivo, plazo de pago, referencia..."
                    placeholderTextColor={c.textMuted}
                    value={paymentNotes}
                    onChangeText={setPaymentNotes}
                    multiline
                  />
                </View>
              </>
            )}

            <TouchableOpacity
              style={[
                s.confirmBtn,
                { backgroundColor: isCredit ? '#d97706' : PRIMARY },
                (loading || (isCredit && (!customerName.trim() || !paymentNotes.trim()))) && s.btnDisabled,
              ]}
              onPress={confirm}
              disabled={loading || (isCredit && (!customerName.trim() || !paymentNotes.trim()))}
            >
              {loading
                ? <ActivityIndicator color={c.textInverse} />
                : <Text style={s.confirmBtnText}>{isCredit ? 'Registrar fiado' : 'Confirmar cobro'}</Text>}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

function makePayStyles(c: ReturnType<typeof useAppColors>) {
  return StyleSheet.create({
    detailRoot: { flex: 1, backgroundColor: c.surface },
    detailHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingVertical: 16,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    detailTitle:  { fontSize: 18, fontWeight: '700', color: c.text },
    btnDisabled:  { opacity: 0.5 },

    payTotal: {
      borderWidth: 2, borderRadius: 12, padding: 16,
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    },
    payTotalLabel: { fontSize: 14, fontWeight: '600', color: c.textSecondary },
    payTotalValue: { fontSize: 24, fontWeight: '800' },
    payLabel:      { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    payInput: {
      borderWidth: 1, borderColor: c.border, borderRadius: 10,
      padding: 12, fontSize: 16, backgroundColor: c.surfaceAlt, color: c.text,
    },
    payRow: {
      backgroundColor: c.surfaceAlt, borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: c.border,
    },
    removePayBtn: { padding: 6 },
    addPayBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      borderWidth: 1, borderStyle: 'dashed', borderRadius: 10, paddingVertical: 10,
    },
    addPayBtnText: { fontSize: 13, fontWeight: '600' },
    methodChip: {
      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
      borderWidth: 1, borderColor: c.border, backgroundColor: c.surface,
    },
    methodChipText:{ fontSize: 13, fontWeight: '600', color: c.textSecondary },
    changeBox: {
      borderRadius: 10, padding: 12,
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    },
    changePos:   { backgroundColor: c.successLight },
    changeNeg:   { backgroundColor: c.dangerLight },
    changeLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    changeValue: { fontSize: 18, fontWeight: '800', color: c.text },
    quickRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    quickBtn:    { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
    quickBtnText:{ fontSize: 13, fontWeight: '700' },
    confirmBtn:  { borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
    confirmBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  })
}

// ─── OrderCard (acordeón) ─────────────────────────────────────────────────────

function OrderCard({ listOrder, expanded, onToggle, onRefresh, readOnly }: {
  listOrder: Order
  expanded: boolean
  onToggle: () => void
  onRefresh: () => void
  readOnly: boolean
}) {
  const c = useAppColors()
  const s = makeCardStyles(c)
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()
  const { isConnected } = useNetworkStatus()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const sign    = tenant?.currencySign ?? '$'
  const isAdmin = user?.role === 'admin'

  const [order, setOrder]           = useState<Order>(listOrder)
  const [loadingFull, setLoadingFull] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [payOpen, setPayOpen]       = useState(false)
  const [addOpen, setAddOpen]       = useState(false)
  const [cancellingItem, setCancellingItem] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState(listOrder.notes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)

  // Sync from list when not expanded (list data updates via refetch)
  useEffect(() => { if (!expanded) { setOrder(listOrder); setNotesDraft(listOrder.notes ?? '') } }, [listOrder, expanded])

  // Fetch full order (with items) when expanded
  useEffect(() => {
    if (!expanded) return
    setLoadingFull(true)
    api.get<{ data: Order }>(`/api/tenant/orders/${listOrder.id}`)
      .then((res) => { if (res.data) setOrder(res.data) })
      .catch(() => {})
      .finally(() => setLoadingFull(false))
  }, [expanded, listOrder.id])

  async function refreshOrder() {
    try {
      const res = await api.get<{ data: Order }>(`/api/tenant/orders/${listOrder.id}`)
      if (res.data) setOrder(res.data)
    } catch {}
    onRefresh()
  }

  async function saveNotes() {
    setSavingNotes(true)
    try {
      await api.patch(`/api/tenant/orders/${order.id}`, { notes: notesDraft })
      setOrder((prev) => ({ ...prev, notes: notesDraft }))
      setEditingNotes(false)
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'No se pudo guardar la nota')
    } finally { setSavingNotes(false) }
  }

  const color = ORDER_STATUS_COLORS[order.status] ?? '#6b7280'
  const label = ORDER_STATUS_LABELS[order.status] ?? order.status
  const origin = order.tableName
    ? `Mesa ${order.tableName}`
    : ORDER_TYPE_LABELS[order.type] ?? order.type

  const canEditNotes = !readOnly && !['closed', 'cancelled'].includes(order.status)
  const canCancel    = !readOnly && !['closed', 'cancelled'].includes(order.status)
  const canPay       = !readOnly && order.status === 'delivered'
  const canAdvance   = !readOnly && ['new', 'sent', 'preparing', 'ready'].includes(order.status)
  const canCancelItem = !readOnly && !['closed', 'cancelled'].includes(order.status)
  const canAddItems  = !readOnly && !['closed', 'cancelled'].includes(order.status)

  const ADVANCE_LABELS: Partial<Record<string, string>> = {
    new: 'Enviar a cocina', sent: 'Marcar preparando', preparing: 'Marcar listo', ready: 'Marcar entregado',
  }
  const NEXT_STATUS: Record<string, string> = {
    new: 'sent', sent: 'preparing', preparing: 'ready', ready: 'delivered',
  }

  function applyOptimisticStatus(status: string) {
    setOrder((prev) => ({ ...prev, status: status as OrderStatus }))
    qc.setQueryData<Order[]>(['orders', 'active'], (old = []) =>
      old.map((o) => o.id === order.id ? { ...o, status: status as OrderStatus } : o)
    )
  }

  async function advance(status: string) {
    applyOptimisticStatus(status)
    setActionLoading(true)
    try {
      await api.patch(`/api/tenant/orders/${order.id}`, { status })
      onRefresh()
    } catch (err: any) {
      setOrder(listOrder)
      const isNetErr = !isConnected || err?.message?.includes('Network request failed')
      if (isNetErr) {
        applyOptimisticStatus(status)
        enqueueSync('update_order_status', { orderId: order.id, status })
        Alert.alert('Sin conexión', 'El cambio se sincronizará cuando vuelva la conexión.')
      } else {
        Alert.alert('Error', err.message)
      }
    } finally { setActionLoading(false) }
  }

  async function cancel() {
    Alert.alert('Cancelar pedido', '¿Estás seguro?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Cancelar', style: 'destructive', onPress: async () => {
          applyOptimisticStatus('cancelled')
          setActionLoading(true)
          try {
            await api.patch(`/api/tenant/orders/${order.id}`, { status: 'cancelled' })
            qc.invalidateQueries({ queryKey: ['tables'] })
            onToggle(); onRefresh()
          } catch (err: any) {
            setOrder(listOrder)
            const isNetErr = !isConnected || err?.message?.includes('Network request failed')
            if (isNetErr) {
              applyOptimisticStatus('cancelled')
              enqueueSync('update_order_status', { orderId: order.id, status: 'cancelled' })
              Alert.alert('Sin conexión', 'La cancelación se sincronizará cuando vuelva la conexión.')
              onToggle()
            } else {
              Alert.alert('Error', err.message)
            }
          } finally { setActionLoading(false) }
        },
      },
    ])
  }

  async function deleteOrder() {
    Alert.alert('Eliminar pedido', '¿Eliminar permanentemente este pedido? Esta acción no se puede deshacer.', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Eliminar', style: 'destructive', onPress: async () => {
          setActionLoading(true)
          try {
            await api.delete(`/api/tenant/orders/${order.id}`)
            qc.setQueryData<Order[]>(['orders', 'active'], (old = []) => old.filter((o) => o.id !== order.id))
            qc.setQueryData<Order[]>(['orders', 'historial'], (old = []) => old?.filter((o) => o.id !== order.id))
            qc.invalidateQueries({ queryKey: ['tables'] })
            onRefresh()
          } catch (err: any) {
            Alert.alert('Error', err.message ?? 'No se pudo eliminar el pedido')
          } finally { setActionLoading(false) }
        },
      },
    ])
  }

  async function cancelItem(itemId: string, itemName: string) {
    Alert.alert('Quitar producto', `¿Cancelar "${itemName}" de este pedido?`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Quitar', style: 'destructive', onPress: async () => {
          setOrder((prev) => ({
            ...prev,
            items: prev.items?.map((it) => it.id === itemId ? { ...it, status: 'cancelled' as any } : it),
          }))
          setCancellingItem(itemId)
          try {
            await api.delete(`/api/tenant/orders/${order.id}/items/${itemId}`)
            await refreshOrder()
          } catch (err: any) {
            setOrder(listOrder)
            const isNetErr = !isConnected || err?.message?.includes('Network request failed')
            if (isNetErr) {
              enqueueSync('cancel_item', { orderId: order.id, itemId })
              Alert.alert('Sin conexión', 'La cancelación se sincronizará cuando vuelva la conexión.')
            } else {
              Alert.alert('Error', err.message ?? 'No se pudo cancelar el producto')
            }
          } finally { setCancellingItem(null) }
        },
      },
    ])
  }

  return (
    <View style={[s.cardWrap, expanded && { borderColor: PRIMARY + '40', borderWidth: 1 }]}>
      {/* ── Fila cabecera (siempre visible, tap = expand/collapse) ── */}
      <TouchableOpacity style={s.row} onPress={onToggle} activeOpacity={0.75}>
        <View style={{ flex: 1 }}>
          <Text style={s.rowOrigin}>{origin}</Text>
          <Text style={s.rowMeta} numberOfLines={1}>
            {order.displayCode ?? `#${order.id.slice(-6).toUpperCase()}`}
            {order.customerName ? `  ·  ${order.customerName}` : ''}
            {order.createdAt ? `  ·  ${formatDateTime(order.createdAt)}` : ''}
          </Text>
          <Text style={s.rowItems}>{(order as any).itemsCount ?? order.items?.length ?? 0} producto(s)</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6, marginRight: 8 }}>
          <Text style={s.rowTotal}>{formatCurrency(parseFloat(order.total), sign)}</Text>
          <View style={[s.badge, { backgroundColor: color + '22' }]}>
            <Text style={[s.badgeText, { color }]}>{label}</Text>
          </View>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} style={{ alignSelf: 'center' }} />
      </TouchableOpacity>

      {/* ── Detalle inline (solo cuando expanded) ── */}
      {expanded && (
        <View style={s.detail}>
          {loadingFull
            ? <View style={{ padding: 20, alignItems: 'center' }}><ActivityIndicator color={PRIMARY} /></View>
            : (
              <>
                {/* Info */}
                <View style={s.infoSection}>
                  {order.tableName       && <Text style={s.meta}>Mesa: {order.tableName}</Text>}
                  {order.customerName   && <Text style={s.meta}>Cliente: {order.customerName}</Text>}
                  {order.customerPhone  && <Text style={s.meta}>Tel: {order.customerPhone}</Text>}
                  {order.customerAddress && <Text style={s.meta}>Dirección: {order.customerAddress}</Text>}
                  {order.customerNotes  && <Text style={s.meta}>Nota cliente: {order.customerNotes}</Text>}

                  {/* Nota del pedido — editable */}
                  {canEditNotes ? (
                    editingNotes ? (
                      <View style={{ marginTop: 6, gap: 6 }}>
                        <TextInput
                          style={[s.notesInput, { borderColor: PRIMARY, color: c.text, backgroundColor: c.surfaceAlt }]}
                          value={notesDraft}
                          onChangeText={setNotesDraft}
                          placeholder="Notas del pedido..."
                          placeholderTextColor={c.textMuted}
                          multiline
                          autoFocus
                        />
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <TouchableOpacity
                            style={[s.notesSaveBtn, { backgroundColor: PRIMARY }, savingNotes && { opacity: 0.6 }]}
                            onPress={saveNotes}
                            disabled={savingNotes}
                          >
                            <Text style={s.notesSaveBtnText}>{savingNotes ? 'Guardando...' : 'Guardar'}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={s.notesCancelBtn}
                            onPress={() => { setNotesDraft(order.notes ?? ''); setEditingNotes(false) }}
                          >
                            <Text style={[s.notesSaveBtnText, { color: c.textSecondary }]}>Cancelar</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity onPress={() => setEditingNotes(true)} style={{ marginTop: 4 }}>
                        <Text style={[s.meta, { color: order.notes ? c.text : c.textMuted }]}>
                          {order.notes ? `📝 ${order.notes}` : '📝 Agregar nota...'}
                        </Text>
                      </TouchableOpacity>
                    )
                  ) : (
                    order.notes ? <Text style={s.meta}>📝 {order.notes}</Text> : null
                  )}
                </View>

                {/* Productos */}
                {order.items && order.items.length > 0 && (
                  <View style={s.itemsSection}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <Text style={s.sectionTitle}>Productos</Text>
                      {canAddItems && (
                        <TouchableOpacity onPress={() => setAddOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Ionicons name="add-circle-outline" size={16} color={PRIMARY} />
                          <Text style={{ color: PRIMARY, fontWeight: '600', fontSize: 13 }}>Agregar</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {order.items.map((item) => {
                      const name = (item.productSnapshot as any)?.name ?? 'Producto'
                      const isCancelled  = item.status === 'cancelled'
                      const isCancelling = cancellingItem === item.id
                      return (
                        <View key={item.id} style={[s.itemRow, isCancelled && { opacity: 0.5 }]}>
                          <Text style={[s.itemQty, { color: isCancelled ? c.textMuted : PRIMARY }]}>{item.quantity}×</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={[s.itemName, isCancelled && { textDecorationLine: 'line-through', color: c.textMuted }]}>{name}</Text>
                            {Array.isArray(item.modifierSnapshot) && item.modifierSnapshot.length > 0 && (
                              <Text style={s.itemMods}>{(item.modifierSnapshot as any[]).map((m) => m.modifierName).join(' · ')}</Text>
                            )}
                            {item.notes ? <Text style={[s.itemMods, { color: '#f97316' }]}>⚠ {item.notes}</Text> : null}
                            {isCancelled && <Text style={{ fontSize: 11, color: c.danger, fontWeight: '600' }}>Cancelado</Text>}
                          </View>
                          <View style={{ alignItems: 'flex-end', gap: 4 }}>
                            <Text style={[s.itemTotal, isCancelled && { textDecorationLine: 'line-through', color: c.textMuted }]}>
                              {formatCurrency(parseFloat(item.itemTotal), sign)}
                            </Text>
                            {canCancelItem && !isCancelled && (
                              isCancelling
                                ? <ActivityIndicator size="small" color={c.danger} />
                                : (
                                  <TouchableOpacity onPress={() => cancelItem(item.id, name)} style={{ padding: 2 }}>
                                    <Ionicons name="close-circle-outline" size={18} color={c.danger} />
                                  </TouchableOpacity>
                                )
                            )}
                          </View>
                        </View>
                      )
                    })}
                  </View>
                )}

                {/* Total */}
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Total</Text>
                  <Text style={[s.totalValue, { color: c.text }]}>{formatCurrency(parseFloat(order.total), sign)}</Text>
                </View>

                {/* Acciones */}
                <View style={s.actions}>
                  {canAdvance && (
                    <TouchableOpacity
                      style={[s.actionBtn, { backgroundColor: PRIMARY }, actionLoading && s.btnDisabled]}
                      onPress={() => advance(NEXT_STATUS[order.status])}
                      disabled={actionLoading}
                    >
                      {actionLoading
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={s.actionBtnText}>{ADVANCE_LABELS[order.status] ?? 'Avanzar'}</Text>}
                    </TouchableOpacity>
                  )}
                  {canPay && (
                    <TouchableOpacity
                      style={[s.actionBtn, { backgroundColor: '#059669' }, actionLoading && s.btnDisabled]}
                      onPress={() => setPayOpen(true)}
                      disabled={actionLoading}
                    >
                      <Ionicons name="cash-outline" size={16} color="#fff" />
                      <Text style={s.actionBtnText}>Cobrar</Text>
                    </TouchableOpacity>
                  )}
                  {canCancel && (
                    <TouchableOpacity
                      style={[s.cancelActionBtn, actionLoading && s.btnDisabled]}
                      onPress={cancel}
                      disabled={actionLoading}
                    >
                      <Text style={[s.actionBtnText, { color: c.danger }]}>Cancelar pedido</Text>
                    </TouchableOpacity>
                  )}
                  {isAdmin && (
                    <TouchableOpacity
                      style={[s.deleteActionBtn, actionLoading && s.btnDisabled]}
                      onPress={deleteOrder}
                      disabled={actionLoading}
                    >
                      <Ionicons name="trash-outline" size={14} color="#9ca3af" />
                      <Text style={s.deleteActionBtnText}>Eliminar pedido</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )
          }
        </View>
      )}

      {/* Modals */}
      {payOpen && (
        <PayModal
          order={order}
          onClose={() => setPayOpen(false)}
          onRefresh={() => { refreshOrder(); onToggle() }}
        />
      )}
      {addOpen && (
        <ProductPickerModal
          visible={addOpen}
          title="Agregar al pedido"
          confirmLabel="Agregar al pedido"
          onClose={() => setAddOpen(false)}
          onConfirm={async (items: PickedItem[]) => {
            const apiItems = items.map((i) => ({
              productId: i.productId ?? undefined,
              customName: i.productId ? undefined : i.name,
              customPrice: i.productId ? undefined : i.unitPrice,
              quantity: i.quantity,
              notes: i.notes || undefined,
              modifiers: i.modifiers.map((m) => ({
                groupName: m.groupName,
                modifierName: m.modifierName,
                priceDelta: m.priceDelta,
              })),
            }))
            try {
              await api.patch(`/api/tenant/orders/${order.id}`, { action: 'add_items', items: apiItems })
            } catch (err: any) {
              const isNetErr = !isConnected || err?.status === 0 || err?.message?.includes('Network request failed')
              if (isNetErr) {
                enqueueSync('add_order_items', { orderId: order.id, items: apiItems })
                Alert.alert('Sin conexión', 'Los productos se agregarán al reconectar.')
              } else {
                Alert.alert('Error', err.message ?? 'No se pudo agregar el producto')
                throw err
              }
            }
            try {
              const res = await api.get<{ data: Order }>(`/api/tenant/orders/${order.id}`)
              if (res.data) setOrder(res.data)
            } catch {}
            setAddOpen(false)
            onRefresh()
          }}
        />
      )}
    </View>
  )
}

function makeCardStyles(c: ReturnType<typeof useAppColors>) {
  return StyleSheet.create({
    cardWrap: {
      backgroundColor: c.surface, marginHorizontal: 12, marginTop: 10,
      borderRadius: 12, overflow: 'hidden',
      shadowColor: c.shadow, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
      borderWidth: 1, borderColor: 'transparent',
    },
    row: { flexDirection: 'row', padding: 14, alignItems: 'flex-start' },
    rowOrigin: { fontSize: 16, fontWeight: '700', color: c.text },
    rowMeta:   { fontSize: 12, color: c.textMuted, marginTop: 2 },
    rowItems:  { fontSize: 12, color: c.textMuted, marginTop: 4 },
    rowTotal:  { fontSize: 15, fontWeight: '700', color: c.text },
    badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
    badgeText: { fontSize: 11, fontWeight: '600' },

    detail: { borderTopWidth: 1, borderTopColor: c.border },

    infoSection: { padding: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: c.border },
    meta: { fontSize: 13, color: c.textSecondary, marginBottom: 3 },

    itemsSection: { padding: 14, borderBottomWidth: 1, borderBottomColor: c.border },
    sectionTitle: { fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
    itemRow:   { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5, gap: 8 },
    itemQty:   { fontSize: 14, fontWeight: '700', minWidth: 26 },
    itemName:  { fontSize: 14, fontWeight: '600', color: c.text },
    itemMods:  { fontSize: 12, color: c.textMuted, marginTop: 2 },
    itemTotal: { fontSize: 13, fontWeight: '600', color: c.textSecondary },

    totalRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: c.border },
    totalLabel:{ fontSize: 14, fontWeight: '600', color: c.textSecondary },
    totalValue:{ fontSize: 20, fontWeight: '800' },

    notesInput: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 13, minHeight: 60, textAlignVertical: 'top' },
    notesSaveBtn: { flex: 1, borderRadius: 8, padding: 9, alignItems: 'center' },
    notesCancelBtn: { flex: 1, borderRadius: 8, padding: 9, alignItems: 'center', borderWidth: 1, borderColor: '#d1d5db' },
    notesSaveBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },

    actions: { padding: 14, gap: 8 },
    actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, padding: 12 },
    actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    cancelActionBtn: { borderWidth: 1, borderColor: c.danger, borderRadius: 10, padding: 12, alignItems: 'center', backgroundColor: c.dangerLight },
    deleteActionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, padding: 8 },
    deleteActionBtnText: { fontSize: 12, color: '#9ca3af', fontWeight: '500' },
    btnDisabled: { opacity: 0.5 },
  })
}

// ─── Pantalla principal ───────────────────────────────────────────────────────

export default function PedidosScreen() {
  const c = useAppColors()
  const s = makePedidosStyles(c)
  const qc = useQueryClient()
  const { tenant, user } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'

  const [mode, setMode]         = useState<'active' | 'historial'>('active')
  const [activeTab, setActiveTab] = useState<OrderStatus | 'all'>('all')
  const [histTab, setHistTab]   = useState<'all' | 'cancelled'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [hFilterMethod, setHFilterMethod] = useState<string | null>(null)
  const [hFilterType,   setHFilterType]   = useState<string | null>(null)

  const activeQuery = useQuery({
    queryKey: ['orders', 'active'],
    queryFn: async () => {
      try {
        const orders = await api.get<{ data: Order[] }>('/api/tenant/orders').then((r) => r.data ?? [])
        saveActiveOrdersToCache(orders)
        return orders
      } catch {
        const cached = getActiveOrdersFromCache()
        if (cached) return cached
        throw new Error('Sin conexión y sin datos guardados')
      }
    },
    initialData: () => getActiveOrdersFromCache() ?? undefined,
    initialDataUpdatedAt: 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    enabled: mode === 'active',
  })

  const historialQuery = useQuery({
    queryKey: ['orders', 'historial'],
    queryFn: () => api.get<{ data: Order[] }>('/api/tenant/orders?historial=true').then((r) => r.data ?? []),
    enabled: mode === 'historial',
    staleTime: 60_000,
  })

  const activeOrders    = activeQuery.data ?? []
  const historialOrders = historialQuery.data ?? []

  const isLoading    = mode === 'active' ? activeQuery.isLoading : historialQuery.isLoading
  const isError      = mode === 'active' ? activeQuery.isError : historialQuery.isError
  const isRefetching = mode === 'active' ? activeQuery.isRefetching : historialQuery.isRefetching
  const refetch      = mode === 'active' ? activeQuery.refetch : historialQuery.refetch

  // Notificar al mesero cuando un pedido pasa a "listo"
  const knownReadyIds = useRef(new Set<string>())
  const readyInitDone = useRef(false)
  useEffect(() => {
    if (!activeQuery.data) return
    const currentReady = new Set(activeOrders.filter((o) => o.status === 'ready').map((o) => o.id))
    if (readyInitDone.current && ['mesero', 'admin'].includes(user?.role ?? '')) {
      const newReady = [...currentReady].filter((id) => !knownReadyIds.current.has(id))
      if (newReady.length > 0) Vibration.vibrate([0, 300, 100, 300])
    }
    knownReadyIds.current = currentReady
    readyInitDone.current = true
  }, [activeQuery.data])

  const completedOrders = historialOrders.filter((o) => o.status !== 'cancelled')
  const cancelledOrders = historialOrders.filter((o) => o.status === 'cancelled')

  const histBase = histTab === 'all' ? completedOrders : cancelledOrders
  const filteredHist = histBase.filter((o) => {
    if (hFilterMethod && o.paymentMethod !== hFilterMethod) return false
    if (hFilterType && o.type !== hFilterType) return false
    return true
  })

  const filtered = mode === 'active'
    ? (activeTab === 'all' ? activeOrders : activeOrders.filter((o) => o.status === activeTab))
    : filteredHist

  const refresh = useCallback(() => {
    if (mode === 'active') {
      qc.invalidateQueries({ queryKey: ['orders', 'active'] })
    } else {
      qc.invalidateQueries({ queryKey: ['orders', 'historial'] })
    }
    refetch()
  }, [qc, refetch, mode])

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  // Collapse when switching modes/tabs; reset historial filters when leaving historial
  useEffect(() => { setExpandedId(null) }, [mode, activeTab, histTab])
  useEffect(() => { if (mode !== 'historial') { setHFilterMethod(null); setHFilterType(null) } }, [mode])

  const tabs    = mode === 'active' ? ACTIVE_TABS : HIST_TABS
  const currTab = mode === 'active' ? activeTab : histTab
  const setTab  = mode === 'active'
    ? (k: any) => setActiveTab(k)
    : (k: any) => setHistTab(k)

  return (
    <View style={s.root}>
      {/* Mode toggle */}
      <View style={s.modeBar}>
        <TouchableOpacity
          style={[s.modeBtn, mode === 'active' && { backgroundColor: PRIMARY }]}
          onPress={() => setMode('active')}
        >
          <Text style={[s.modeBtnText, mode === 'active' && { color: c.textInverse }]}>En curso</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.modeBtn, mode === 'historial' && { backgroundColor: PRIMARY }]}
          onPress={() => setMode('historial')}
        >
          <Text style={[s.modeBtnText, mode === 'historial' && { color: c.textInverse }]}>Historial</Text>
        </TouchableOpacity>
      </View>

      {/* Status sub-tabs */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={s.tabContent}
      >
        {tabs.map((t) => {
          const count = mode === 'active'
            ? (t.key === 'all' ? activeOrders.length : activeOrders.filter((o) => o.status === t.key).length)
            : (t.key === 'all' ? completedOrders.length : cancelledOrders.length)
          const active = currTab === t.key
          return (
            <TouchableOpacity
              key={t.key}
              style={[s.tab, active && { backgroundColor: PRIMARY }]}
              onPress={() => setTab(t.key)}
            >
              <Text style={[s.tabText, active && { color: c.textInverse }]}>
                {t.label}{count > 0 ? ` (${count})` : ''}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {/* Filtros historial */}
      {mode === 'historial' && (
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          style={{ borderBottomWidth: 1, borderBottomColor: c.border }}
          contentContainerStyle={{ flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 8 }}
        >
          {[
            { label: 'Efectivo', value: 'cash', group: 'method' },
            { label: 'Nequi', value: 'nequi', group: 'method' },
            { label: 'Tarjeta', value: 'card', group: 'method' },
            { label: 'Transf.', value: 'transfer', group: 'method' },
          ].map((f) => {
            const active = hFilterMethod === f.value
            return (
              <TouchableOpacity
                key={f.value}
                onPress={() => setHFilterMethod(active ? null : f.value)}
                style={[s.filterChip, active && { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
              >
                <Text style={[s.filterChipText, active && { color: c.textInverse }]}>{f.label}</Text>
              </TouchableOpacity>
            )
          })}
          <View style={{ width: 1, backgroundColor: c.border, marginHorizontal: 2 }} />
          {[
            { label: 'Mesa', value: 'table' },
            { label: 'Barra', value: 'bar' },
            { label: 'Domicilio', value: 'delivery' },
            { label: 'Para llevar', value: 'takeout' },
          ].map((f) => {
            const active = hFilterType === f.value
            return (
              <TouchableOpacity
                key={f.value}
                onPress={() => setHFilterType(active ? null : f.value)}
                style={[s.filterChip, active && { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
              >
                <Text style={[s.filterChipText, active && { color: c.textInverse }]}>{f.label}</Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      )}

      {isLoading
        ? <View style={s.centered}><ActivityIndicator size="large" color={PRIMARY} /></View>
        : (isError && activeOrders.length === 0 && mode === 'active')
        ? <ErrorView message="Sin conexión y sin datos guardados. Conecta a internet para continuar." onRetry={refetch} />
        : (
          <FlatList
            data={filtered}
            keyExtractor={(o) => o.id}
            renderItem={({ item }) => (
              <OrderCard
                listOrder={item}
                expanded={expandedId === item.id}
                onToggle={() => toggleExpand(item.id)}
                onRefresh={refresh}
                readOnly={mode === 'historial'}
              />
            )}
            contentContainerStyle={s.list}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refresh} tintColor={PRIMARY} />}
            ListEmptyComponent={
              <View style={s.centered}>
                <Ionicons name="receipt-outline" size={48} color={c.border} />
                <Text style={s.emptyText}>
                  {mode === 'historial' ? 'Sin pedidos en el historial' : 'Sin pedidos en esta categoría'}
                </Text>
              </View>
            }
          />
        )
      }
    </View>
  )
}

function makePedidosStyles(c: ReturnType<typeof useAppColors>) {
  return StyleSheet.create({
    root:      { flex: 1, backgroundColor: c.background },
    centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
    emptyText: { color: c.textMuted, fontSize: 14 },
    list:      { paddingBottom: 24 },

    modeBar: {
      flexDirection: 'row', backgroundColor: c.surface,
      padding: 8, gap: 6,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    modeBtn: {
      flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
      backgroundColor: c.surfaceAlt,
    },
    modeBtnText: { fontSize: 13, fontWeight: '600', color: c.textSecondary },

    tabBar:    { backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border, flexShrink: 0 },
    tabContent:{ paddingHorizontal: 12, paddingVertical: 10, gap: 6, flexDirection: 'row', alignItems: 'center' },

    filterChip: {
      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16,
      borderWidth: 1.5, borderColor: c.border, backgroundColor: c.surface,
    },
    filterChipText: { fontSize: 12, fontWeight: '600', color: c.textSecondary },
    tab:       { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: c.surfaceAlt },
    tabText:   { fontSize: 13, color: c.textMuted, fontWeight: '600' },
  })
}
