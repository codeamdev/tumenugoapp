import { useState, useCallback, useEffect } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Modal, ScrollView, Alert, ActivityIndicator,
  RefreshControl, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '@/lib/api'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { enqueueSync } from '@/lib/offline/sync-queue'
import { useNetworkStatus } from '@/hooks/use-network'
import { ErrorView } from '@/components/ErrorView'
import { useAppColors } from '@/lib/theme'
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS, ORDER_TYPE_LABELS } from '@/types'
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

const HIST_TABS: { key: 'all' | 'closed' | 'cancelled'; label: string }[] = [
  { key: 'all',       label: 'Todos' },
  { key: 'closed',    label: 'Cerrados' },
  { key: 'cancelled', label: 'Cancelados' },
]

// ─── Fila de pedido ───────────────────────────────────────────────────────────

function OrderRow({ order, onPress }: { order: Order; onPress: () => void }) {
  const c = useAppColors()
  const s = makeOrderRowStyles(c)
  const { tenant } = useAuthStore()
  const color = ORDER_STATUS_COLORS[order.status] ?? '#6b7280'
  const label = ORDER_STATUS_LABELS[order.status] ?? order.status
  const sign  = tenant?.currencySign ?? '$'

  const origin = order.tableName
    ? `Mesa ${order.tableName}`
    : ORDER_TYPE_LABELS[order.type] ?? order.type

  return (
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={0.75}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowId}>{order.displayCode ?? `#${order.id.slice(-6).toUpperCase()}`}</Text>
        <Text style={s.rowMeta}>
          {origin}
          {order.customerName ? `  ·  ${order.customerName}` : ''}
          {order.createdAt ? `  ·  ${formatDateTime(order.createdAt)}` : ''}
        </Text>
        <Text style={s.rowItems}>{(order as any).itemsCount ?? order.items?.length ?? 0} producto(s)</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Text style={s.rowTotal}>{formatCurrency(parseFloat(order.total), sign)}</Text>
        <View style={[s.badge, { backgroundColor: color + '22' }]}>
          <Text style={[s.badgeText, { color }]}>{label}</Text>
        </View>
      </View>
    </TouchableOpacity>
  )
}

