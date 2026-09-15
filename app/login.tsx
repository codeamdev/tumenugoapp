'use client'
import { useState, useRef, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert, Modal, FlatList,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as LocalAuthentication from 'expo-local-authentication'
import { useAuthStore, hasOfflineCredential } from '@/stores/auth-store'
import { ApiError } from '@/lib/api'
import { useNetworkStatus } from '@/hooks/use-network'
import { useAppColors } from '@/lib/theme'
import {
  getBiometricEnabled, setBiometricEnabled,
  unlockSession, isSessionLocked,
} from '@/lib/auth'

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
  const { login, offlineLogin, restore } = useAuthStore()
  const { isConnected } = useNetworkStatus()
  const c = useAppColors()
  const s = makeLoginStyles(c)
  const passwordRef = useRef<TextInput>(null)

  const [email,         setEmail]         = useState('')
  const [password,      setPassword]      = useState('')
  const [loading,       setLoading]       = useState(false)
  const [bioLoading,    setBioLoading]    = useState(false)
  const [showPassword,  setShowPassword]  = useState(false)
  const [emailFocused,  setEmailFocused]  = useState(false)
  const [passFocused,   setPassFocused]   = useState(false)
  const [hasOffline,    setHasOffline]    = useState(false)

  // biometría: null = aún chequeando, false = no disponible/activo, 'fingerprint' | 'face' = disponible
  const [bioType,       setBioType]       = useState<null | false | 'fingerprint' | 'face'>(null)

  const [tenantOptions, setTenantOptions] = useState<TenantOption[] | null>(null)
  const [pendingCreds,  setPendingCreds]  = useState<{ email: string; password: string } | null>(null)

  useEffect(() => {
    hasOfflineCredential().then(setHasOffline)
    checkBiometricAvailability()
  }, [])

  async function checkBiometricAvailability() {
    try {
      const [locked, bioEnabled, hasHardware, isEnrolled] = await Promise.all([
        isSessionLocked(),
        getBiometricEnabled(),
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ])

      // Solo mostrar biometría si: sesión bloqueada (post-logout) + usuario la activó + dispositivo la soporta
      if (!locked || !bioEnabled || !hasHardware || !isEnrolled) {
        setBioType(false)
        return
      }

      const types = await LocalAuthentication.supportedAuthenticationTypesAsync()
      const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
      setBioType(hasFace ? 'face' : 'fingerprint')

      // Auto-trigger al abrir la pantalla
      triggerBiometric()
    } catch {
      setBioType(false)
    }
  }

  async function triggerBiometric() {
    setBioLoading(true)
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Ingresa a CafeteriaOS',
        cancelLabel: 'Usar contraseña',
        disableDeviceFallback: true,
      })
      if (result.success) {
        await unlockSession()
        await restore()
      }
    } catch {
      // El usuario canceló o el hardware falló — dejamos el form visible
    } finally {
      setBioLoading(false)
    }
  }

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const canSubmit  = email.trim().length > 0 && password.length > 0 && !loading
  const isOffline  = !isConnected

  async function offerBiometricIfPossible() {
    try {
      const [hasHardware, isEnrolled, alreadyEnabled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        getBiometricEnabled(),
      ])
      if (!hasHardware || !isEnrolled || alreadyEnabled) return

      const types = await LocalAuthentication.supportedAuthenticationTypesAsync()
      const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
      const label = hasFace ? 'Face ID' : 'huella digital'

      Alert.alert(
        `¿Activar ${label}?`,
        `La próxima vez puedes ingresar sin escribir tu contraseña.`,
        [
          { text: 'Ahora no', style: 'cancel' },
          { text: 'Activar', onPress: () => setBiometricEnabled(true) },
        ],
      )
    } catch { /* ignorar */ }
  }

  async function handleLogin(slugOverride?: string) {
    const trimEmail = email.trim().toLowerCase()
    if (!trimEmail || !password) {
      Alert.alert('Campos requeridos', 'Ingresa tu correo y contraseña.')
      return
    }

    if (isOffline) {
      setLoading(true)
      try {
        const ok = await offlineLogin({ email: trimEmail, password })
        if (ok) return
        Alert.alert(
          'Sin conexión',
          hasOffline
            ? 'Contraseña incorrecta. Intenta de nuevo.'
            : 'No hay datos guardados en este dispositivo. Necesitás internet para el primer ingreso.',
        )
      } finally {
        setLoading(false)
      }
      return
    }

    setLoading(true)
    try {
      await login({ email: trimEmail, password, tenantSlug: slugOverride })
      await offerBiometricIfPossible()
    } catch (err) {
      if (err instanceof ApiError && err.status === 300) {
        const body = (err as any).body as { tenants: TenantOption[] }
        if (body?.tenants?.length) {
          setPendingCreds({ email: trimEmail, password })
          setTenantOptions(body.tenants)
          return
        }
      }

      const isNetworkErr = err instanceof ApiError && err.status === 0
      if (isNetworkErr) {
        const ok = await offlineLogin({ email: trimEmail, password })
        if (ok) return
        Alert.alert(
          'Sin conexión',
          hasOffline
            ? 'Contraseña incorrecta. Intenta de nuevo.'
            : 'No hay datos guardados en este dispositivo. Necesitás internet para el primer ingreso.',
        )
        return
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
      await offerBiometricIfPossible()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Error de conexión.'
      Alert.alert('Error al iniciar sesión', message)
    } finally {
      setLoading(false)
      setPendingCreds(null)
    }
  }

  const bioIcon = bioType === 'face' ? 'scan-outline' : 'finger-print-outline'
  const bioLabel = bioType === 'face' ? 'Face ID' : 'Huella digital'

  return (
    <>
      <KeyboardAvoidingView
        style={s.root}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'android' ? 0 : 0}
      >
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.header}>
            <View style={s.logoBox}>
              <Text style={s.logoEmoji}>☕</Text>
            </View>
            <Text style={s.title}>Bienvenido</Text>
            <Text style={s.subtitle}>Inicia sesión para continuar</Text>
          </View>

          {/* Botón biométrico — visible solo si la sesión está bloqueada y biometría activa */}
          {bioType && (
            <TouchableOpacity
              style={[s.bioBtn, bioLoading && s.btnDisabled]}
              onPress={triggerBiometric}
              disabled={bioLoading}
              activeOpacity={0.8}
            >
              {bioLoading
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <Ionicons name={bioIcon as any} size={22} color="#fff" />
                    <Text style={s.bioBtnText}>Entrar con {bioLabel}</Text>
                  </>
              }
            </TouchableOpacity>
          )}

          <View style={s.card}>
            {/* Banner sin conexión */}
            {isOffline && (
              <View style={[s.offlineBanner, { backgroundColor: hasOffline ? '#fef3c7' : '#fee2e2' }]}>
                <Ionicons name="cloud-offline-outline" size={16} color={hasOffline ? '#92400e' : '#991b1b'} />
                <Text style={[s.offlineBannerText, { color: hasOffline ? '#92400e' : '#991b1b' }]}>
                  {hasOffline
                    ? 'Sin internet — podés ingresar con tu contraseña'
                    : 'Sin internet — necesitás conexión para el primer ingreso'}
                </Text>
              </View>
            )}

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

            {/* Botón iniciar sesión */}
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
    scroll: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 },

    header: { alignItems: 'center', marginBottom: 8 },
    logoBox: {
      width: 76, height: 76, borderRadius: 22,
      backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center',
      marginBottom: 14,
      shadowColor: '#2563eb', shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
    },
    logoEmoji: { fontSize: 38 },
    title:    { fontSize: 26, fontWeight: '800', color: c.text },
    subtitle: { fontSize: 14, color: c.textMuted, marginTop: 4 },

    bioBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
      backgroundColor: '#1d4ed8', borderRadius: 12, padding: 16,
      shadowColor: '#1d4ed8', shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
    },
    bioBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

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

    offlineBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      borderRadius: 8, padding: 10, marginBottom: 16,
    },
    offlineBannerText: { fontSize: 13, flex: 1, lineHeight: 18 },
  })
}
