import { useState, useEffect } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Switch, Alert,
  ActivityIndicator, RefreshControl, Modal, SafeAreaView, ScrollView,
  TextInput, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useNetworkStatus } from '@/hooks/use-network'
import { useAppColors } from '@/lib/theme'
import type { UserRole } from '@/types'

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador', cajero: 'Cajero', mesero: 'Mesero', cocina: 'Cocina',
}
const ROLE_COLORS: Record<UserRole, string> = {
  admin: '#7c3aed', cajero: '#2563eb', mesero: '#10b981', cocina: '#f59e0b',
}
const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin:   'Acceso total al sistema',
  cajero:  'POS completo, caja y cierre',
  mesero:  'Tomar pedidos y ver menú',
  cocina:  'Ver y actualizar pedidos en cocina',
}

interface User {
  id: string
  name: string | null
  email: string
  role: UserRole
  isActive: boolean
}

// ─── Fila usuario ─────────────────────────────────────────────────────────────

function UserRow({ user, currentUserId, onEdit, onDelete, onUpdate, isConnected, c }: {
  user: User
  currentUserId: string
  onEdit: (u: User) => void
  onDelete: (u: User) => void
  onUpdate: () => void
  isConnected: boolean
  c: ReturnType<typeof import('@/lib/theme').useAppColors>
}) {
  const { tenant } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const roleColor = ROLE_COLORS[user.role] ?? '#6b7280'
  const isSelf = user.id === currentUserId
  const s = makeStyles(c)

  async function toggleActive(val: boolean) {
    if (!isConnected) {
      Alert.alert('Sin conexión', 'La gestión de usuarios requiere conexión a internet.')
      return
    }
    try {
      await api.patch(`/api/tenant/users/${user.id}`, { isActive: val })
      onUpdate()
    } catch (err: any) {
      Alert.alert('Error', err.message)
    }
  }

  return (
    <View style={[s.row, !user.isActive && s.rowInactive]}>
      <View style={[s.avatar, { backgroundColor: roleColor + '18' }]}>
        <Text style={[s.avatarLetter, { color: roleColor }]}>
          {(user.name ?? user.email)[0].toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.userName, !user.isActive && s.textMuted]}>{user.name ?? '—'}</Text>
        <Text style={s.userEmail}>{user.email}</Text>
        <View style={[s.roleBadge, { backgroundColor: roleColor + '18' }]}>
          <Text style={[s.roleBadgeText, { color: roleColor }]}>{ROLE_LABELS[user.role]}</Text>
        </View>
      </View>
      <View style={s.rowActions}>
        <TouchableOpacity style={s.iconBtn} onPress={() => onEdit(user)}>
          <Ionicons name="pencil-outline" size={16} color={c.textMuted} />
        </TouchableOpacity>
        {!isSelf && (
          <TouchableOpacity style={[s.iconBtn, s.iconBtnRed]} onPress={() => onDelete(user)}>
            <Ionicons name="trash-outline" size={15} color={c.danger} />
          </TouchableOpacity>
        )}
        <Switch
          value={user.isActive}
          onValueChange={toggleActive}
          disabled={isSelf}
          trackColor={{ false: c.border, true: PRIMARY + '60' }}
          thumbColor={user.isActive ? PRIMARY : c.textMuted}
        />
      </View>
    </View>
  )
}

// ─── Modal crear/editar usuario ───────────────────────────────────────────────

interface UserForm {
  name: string
  email: string
  password: string
  role: UserRole
}

