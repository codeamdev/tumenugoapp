import { useState, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert, Modal, FlatList,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '@/stores/auth-store'
import { ApiError } from '@/lib/api'
import { useAppColors } from '@/lib/theme'

// ─── Selector de tenant ───────────────────────────────────────────────────────

interface TenantOption { id: string; name: string; slug: string }

function TenantPicker({ tenants, onSelect, onCancel }: {
  tenants: TenantOption[]
  onSelect: (slug: string) => void
  onCancel: () => void
}) {
  const c = useAppColors()
  const p = makeTenantPickerStyles(c)
  return (
    <Modal visible animationType="slide" presentationStyle="formSheet">
      <View style={p.root}>
        <View style={p.header}>
          <Text style={p.title}>Selecciona tu negocio</Text>
          <TouchableOpacity onPress={onCancel}>
            <Ionicons name="close" size={24} color={c.textSecondary} />
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
              <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
            </TouchableOpacity>
          )}
        />
      </View>
    </Modal>
  )
}

function makeTenantPickerStyles(c: ReturnType<typeof useAppColors>) {
  return StyleSheet.create({
    root:     { flex: 1, backgroundColor: c.background },
    header:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: c.border },
    title:    { fontSize: 18, fontWeight: '700', color: c.text },
    subtitle: { fontSize: 14, color: c.textMuted, paddingHorizontal: 20, paddingTop: 12 },
    card:     { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 12, padding: 14, gap: 12, shadowColor: c.shadow, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
    cardIcon: { width: 42, height: 42, borderRadius: 10, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
    cardName: { fontSize: 15, fontWeight: '600', color: c.text },
    cardSlug: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  })
}

// ─── Pantalla de login ────────────────────────────────────────────────────────

export default function LoginScreen() {
  const { login } = useAuthStore()
  const c = useAppColors()
  const s = makeLoginStyles(c)
  const passwordRef = useRef<TextInput>(null)

  const [email,         setEmail]         = useState('')
  const [password,      setPassword]      = useState('')
  const [loading,       setLoading]       = useState(false)
  const [showPassword,  setShowPassword]  = useState(false)
  const [emailFocused,  setEmailFocused]  = useState(false)
  const [passFocused,   setPassFocused]   = useState(false)

  const [tenantOptions, setTenantOptions] = useState<TenantOption[] | null>(null)
  const [pendingCreds,  setPendingCreds]  = useState<{ email: string; password: string } | null>(null)

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const canSubmit  = email.trim().length > 0 && password.length > 0 && !loading

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
        style={s.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.header}>
            <View style={s.logoBox}>
              <Text style={s.logoEmoji}>☕</Text>
            </View>
            <Text style={s.title}>Bienvenido</Text>
            <Text style={s.subtitle}>Inicia sesión para continuar</Text>
          </View>

          <View style={s.card}>
            {/* Email */}
            <Text style={s.fieldLabel}>Correo electrónico</Text>
            <View style={[s.inputWrap, emailFocused && s.inputWrapFocused]}>
              <Ionicons
                name="mail-outline"
                size={18}
                color={emailFocused ? '#2563eb' : c.textMuted}
                style={s.inputIcon}
              />
              <TextInput
                style={s.input}
                placeholder="tu@correo.com"
                placeholderTextColor={c.textMuted}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                returnKeyType="next"
                autoComplete="email"
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
              {email.length > 0 && (
                <Ionicons
                  name={emailValid ? 'checkmark-circle' : 'alert-circle'}
                  size={18}
                  color={emailValid ? '#10b981' : c.textMuted}
                />
              )}
            </View>

            {/* Contraseña */}
            <Text style={[s.fieldLabel, { marginTop: 20 }]}>Contraseña</Text>
            <View style={[s.inputWrap, passFocused && s.inputWrapFocused]}>
              <Ionicons
                name="lock-closed-outline"
                size={18}
                color={passFocused ? '#2563eb' : c.textMuted}
                style={s.inputIcon}
              />
              <TextInput
                ref={passwordRef}
                style={s.input}
                placeholder="••••••••"
                placeholderTextColor={c.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                returnKeyType="done"
                autoComplete="password"
                onFocus={() => setPassFocused(true)}
                onBlur={() => setPassFocused(false)}
                onSubmitEditing={() => handleLogin()}
              />
              <TouchableOpacity onPress={() => setShowPassword((v) => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color={c.textMuted}
                />
              </TouchableOpacity>
            </View>

            {/* Botón */}
            <TouchableOpacity
              style={[s.btn, !canSubmit && s.btnDisabled]}
              onPress={() => handleLogin()}
              disabled={!canSubmit}
              activeOpacity={0.8}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.btnText}>Iniciar sesión</Text>
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

function makeLoginStyles(c: ReturnType<typeof useAppColors>) {
  return StyleSheet.create({
    root:   { flex: 1, backgroundColor: c.surfaceAlt },
    scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },

    header: { alignItems: 'center', marginBottom: 32 },
    logoBox: {
      width: 76, height: 76, borderRadius: 22,
      backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center',
      marginBottom: 14,
      shadowColor: '#2563eb', shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
    },
    logoEmoji: { fontSize: 38 },
    title:    { fontSize: 26, fontWeight: '800', color: c.text },
    subtitle: { fontSize: 14, color: c.textMuted, marginTop: 4 },

    card: {
      backgroundColor: c.surface, borderRadius: 16, padding: 24,
      shadowColor: c.shadow, shadowOpacity: 0.06, shadowRadius: 16, elevation: 4,
    },
    fieldLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },

    inputWrap: {
      flexDirection: 'row', alignItems: 'center',
      borderWidth: 1.5, borderColor: c.border, borderRadius: 10,
      backgroundColor: c.surfaceAlt, paddingHorizontal: 12, height: 50,
    },
    inputWrapFocused: {
      borderColor: '#2563eb',
      backgroundColor: c.surface,
    },
    inputIcon: { marginRight: 8 },
    input: {
      flex: 1, fontSize: 15, color: c.text,
    },

    btn:         { backgroundColor: '#2563eb', borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 28 },
    btnDisabled: { opacity: 0.45 },
    btnText:     { color: '#fff', fontWeight: '700', fontSize: 16 },
  })
}