function makeOrderRowStyles(c: ReturnType<typeof useAppColors>) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row', backgroundColor: c.surface,
      marginHorizontal: 12, marginTop: 10, borderRadius: 12, padding: 14,
      shadowColor: c.shadow, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
    },
    rowId:    { fontSize: 15, fontWeight: '700', color: c.text },
    rowMeta:  { fontSize: 12, color: c.textMuted, marginTop: 2 },
    rowItems: { fontSize: 12, color: c.textMuted, marginTop: 4 },
    rowTotal: { fontSize: 15, fontWeight: '700', color: c.text },
    badge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
    badgeText:{ fontSize: 11, fontWeight: '600' },
  })
}

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
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const sign    = tenant?.currencySign ?? '$'
  const methods = config?.paymentMethods ?? [{ key: 'cash', label: 'Efectivo' }]

  const orderTotal = parseFloat(order.total)

  const [payments, setPayments] = useState<PaymentRow[]>([{ method: methods[0]?.key ?? 'cash', amount: '' }])
  const [tip, setTip]           = useState('')
  const [notes, setNotes]       = useState('')
  const [customerName, setCustomerName] = useState(order.customerName ?? '')
  const [loading, setLoading]   = useState(false)

  const tipNum      = parseFloat(tip) || 0
  const grandTotal  = orderTotal + tipNum
  const totalPaid   = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0)
  const remaining   = grandTotal - totalPaid
  const hasCash     = payments.some((p) => p.method === 'cash' && p.amount !== '')
  const isCredit    = !!(methods.find((m) => m.key === payments[0]?.method)?.isCredit)

  function updateRow(idx: number, field: keyof PaymentRow, value: string) {
    setPayments((prev) => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p))
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

    if (validPayments.length === 0) {
      Alert.alert('Sin monto', 'Ingresa al menos un monto de pago.')
      return
    }
    if (totalPaid < grandTotal - 0.01) {
      Alert.alert('Monto insuficiente', `Faltan ${formatCurrency(remaining, sign)} por cubrir.`)
      return
    }
    setLoading(true)
    try {
      await api.patch(`/api/tenant/orders/${order.id}`, {
        action: 'close',
        payments: validPayments,
        tipAmount: tipNum,
        paymentNotes: notes || undefined,
        customerName: isCredit ? customerName.trim() : undefined,
      })
      onRefresh()
      onClose()
    } catch (err: any) {
      Alert.alert('Error', err.message)
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
                {tipNum > 0 && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={s.payTotalLabel}>Propina</Text>
                    <Text style={[s.payTotalLabel, { color: c.text }]}>{formatCurrency(tipNum, sign)}</Text>
                  </View>
                )}
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <TextInput
                      style={[s.payInput, { flex: 1 }]}
                      keyboardType="numeric"
                      placeholder={`Monto (${sign})`}
                      placeholderTextColor={c.textMuted}
                      value={row.amount}
                      onChangeText={(v) => updateRow(idx, 'amount', v)}
                    />
                    {payments.length > 1 && (
                      <TouchableOpacity onPress={() => removeRow(idx)} style={s.removePayBtn}>
                        <Ionicons name="trash-outline" size={18} color={c.danger} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}

              <TouchableOpacity style={[s.addPayBtn, { borderColor: PRIMARY }]} onPress={addRow}>
                <Ionicons name="add-circle-outline" size={16} color={PRIMARY} />
                <Text style={[s.addPayBtnText, { color: PRIMARY }]}>Agregar método</Text>
              </TouchableOpacity>
            </View>

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

            {/* Propina */}
            <View style={{ gap: 8 }}>
              <Text style={s.payLabel}>Propina (opcional)</Text>
              <TextInput
                style={s.payInput}
                keyboardType="numeric"
                placeholder={`0 ${sign}`}
                placeholderTextColor={c.textMuted}
                value={tip}
                onChangeText={setTip}
              />
            </View>

            {/* Nombre del cliente — obligatorio para crédito */}
            {isCredit && (
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
            )}

            {/* Notas */}
            <View style={{ gap: 8 }}>
              <Text style={s.payLabel}>{isCredit ? 'Observaciones *' : 'Notas (opcional)'}</Text>
              <TextInput
                style={[s.payInput, { minHeight: 60, textAlignVertical: 'top' }]}
                placeholder={isCredit ? 'Motivo, plazo de pago, referencia...' : 'Observaciones del pago...'}
                placeholderTextColor={c.textMuted}
                value={notes}
                onChangeText={setNotes}
                multiline
              />
            </View>

            <TouchableOpacity
              style={[
                s.confirmBtn,
                { backgroundColor: isCredit ? '#d97706' : PRIMARY },
                (loading || (isCredit && (!customerName.trim() || !notes.trim()))) && s.btnDisabled,
              ]}
              onPress={confirm}
              disabled={loading || (isCredit && (!customerName.trim() || !notes.trim()))}
            >
              {loading
                ? <ActivityIndicator color={c.textInverse} />
                : <Text style={s.confirmBtnText}>{isCredit ? 'Registrar deuda' : 'Confirmar cobro'}</Text>}
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
    confirmBtn:  { borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
    confirmBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  })
}

// ─── Modal detalle ────────────────────────────────────────────────────────────

