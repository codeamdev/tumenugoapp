import { useState } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
  RefreshControl, Modal, TextInput, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
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

const ZONES = ['Salón', 'Terraza', 'Barra', 'VIP', 'Privado']

function TableCard({
  table, isAdmin, onUpdate, onEdit, c,
}: {
  table: Table
  isAdmin: boolean
  onUpdate: () => void
  onEdit: (t: Table) => void
  c: ReturnType<typeof import('@/lib/theme').useAppColors>
}) {
  const cfg = STATUS_CONFIG[table.status as TableStatus] ?? STATUS_CONFIG.available
  const { isConnected } = useNetworkStatus()
  const qc = useQueryClient()

  async function cycle() {
    const next = cfg.next
    qc.setQueryData<Table[]>(['tables'], (old = []) =>
      old.map((t) => t.id === table.id ? { ...t, status: next } : t)
    )
    try {
      await api.patch(`/api/tenant/tables/${table.id}`, { status: next })
      onUpdate()
    } catch (err: any) {
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

  function handleLongPress() {
    if (!isAdmin) return
    Alert.alert(`Mesa ${table.name}`, 'Selecciona una acción', [
      { text: 'Editar', onPress: () => onEdit(table) },
      { text: 'Eliminar', style: 'destructive', onPress: () => confirmDelete(table) },
      { text: 'Cancelar', style: 'cancel' },
    ])
  }

  async function confirmDelete(t: Table) {
    Alert.alert(
      'Eliminar mesa',
      `¿Eliminar Mesa ${t.name}? Esta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar', style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/api/tenant/tables/${t.id}`)
              qc.invalidateQueries({ queryKey: ['tables'] })
            } catch (err: any) {
              Alert.alert('Error', err.message ?? 'No se pudo eliminar')
            }
          },
        },
      ]
    )
  }

  const s = makeStyles(c)

  return (
    <TouchableOpacity
      style={[s.card, { borderLeftColor: cfg.color }]}
      onPress={cycle}
      onLongPress={handleLongPress}
      activeOpacity={0.75}
      delayLongPress={400}
    >
      <View style={{ flex: 1 }}>
        <Text style={s.tableName}>Mesa {table.name}</Text>
        {table.zone ? <Text style={s.tableSub}>{table.zone}</Text> : null}
        {table.capacity ? <Text style={s.tableSub}>{table.capacity} personas</Text> : null}
      </View>
      <View style={[s.badge, { backgroundColor: cfg.bg }]}>
        <Text style={[s.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
      </View>
      {isAdmin && (
        <TouchableOpacity onPress={() => onEdit(table)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginLeft: 8 }}>
          <Ionicons name="pencil-outline" size={16} color={c.textMuted} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  )
}

export default function MesasScreen() {
  const qc = useQueryClient()
  const { tenant, user } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const c = useAppColors()
  const s = makeStyles(c)
  const { isConnected } = useNetworkStatus()
  const isAdmin = user?.role === 'admin'

  const [showModal, setShowModal]     = useState(false)
  const [editing, setEditing]         = useState<Table | null>(null)
  const [form, setForm]               = useState({ name: '', capacity: '4', zone: 'Salón' })
  const [saving, setSaving]           = useState(false)

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

  function openCreate() {
    setEditing(null)
    setForm({ name: '', capacity: '4', zone: 'Salón' })
    setShowModal(true)
  }

  function openEdit(t: Table) {
    setEditing(t)
    setForm({
      name:     t.name,
      capacity: String(t.capacity ?? 4),
      zone:     t.zone ?? 'Salón',
    })
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { Alert.alert('Error', 'El nombre es requerido'); return }
    const cap = parseInt(form.capacity)
    if (isNaN(cap) || cap < 1) { Alert.alert('Error', 'Capacidad inválida'); return }
    if (!isConnected) { Alert.alert('Sin conexión', 'Se requiere conexión para gestionar mesas'); return }
    setSaving(true)
    try {
      const body = { name: form.name.trim(), capacity: cap, zone: form.zone }
      if (editing) {
        await api.patch(`/api/tenant/tables/${editing.id}`, body)
      } else {
        await api.post('/api/tenant/tables', body)
      }
      qc.invalidateQueries({ queryKey: ['tables'] })
      setShowModal(false)
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  const available = tables.filter((t) => t.status === 'available').length
  const occupied  = tables.filter((t) => t.status === 'occupied').length

  if (isLoading) {
    return <View style={s.centered}><ActivityIndicator size="large" color={PRIMARY} /></View>
  }

  return (
    <SafeAreaView style={s.root} edges={['bottom']}>
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
        {isAdmin && (
          <Text style={[s.counterText, { marginLeft: 'auto', color: c.textMuted, fontSize: 11 }]}>
            Mantén pulsado para editar
          </Text>
        )}
      </View>

      <FlatList
        data={tables}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => (
          <TableCard table={item} isAdmin={isAdmin} onUpdate={onUpdate} onEdit={openEdit} c={c} />
        )}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={PRIMARY} />}
        ListEmptyComponent={
          <View style={s.centered}>
            <Ionicons name="grid-outline" size={48} color={c.border} />
            <Text style={s.emptyText}>No hay mesas configuradas</Text>
            {isAdmin && (
              <TouchableOpacity style={[s.emptyBtn, { backgroundColor: PRIMARY }]} onPress={openCreate}>
                <Text style={{ color: '#fff', fontWeight: '600' }}>+ Crear mesa</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

      {/* FAB */}
      {isAdmin && (
        <TouchableOpacity
          style={[s.fab, { backgroundColor: PRIMARY }]}
          onPress={openCreate}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Modal crear / editar */}
      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowModal(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[s.modalHeader, { borderBottomColor: c.border }]}>
              <Text style={[s.modalTitle, { color: c.text }]}>
                {editing ? 'Editar mesa' : 'Nueva mesa'}
              </Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={24} color={c.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={s.modalBody} keyboardShouldPersistTaps="handled">

              <Text style={[s.fieldLabel, { color: c.textSecondary }]}>Nombre / Número *</Text>
              <TextInput
                style={[s.fieldInput, { color: c.text, borderColor: c.border, backgroundColor: c.surfaceAlt }]}
                placeholder="Ej: 1, A, Terraza-1"
                placeholderTextColor={c.textMuted}
                value={form.name}
                onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                autoFocus
              />

              <Text style={[s.fieldLabel, { color: c.textSecondary, marginTop: 16 }]}>Capacidad (personas)</Text>
              <TextInput
                style={[s.fieldInput, { color: c.text, borderColor: c.border, backgroundColor: c.surfaceAlt, width: 100 }]}
                placeholder="4"
                placeholderTextColor={c.textMuted}
                value={form.capacity}
                onChangeText={(v) => setForm((f) => ({ ...f, capacity: v }))}
                keyboardType="number-pad"
              />

              <Text style={[s.fieldLabel, { color: c.textSecondary, marginTop: 16 }]}>Zona</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }} contentContainerStyle={{ gap: 8 }}>
                {ZONES.map((z) => {
                  const sel = form.zone === z
                  return (
                    <TouchableOpacity
                      key={z}
                      style={[s.chip, { borderColor: sel ? PRIMARY : c.border, backgroundColor: sel ? PRIMARY : c.surfaceAlt }]}
                      onPress={() => setForm((f) => ({ ...f, zone: z }))}
                    >
                      <Text style={[s.chipText, { color: sel ? '#fff' : c.textSecondary }]}>{z}</Text>
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>
              <TextInput
                style={[s.fieldInput, { color: c.text, borderColor: c.border, backgroundColor: c.surfaceAlt, marginTop: 8 }]}
                placeholder="O escribe una zona personalizada"
                placeholderTextColor={c.textMuted}
                value={form.zone}
                onChangeText={(v) => setForm((f) => ({ ...f, zone: v }))}
              />

              <TouchableOpacity
                style={[s.saveBtn, { backgroundColor: PRIMARY, marginTop: 32 }, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.saveBtnText}>{editing ? 'Guardar cambios' : 'Crear mesa'}</Text>}
              </TouchableOpacity>

            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

function makeStyles(c: ReturnType<typeof import('@/lib/theme').useAppColors>) {
  return StyleSheet.create({
    root:    { flex: 1, backgroundColor: c.background },
    centered:{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
    emptyText: { color: c.textMuted, fontSize: 14 },
    emptyBtn:  { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, marginTop: 8 },

    topBar: {
      flexDirection: 'row', alignItems: 'center', gap: 20,
      paddingHorizontal: 16, paddingVertical: 12,
      backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.surfaceAlt,
    },
    counter:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot:         { width: 10, height: 10, borderRadius: 5 },
    counterText: { fontSize: 13, color: c.textSecondary },

    list: { padding: 12, gap: 10, paddingBottom: 100 },
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

    fab: {
      position: 'absolute', bottom: 24, right: 20,
      width: 56, height: 56, borderRadius: 28,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
    },

    modalHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1,
    },
    modalTitle:  { fontSize: 18, fontWeight: '700' },
    modalBody:   { padding: 20 },

    fieldLabel: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
    fieldInput: {
      borderWidth: 1, borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: 10,
      fontSize: 15,
    },

    chip:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
    chipText: { fontSize: 13, fontWeight: '500' },

    saveBtn:     { borderRadius: 12, padding: 16, alignItems: 'center' },
    saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  })
}