function UserModal({ visible, editing, onClose, onDone, isConnected, c }: {
  visible: boolean
  editing: User | null
  onClose: () => void
  onDone: () => void
  isConnected: boolean
  c: ReturnType<typeof import('@/lib/theme').useAppColors>
}) {
  const { tenant } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const s = makeStyles(c)

  const [form, setForm] = useState<UserForm>({ name: '', email: '', password: '', role: 'mesero' })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (visible) {
      setForm(editing
        ? { name: editing.name ?? '', email: editing.email, password: '', role: editing.role }
        : { name: '', email: '', password: '', role: 'mesero' }
      )
    }
  }, [visible, editing])

  const isEdit = !!editing

  async function submit() {
    if (!isConnected) {
      Alert.alert('Sin conexión', 'La gestión de usuarios requiere conexión a internet.')
      return
    }
    if (!form.name || !form.email) {
      Alert.alert('Error', 'Nombre y correo son obligatorios')
      return
    }
    if (!isEdit && !form.password) {
      Alert.alert('Error', 'La contraseña es obligatoria')
      return
    }
    setLoading(true)
    try {
      const body: Record<string, unknown> = {
        name: form.name, email: form.email, role: form.role,
      }
      if (form.password) body.password = form.password

      if (isEdit) {
        await api.patch(`/api/tenant/users/${editing!.id}`, body)
      } else {
        await api.post('/api/tenant/users', body)
      }
      onDone()
    } catch (err: any) {
      Alert.alert('Error', err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet">
      <SafeAreaView style={s.modalRoot}>
        <View style={s.modalHeader}>
          <Text style={s.modalTitle}>{isEdit ? 'Editar usuario' : 'Nuevo usuario'}</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={c.textSecondary} />
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={s.modalBody}>
            <Text style={s.label}>Nombre completo *</Text>
            <TextInput
              style={s.input}
              value={form.name}
              onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
              placeholder="María García"
              placeholderTextColor={c.textMuted}
            />

            <Text style={s.label}>Correo electrónico *</Text>
            <TextInput
              style={s.input}
              value={form.email}
              onChangeText={(v) => setForm((f) => ({ ...f, email: v }))}
              placeholder="maria@cafeteria.com"
              placeholderTextColor={c.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={s.label}>
              {isEdit ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña *'}
            </Text>
            <TextInput
              style={s.input}
              value={form.password}
              onChangeText={(v) => setForm((f) => ({ ...f, password: v }))}
              placeholder={isEdit ? '••••••••' : 'Mínimo 6 caracteres'}
              placeholderTextColor={c.textMuted}
              secureTextEntry
            />

            <Text style={s.label}>Rol *</Text>
            <View style={s.roleGrid}>
              {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => {
                const active = form.role === r
                const color  = ROLE_COLORS[r]
                return (
                  <TouchableOpacity
                    key={r}
                    style={[s.roleChip, active && { backgroundColor: color, borderColor: color }]}
                    onPress={() => setForm((f) => ({ ...f, role: r }))}
                  >
                    <Text style={[s.roleChipText, active && { color: c.textInverse }]}>{ROLE_LABELS[r]}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
            <Text style={s.roleHint}>{ROLE_DESCRIPTIONS[form.role]}</Text>

            <TouchableOpacity
              style={[s.submitBtn, { backgroundColor: PRIMARY }, loading && s.btnDisabled]}
              onPress={submit}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.submitBtnText}>{isEdit ? 'Guardar cambios' : 'Crear usuario'}</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
              <Text style={s.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

// ─── Pantalla principal ───────────────────────────────────────────────────────

export default function UsuariosScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const { user: currentUser, tenant } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const c = useAppColors()
  const s = makeStyles(c)

  useEffect(() => {
    if (currentUser && currentUser.role !== 'admin') router.back()
  }, [currentUser?.role])

  const [modalVisible, setModalVisible] = useState(false)
  const [editingUser, setEditingUser]   = useState<User | null>(null)

  const { isConnected } = useNetworkStatus()

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['users'],
    queryFn:  () => api.get<{ data: User[] }>('/api/tenant/users').then((r) => r.data ?? []),
    gcTime: 24 * 60 * 60 * 1000,
  })

  const users = data ?? []

  function onUpdate() {
    qc.invalidateQueries({ queryKey: ['users'] })
    refetch()
  }

  function openCreate() {
    setEditingUser(null)
    setModalVisible(true)
  }

  function openEdit(user: User) {
    setEditingUser(user)
    setModalVisible(true)
  }

  function confirmDelete(user: User) {
    if (!isConnected) {
      Alert.alert('Sin conexión', 'La gestión de usuarios requiere conexión a internet.')
      return
    }
    if (user.id === currentUser?.id) {
      Alert.alert('No permitido', 'No puedes eliminar tu propia cuenta.')
      return
    }
    Alert.alert(
      '¿Eliminar usuario?',
      `Se eliminará a "${user.name ?? user.email}". Esta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar', style: 'destructive', onPress: async () => {
            try {
              await api.delete(`/api/tenant/users/${user.id}`)
              onUpdate()
            } catch (err: any) {
              Alert.alert('Error', err.message)
            }
          },
        },
      ]
    )
  }

  if (isLoading) {
    return <View style={s.centered}><ActivityIndicator size="large" color={PRIMARY} /></View>
  }

  return (
    <View style={s.root}>
      {/* Stats bar */}
      <View style={s.topBar}>
        <View style={s.counter}>
          <View style={[s.dot, { backgroundColor: '#10b981' }]} />
          <Text style={s.counterText}>
            Activos: <Text style={{ fontWeight: '700' }}>{users.filter((u) => u.isActive).length}</Text>
          </Text>
        </View>
        <View style={s.counter}>
          <View style={[s.dot, { backgroundColor: c.textMuted }]} />
          <Text style={s.counterText}>
            Total: <Text style={{ fontWeight: '700' }}>{users.length}</Text>
          </Text>
        </View>
      </View>

      <FlatList
        data={users}
        keyExtractor={(u) => u.id}
        renderItem={({ item }) => (
          <UserRow
            user={item}
            currentUserId={currentUser?.id ?? ''}
            onEdit={openEdit}
            onDelete={confirmDelete}
            onUpdate={onUpdate}
            isConnected={isConnected}
            c={c}
          />
        )}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={PRIMARY} />}
        ListEmptyComponent={
          <View style={s.centered}>
            <Ionicons name="people-outline" size={48} color={c.border} />
            <Text style={s.emptyText}>Sin usuarios</Text>
          </View>
        }
        ListFooterComponent={<View style={{ height: 100 }} />}
      />

      {/* FAB */}
      <TouchableOpacity
        style={[s.fab, { backgroundColor: isConnected ? PRIMARY : c.textMuted }]}
        onPress={isConnected ? openCreate : () => Alert.alert('Sin conexión', 'La gestión de usuarios requiere conexión a internet.')}
      >
        <Ionicons name="person-add-outline" size={20} color="#fff" />
        <Text style={s.fabText}>Nuevo usuario</Text>
      </TouchableOpacity>

      <UserModal
        visible={modalVisible}
        editing={editingUser}
        onClose={() => { setModalVisible(false); setEditingUser(null) }}
        onDone={() => { setModalVisible(false); setEditingUser(null); onUpdate() }}
        isConnected={isConnected}
        c={c}
      />
    </View>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

function makeStyles(c: ReturnType<typeof import('@/lib/theme').useAppColors>) {
  return StyleSheet.create({
    root:    { flex: 1, backgroundColor: c.background },
    centered:{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
    emptyText: { color: c.textMuted, fontSize: 14 },
    list:    { paddingBottom: 32 },

    topBar: {
      flexDirection: 'row', gap: 20, paddingHorizontal: 16, paddingVertical: 12,
      backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.surfaceAlt,
    },
    counter:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot:         { width: 10, height: 10, borderRadius: 5 },
    counterText: { fontSize: 13, color: c.textSecondary },

    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: c.surface, paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: c.background,
    },
    rowInactive: { backgroundColor: c.surfaceAlt, opacity: 0.65 },
    rowActions:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
    iconBtn:     { padding: 8, borderRadius: 8, backgroundColor: c.surfaceAlt },
    iconBtnRed:  { backgroundColor: c.dangerLight },

    avatar: {
      width: 44, height: 44, borderRadius: 22,
      alignItems: 'center', justifyContent: 'center',
    },
    avatarLetter: { fontSize: 18, fontWeight: '700' },
    userName:     { fontSize: 15, fontWeight: '600', color: c.text },
    userEmail:    { fontSize: 12, color: c.textMuted, marginTop: 1 },
    textMuted:    { color: c.textMuted },
    roleBadge:    { alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, marginTop: 4 },
    roleBadgeText:{ fontSize: 11, fontWeight: '700' },

    fab: {
      position: 'absolute', bottom: 20, right: 16, left: 16,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      borderRadius: 14, padding: 14,
      shadowOpacity: 0.25, shadowRadius: 10, elevation: 6,
    },
    fabText: { color: c.textInverse, fontWeight: '700', fontSize: 15 },

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
      padding: 12, fontSize: 15, backgroundColor: c.surfaceAlt, color: c.text,
    },

    roleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    roleChip: {
      paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8,
      borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceAlt,
    },
    roleChipText: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    roleHint:     { fontSize: 12, color: c.textMuted, marginTop: -4 },

    submitBtn:     { borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 8 },
    submitBtnText: { color: c.textInverse, fontWeight: '700', fontSize: 15 },
    cancelBtn:     { borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.border },
    cancelBtnText: { color: c.textMuted, fontWeight: '600', fontSize: 15 },
    btnDisabled:   { opacity: 0.5 },
  })
}