function DetailModal({ order: orderProp, onClose, onRefresh, onRefreshDetail, readOnly = false }: {
  order: Order | null
  onClose: () => void
  onRefresh: () => void
  onRefreshDetail?: () => Promise<void>
  readOnly?: boolean
}) {
  const c = useAppColors()
  const s = makeDetailStyles(c)
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const sign    = tenant?.currencySign ?? '$'

  const { isConnected } = useNetworkStatus()
  const [order, setOrder] = useState(orderProp)
  const [loading, setLoading]       = useState(false)
  const [payOpen, setPayOpen]       = useState(false)
  const [cancellingItem, setCancellingItem] = useState<string | null>(null)

  // Sync internal state when a different order is selected
  useEffect(() => { setOrder(orderProp) }, [orderProp?.id])

  if (!order) return null

  const color = ORDER_STATUS_COLORS[order.status] ?? '#6b7280'
  const label = ORDER_STATUS_LABELS[order.status] ?? order.status
  const canCancel     = !readOnly && !['closed', 'cancelled'].includes(order.status)
  const canDeliver    = !readOnly && order.status === 'ready'
  const canPay        = !readOnly && ['ready', 'delivered'].includes(order.status)
  const canAdvance    = !readOnly && ['new', 'sent', 'preparing'].includes(order.status)
  const canCancelItem = !readOnly && !['closed', 'cancelled'].includes(order.status)

  const ADVANCE_LABELS: Partial<Record<string, string>> = {
    new: 'Enviar a cocina',
    sent: 'Marcar preparando',
    preparing: 'Marcar listo',
  }

  const NEXT_STATUS: Record<string, string> = {
    new: 'sent', sent: 'preparing', preparing: 'ready',
  }

  function applyOptimisticStatus(status: string) {
    const next = status as OrderStatus
    setOrder((prev) => prev ? { ...prev, status: next } : prev)
    qc.setQueryData<Order[]>(['orders', 'active'], (old = []) =>
      old.map((o) => o.id === order!.id ? { ...o, status: next } : o)
    )
  }

  function rollbackStatus() {
    setOrder(orderProp)
    qc.invalidateQueries({ queryKey: ['orders'] })
  }

  async function advance(status: string) {
    applyOptimisticStatus(status)
    setLoading(true)
    try {
      await api.patch(`/api/tenant/orders/${order!.id}`, { status })
      onRefresh()
    } catch (err: any) {
      rollbackStatus()
      const isNetErr = !isConnected || err?.message?.includes('Network request failed')
      if (isNetErr) {
        applyOptimisticStatus(status) // re-apply: user sees queued state
        enqueueSync('update_order_status', { orderId: order!.id, status })
        Alert.alert('Sin conexión', 'El cambio se sincronizará cuando vuelva la conexión.')
        onClose()
      } else {
        Alert.alert('Error', err.message)
      }
    } finally { setLoading(false) }
  }

  async function cancel() {
    Alert.alert('Cancelar pedido', '¿Estás seguro?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Cancelar', style: 'destructive', onPress: async () => {
          applyOptimisticStatus('cancelled')
          setLoading(true)
          try {
            await api.patch(`/api/tenant/orders/${order!.id}`, { status: 'cancelled' })
            onRefresh(); onClose()
          } catch (err: any) {
            rollbackStatus()
            const isNetErr = !isConnected || err?.message?.includes('Network request failed')
            if (isNetErr) {
              applyOptimisticStatus('cancelled')
              enqueueSync('update_order_status', { orderId: order!.id, status: 'cancelled' })
              Alert.alert('Sin conexión', 'La cancelación se sincronizará cuando vuelva la conexión.')
              onClose()
            } else {
              Alert.alert('Error', err.message)
            }
          } finally { setLoading(false) }
        },
      },
    ])
  }

  async function cancelItem(itemId: string, itemName: string) {
    Alert.alert(
      'Quitar producto',
      `¿Cancelar "${itemName}" de este pedido?`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Quitar', style: 'destructive', onPress: async () => {
            // Optimistic: mark item cancelled immediately
            setOrder((prev) => prev ? {
              ...prev,
              items: prev.items?.map((it) =>
                it.id === itemId ? { ...it, status: 'cancelled' as any } : it
              ),
            } : prev)
            setCancellingItem(itemId)
            try {
              await api.delete(`/api/tenant/orders/${order!.id}/items/${itemId}`)
              if (onRefreshDetail) await onRefreshDetail()
              onRefresh()
            } catch (err: any) {
              // Rollback item cancel
              setOrder(orderProp)
              const isNetErr = !isConnected || err?.message?.includes('Network request failed')
              if (isNetErr) {
                enqueueSync('cancel_item', { orderId: order!.id, itemId })
                Alert.alert('Sin conexión', 'La cancelación se sincronizará cuando vuelva la conexión.')
                onClose()
              } else {
                Alert.alert('Error', err.message ?? 'No se pudo cancelar el producto')
              }
            } finally {
              setCancellingItem(null)
            }
          },
        },
      ]
    )
  }

  return (
    <>
      <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <SafeAreaView style={s.detailRoot}>
          <View style={s.detailHeader}>
            <Text style={s.detailTitle}>
              {order.displayCode ?? `Pedido #${order.id.slice(-6).toUpperCase()}`}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            <View style={s.detailSection}>
              <View style={[s.badge, { backgroundColor: color + '22', alignSelf: 'flex-start', marginBottom: 10 }]}>
                <Text style={[s.badgeText, { color }]}>{label}</Text>
              </View>
              <Text style={s.meta}>Tipo: {ORDER_TYPE_LABELS[order.type] ?? order.type}</Text>
              {order.tableName    && <Text style={s.meta}>Mesa: {order.tableName}</Text>}
              {order.customerName && <Text style={s.meta}>Cliente: {order.customerName}</Text>}
              {order.createdAt    && <Text style={s.meta}>Hora: {formatDateTime(order.createdAt)}</Text>}
              {order.notes        && <Text style={s.meta}>Nota: {order.notes}</Text>}
            </View>

            {order.items && order.items.length > 0 && (
              <View style={s.detailSection}>
                <Text style={s.detailSectionTitle}>Productos</Text>
                {order.items.map((item) => {
                  const name = (item.productSnapshot as any)?.name ?? 'Producto'
                  const isCancelled  = item.status === 'cancelled'
                  const isCancelling = cancellingItem === item.id
                  return (
                    <View key={item.id} style={[s.detailItem, isCancelled && s.detailItemCancelled]}>
                      <Text style={[s.detailQty, { color: isCancelled ? c.textMuted : PRIMARY }]}>
                        {item.quantity}×
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.detailName, isCancelled && { color: c.textMuted, textDecorationLine: 'line-through' }]}>
                          {name}
                        </Text>
                        {Array.isArray(item.modifierSnapshot) && item.modifierSnapshot.length > 0 && (
                          <Text style={s.detailMods}>
                            {(item.modifierSnapshot as any[]).map((m) => m.modifierName).join(' · ')}
                          </Text>
                        )}
                        {item.notes ? <Text style={[s.detailMods, { color: '#f97316' }]}>⚠ {item.notes}</Text> : null}
                        {isCancelled && <Text style={s.cancelledTag}>Cancelado</Text>}
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <Text style={[s.detailItemTotal, isCancelled && { color: c.textMuted, textDecorationLine: 'line-through' }]}>
                          {formatCurrency(parseFloat(item.itemTotal), sign)}
                        </Text>
                        {canCancelItem && !isCancelled && (
                          isCancelling
                            ? <ActivityIndicator size="small" color={c.danger} />
                            : (
                              <TouchableOpacity
                                style={s.itemCancelBtn}
                                onPress={() => cancelItem(item.id, name)}
                              >
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

            <View style={[s.detailSection, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: c.textSecondary }}>Total</Text>
              <Text style={{ fontSize: 22, fontWeight: '800', color: c.text }}>
                {formatCurrency(parseFloat(order.total), sign)}
              </Text>
            </View>
          </ScrollView>

          {!readOnly && (
            <View style={s.detailFooter}>
              {canAdvance && (
                <TouchableOpacity
                  style={[s.advBtn, { backgroundColor: PRIMARY }, loading && s.btnDisabled]}
                  onPress={() => advance(NEXT_STATUS[order.status])}
                  disabled={loading}
                >
                  {loading
                    ? <ActivityIndicator color={c.textInverse} />
                    : <Text style={s.advBtnText}>{ADVANCE_LABELS[order.status] ?? 'Avanzar'}</Text>}
                </TouchableOpacity>
              )}

              {canDeliver && (
                <TouchableOpacity
                  style={[s.advBtn, { backgroundColor: '#10b981' }, loading && s.btnDisabled]}
                  onPress={() => advance('delivered')}
                  disabled={loading}
                >
                  <Ionicons name="checkmark-circle-outline" size={18} color={c.textInverse} />
                  <Text style={s.advBtnText}>Entregar</Text>
                </TouchableOpacity>
              )}

              {canPay && (
                <TouchableOpacity
                  style={[s.advBtn, { backgroundColor: '#059669' }, loading && s.btnDisabled]}
                  onPress={() => setPayOpen(true)}
                  disabled={loading}
                >
                  <Ionicons name="cash-outline" size={18} color={c.textInverse} />
                  <Text style={s.advBtnText}>Cobrar</Text>
                </TouchableOpacity>
              )}

              {canCancel && (
                <TouchableOpacity
                  style={[s.cancelBtn, loading && s.btnDisabled]}
                  onPress={cancel}
                  disabled={loading}
                >
                  <Text style={s.cancelBtnText}>Cancelar pedido</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </SafeAreaView>
      </Modal>

      {payOpen && (
        <PayModal
          order={order}
          onClose={() => setPayOpen(false)}
          onRefresh={() => { onRefresh(); onClose() }}
        />
      )}
    </>
  )
}

function makeDetailStyles(c: ReturnType<typeof useAppColors>) {
  return StyleSheet.create({
    detailRoot: { flex: 1, backgroundColor: c.surface },
    detailHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingVertical: 16,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    detailTitle:  { fontSize: 18, fontWeight: '700', color: c.text },
    detailSection:{ padding: 20, borderBottomWidth: 1, borderBottomColor: c.background },
    detailSectionTitle: { fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 10, letterSpacing: 0.5 },
    meta:         { fontSize: 14, color: c.textSecondary, marginBottom: 3 },
    badge:        { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
    badgeText:    { fontSize: 11, fontWeight: '600' },
    detailItem:   { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6, gap: 8 },
    detailQty:    { fontSize: 14, fontWeight: '700', minWidth: 26 },
    detailName:   { fontSize: 14, fontWeight: '600', color: c.text },
    detailMods:   { fontSize: 12, color: c.textMuted, marginTop: 2 },
    detailItemTotal:    { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    detailItemCancelled:{ opacity: 0.6 },
    cancelledTag: { fontSize: 11, color: c.danger, fontWeight: '600', marginTop: 2 },
    itemCancelBtn:{ padding: 2 },
    detailFooter: { padding: 20, gap: 10, borderTopWidth: 1, borderTopColor: c.border },
    advBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      borderRadius: 12, padding: 14,
    },
    advBtnText:   { color: '#fff', fontWeight: '700', fontSize: 15 },
    cancelBtn:    { borderWidth: 1, borderColor: c.danger, borderRadius: 12, padding: 14, alignItems: 'center', backgroundColor: c.dangerLight },
    cancelBtnText:{ color: c.danger, fontWeight: '600', fontSize: 14 },
    btnDisabled:  { opacity: 0.5 },
  })
}

// ─── Pantalla principal ───────────────────────────────────────────────────────

export default function PedidosScreen() {
  const c = useAppColors()
  const s = makePedidosStyles(c)
  const qc = useQueryClient()
  const { tenant } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'

  const [mode, setMode]     = useState<'active' | 'historial'>('active')
  const [activeTab, setActiveTab] = useState<OrderStatus | 'all'>('all')
  const [histTab, setHistTab]     = useState<'all' | 'closed' | 'cancelled'>('all')
  const [selected, setSelected]   = useState<Order | null>(null)

  const activeQuery = useQuery({
    queryKey: ['orders', 'active'],
    queryFn: () => api.get<{ data: Order[] }>('/api/tenant/orders').then((r) => r.data ?? []),
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

  const filtered = mode === 'active'
    ? (activeTab === 'all' ? activeOrders : activeOrders.filter((o) => o.status === activeTab))
    : (histTab === 'all' ? historialOrders : historialOrders.filter((o) => o.status === histTab))

  async function openDetail(order: Order) {
    try {
      const res = await api.get<{ data: Order }>(`/api/tenant/orders/${order.id}`)
      setSelected(res.data)
    } catch {
      setSelected(order)
    }
  }

  async function refreshDetail() {
    if (!selected) return
    try {
      const res = await api.get<{ data: Order }>(`/api/tenant/orders/${selected.id}`)
      setSelected(res.data)
    } catch {}
  }

  const refresh = useCallback(() => {
    if (mode === 'active') {
      qc.invalidateQueries({ queryKey: ['orders', 'active'] })
    } else {
      qc.invalidateQueries({ queryKey: ['orders', 'historial'] })
    }
    refetch()
  }, [qc, refetch, mode])

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
          const count  = t.key === 'all'
            ? (mode === 'active' ? activeOrders : historialOrders).length
            : (mode === 'active' ? activeOrders : historialOrders).filter((o) => o.status === t.key).length
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

      {isLoading
        ? <View style={s.centered}><ActivityIndicator size="large" color={PRIMARY} /></View>
        : isError
        ? <ErrorView message="No se pudieron cargar los pedidos." onRetry={refetch} />
        : (
          <FlatList
            data={filtered}
            keyExtractor={(o) => o.id}
            renderItem={({ item }) => <OrderRow order={item} onPress={() => openDetail(item)} />}
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

      <DetailModal
        order={selected}
        onClose={() => setSelected(null)}
        onRefresh={refresh}
        onRefreshDetail={refreshDetail}
        readOnly={mode === 'historial'}
      />
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

    tabBar:    { backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border },
    tabContent:{ paddingHorizontal: 12, paddingVertical: 10, gap: 6, flexDirection: 'row', alignItems: 'center' },
    tab:       { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: c.surfaceAlt },
    tabText:   { fontSize: 13, color: c.textMuted, fontWeight: '600' },
  })
}
