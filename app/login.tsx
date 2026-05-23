import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert, Modal, FlatList,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '@/stores/auth-store'
import { ApiError } from '@/lib/api'

// ─── Selector de tenant (cuando un usuario pertenece a varios tenants) ────────

interface TenantOption { id: string; name: string; slug: string }

function TenantPicker({
  tenants,
  onSelect,
  onCancel,
}: {
  tenants: TenantOption[]
  onSelect: (slug: string) => void
  onCancel: () => void
}) {
  return (
    <Modal visible animationType="slide" presentationStyle="formSheet">
      <View style={p.root}>
        <View style={p.header}>
          <Text style={p.title}>Selecciona tu negocio</Text>
          <TouchableOpacity onPress={onCancel}>
            <Ionicons name="close" size={24} color="#374151" />
          </TouchableOpacity>
        </View>
        <Text style={p.subtitle}>Tu correo está asociado a más de un establecimiento.</Text>
        <FlatList
          data={tenants}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={p.card} onPress={() => onSelect(item.slug)} activeOpacity={0.75}>
              <View style={p.cardIcon}>
                <Ionicons name="storefront-outline" size={22} color="#2563eb" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={p.cardName}>{item.name}</Text>
                <Text style={p.cardSlug}>{item.slug}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
            </TouchableOpacity>
          )}
        />
      </View>
    </Modal>
  )
}

const p = StyleSheet.create({
  root:     { flex: 1, backgroundColor: '#f8fafc' },
  header:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  title:    { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 14, color: '#64748b', paddingHorizontal: 20, paddingTop: 12 },
  card:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  cardIcon: { width: 42, height: 42, borderRadius: 10, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  cardSlug: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
})

// ─── Pantalla de login ────────────────────────────────────────────────────────

export default function LoginScreen() {
  const { login } = useAuthStore()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)

  // Multi-tenant picker state
  const [tenantOptions, setTenantOptions] = useState<TenantOption[] | null>(null)
  const [pendingCreds,  setPendingCreds]  = useState<{ email: string; password: string } | null>(null)

  async function handleLogin(slugOverride?: string) {
    const trimEmail = email.trim().toLowerCase()
    if (!trimEmail || !password) {
      Alert.alert('Campos requeridos', 'Ingresa tu correo y contraseña.')
      return
    }
    setLoading(true)
    try {
      await login({ email: trimEmail, password, tenantSlug: slugOverride })
    } catch (err) {
      if (err instanceof ApiError && err.status === 300) {
        // Multiple tenants — show picker
        const body = (err as any).body as { tenants: TenantOption[] }
        if (body?.tenants?.length) {
          setPendingCreds({ email: trimEmail, password })
          setTenantOptions(body.tenants)
          return
        }
      }
      const message = err instanceof ApiError ? err.message : 'Error de conexión.'
      Alert.alert('Error al iniciar sesión', message)
    } finally {
      setLoading(false)
    }
  }

  async function handleTenantSelect(slug: string) {
    setTenantOptions(null)
    if (!pendingCreds) return
    setEmail(pendingCreds.email)
    setPassword(pendingCreds.password)
    setLoading(true)
    try {
      await login({ email: pendingCreds.email, password: pendingCreds.password, tenantSlug: slug })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Error de conexión.'
      Alert.alert('Error al iniciar sesión', message)
    } finally {
      setLoading(false)
      setPendingCreds(null)
    }
  }

  return (
    <>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.logoBox}>
              <Text style={styles.logoEmoji}>☕</Text>
            </View>
            <Text style={styles.title}>Bienvenido</Text>
            <Text style={styles.subtitle}>Inicia sesión para continuar</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Correo electrónico</Text>
            <TextInput
              style={styles.input}
              placeholder="tu@correo.com"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="next"
              autoComplete="email"
            />

            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Contraseña</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={() => handleLogin()}
            />

            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={() => handleLogin()}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.btnText}>Iniciar sesión</Text>
              }
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {tenantOptions && (
        <TenantPicker
          tenants={tenantOptions}
          onSelect={handleTenantSelect}
          onCancel={() => { setTenantOptions(null); setPendingCreds(null) }}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#f1f5f9' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },

  header: { alignItems: 'center', marginBottom: 32 },
  logoBox: {
    width: 76, height: 76, borderRadius: 22,
    backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
    shadowColor: '#2563eb', shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
  },
  logoEmoji: { fontSize: 38 },
  title:    { fontSize: 26, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 14, color: '#64748b', marginTop: 4 },

  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 24,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 16, elevation: 4,
  },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10,
    padding: 12, fontSize: 15, color: '#0f172a', backgroundColor: '#f8fafc',
  },
  btn:         { backgroundColor: '#2563eb', borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 24 },
  btnDisabled: { opacity: 0.6 },
  btnText:     { color: '#fff', fontWeight: '700', fontSize: 16 },
})
