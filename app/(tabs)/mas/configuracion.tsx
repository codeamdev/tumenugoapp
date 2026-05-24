import { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, Switch, Alert, ActivityIndicator, SafeAreaView,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useNetworkStatus } from '@/hooks/use-network'

const PRESET_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#be185d', '#d97706']

interface RemoteConfig {
  name: string
  primaryColor: string | null
  currencySign: string | null
  posConfig: {
    deliveryFields: { phone: boolean; address: boolean; notes: boolean; fee: boolean }
  } | null
}

export default function ConfiguracionScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const { tenant, user } = useAuthStore()
  const { isConnected } = useNetworkStatus()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'

  const [saving, setSaving]     = useState(false)
  const [name, setName]         = useState('')
  const [color, setColor]       = useState(PRIMARY)
  const [currency, setCurrency] = useState('$')
  const [delivery, setDelivery] = useState({ phone: true, address: true, notes: true, fee: true })

  useEffect(() => {
    if (!user) return
    if (user.role !== 'admin') router.replace('/mas' as any)
  }, [user?.id])

  const { data: configData, isLoading } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get<{ data: RemoteConfig }>('/api/tenant/configuracion').then((r) => r.data),
    gcTime: 24 * 60 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
    enabled: user?.role === 'admin',
  })

  // Initialize form state when data arrives (or from cache)
  useEffect(() => {
    if (!configData) return
    setName(configData.name ?? '')
    setColor(configData.primaryColor ?? '#2563eb')
    setCurrency(configData.currencySign ?? '$')
    const df = configData.posConfig?.deliveryFields
    if (df) setDelivery({ phone: df.phone, address: df.address, notes: df.notes, fee: df.fee })
  }, [configData])

  async function handleSave() {
    if (!isConnected) {
      Alert.alert('Sin conexión', 'Los cambios de configuración requieren conexión a internet.')
      return
    }
    if (!name.trim()) { Alert.alert('Error', 'El nombre no puede estar vacío'); return }
    setSaving(true)
    try {
      await api.patch('/api/tenant/configuracion', {
        name: name.trim(),
        primaryColor: color,
        currencySign: currency.trim() || '$',
        posConfig: { deliveryFields: delivery },
      })
      qc.invalidateQueries({ queryKey: ['configuracion'] })
      Alert.alert('Guardado', 'La configuración fue actualizada correctamente.')
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.root}>
        <ActivityIndicator style={{ flex: 1 }} size="large" color={PRIMARY} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root}>
      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color="#92400e" />
          <Text style={styles.offlineBannerText}>Sin conexión — mostrando última configuración guardada</Text>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Información general */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Información general</Text>

          <Text style={styles.label}>Nombre del negocio</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Nombre del negocio"
            editable={isConnected}
          />

          <Text style={styles.label}>Signo de moneda</Text>
          <TextInput
            style={[styles.input, { width: 80 }]}
            value={currency}
            onChangeText={setCurrency}
            placeholder="$"
            maxLength={5}
            editable={isConnected}
          />
        </View>

        {/* Color primario */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Color primario</Text>
          <View style={styles.colorRow}>
            {PRESET_COLORS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.colorChip, { backgroundColor: c }, color === c && styles.colorChipActive]}
                onPress={isConnected ? () => setColor(c) : undefined}
                disabled={!isConnected}
              />
            ))}
          </View>
          <TextInput
            style={[styles.input, { marginTop: 12 }]}
            value={color}
            onChangeText={(v) => { if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setColor(v) }}
            placeholder="#2563eb"
            autoCapitalize="none"
            editable={isConnected}
          />
          <View style={[styles.colorPreview, { backgroundColor: color }]}>
            <Text style={styles.colorPreviewText}>Vista previa del color</Text>
          </View>
        </View>

        {/* Campos de domicilio */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Campos de domicilio</Text>
          <Text style={styles.hint}>Activa solo los datos que necesitas recolectar</Text>

          {(
            [
              { key: 'phone',   label: 'Teléfono de contacto' },
              { key: 'address', label: 'Dirección de entrega' },
              { key: 'notes',   label: 'Notas del pedido'     },
              { key: 'fee',     label: 'Costo de envío'       },
            ] as { key: keyof typeof delivery; label: string }[]
          ).map(({ key, label }) => (
            <View key={key} style={styles.switchRow}>
              <Text style={styles.switchLabel}>{label}</Text>
              <Switch
                value={delivery[key]}
                onValueChange={(v) => { if (isConnected) setDelivery((prev) => ({ ...prev, [key]: v })) }}
                disabled={!isConnected}
                trackColor={{ false: '#e5e7eb', true: PRIMARY + '88' }}
                thumbColor={delivery[key] ? PRIMARY : '#9ca3af'}
              />
            </View>
          ))}
        </View>

        {/* Guardar */}
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: isConnected ? PRIMARY : '#94a3b8' }, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving || !isConnected}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <>
                <Ionicons name={isConnected ? 'checkmark-circle-outline' : 'cloud-offline-outline'} size={20} color="#fff" />
                <Text style={styles.saveBtnText}>{isConnected ? 'Guardar cambios' : 'Sin conexión'}</Text>
              </>
          }
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, gap: 16, paddingBottom: 40 },

  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fef3c7', paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#fde68a',
  },
  offlineBannerText: { fontSize: 12, color: '#92400e', flex: 1 },

  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 18,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    gap: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1e293b', marginBottom: 4 },
  hint:         { fontSize: 13, color: '#94a3b8', marginBottom: 4 },

  label: { fontSize: 13, fontWeight: '600', color: '#374151' },
  input: {
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: '#1e293b', backgroundColor: '#f9fafb',
  },

  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorChip: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 2, borderColor: 'transparent',
  },
  colorChipActive: { borderColor: '#1e293b' },
  colorPreview: {
    height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  colorPreviewText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 6,
  },
  switchLabel: { fontSize: 15, color: '#374151' },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, padding: 16,
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
