'use client'
import { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, Switch, Alert, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useNetworkStatus } from '@/hooks/use-network'
import { useAppColors } from '@/lib/theme'
import { ErrorView } from '@/components/ErrorView'

interface PaymentMethod { key: string; label: string; isCredit?: boolean }

interface RemoteConfig {
  posConfig: {
    deliveryFields: { phone: boolean; address: boolean; notes: boolean; fee: boolean }
    paymentMethods?: PaymentMethod[]
    defaultOpeningAmount?: number
    defaultDeliveryFee?: number
  } | null
}

const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  { key: 'cash',      label: 'Efectivo'      },
  { key: 'card',      label: 'Tarjeta'       },
  { key: 'transfer',  label: 'Transferencia' },
  { key: 'nequi',     label: 'Nequi'         },
  { key: 'daviplata', label: 'Daviplata'     },
]

export default function ConfiguracionScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const { tenant, user } = useAuthStore()
  const { isConnected } = useNetworkStatus()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'
  const c = useAppColors()
  const styles = makeStyles(c)

  const [saving, setSaving]               = useState(false)
  const [defaultOpening, setDefaultOpening] = useState('')
  const [defaultFee, setDefaultFee]       = useState('')
  const [delivery, setDelivery]           = useState({ phone: true, address: true, notes: true, fee: true })
  const [payMethods, setPayMethods]       = useState<PaymentMethod[]>(DEFAULT_PAYMENT_METHODS)
  const [newMethodLabel, setNewLabel]     = useState('')
  const [newMethodCredit, setNewCredit]   = useState(false)

  useEffect(() => {
    if (!user) return
    if (user.role !== 'admin') router.replace('/mas' as any)
  }, [user?.id])

  if (user && user.role !== 'admin') return null

  const { data: configData, isLoading, isError, refetch } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get<{ data: RemoteConfig }>('/api/tenant/configuracion').then((r) => r.data),
    gcTime: 24 * 60 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
    enabled: user?.role === 'admin',
  })

  useEffect(() => {
    if (!configData) return
    const pc = configData.posConfig
    if (pc?.deliveryFields) setDelivery({ phone: pc.deliveryFields.phone, address: pc.deliveryFields.address, notes: pc.deliveryFields.notes, fee: pc.deliveryFields.fee })
    if (pc?.paymentMethods && pc.paymentMethods.length > 0) setPayMethods(pc.paymentMethods)
    if (pc?.defaultOpeningAmount != null) setDefaultOpening(String(pc.defaultOpeningAmount))
    if (pc?.defaultDeliveryFee != null) setDefaultFee(String(pc.defaultDeliveryFee))
  }, [configData])

  async function handleSave() {
    if (!isConnected) {
      Alert.alert('Sin conexión', 'Los cambios de configuración requieren conexión a internet.')
      return
    }
    setSaving(true)
    try {
      await api.patch('/api/tenant/configuracion', {
        posConfig: {
          deliveryFields: delivery,
          paymentMethods: payMethods,
          ...(defaultOpening.trim() ? { defaultOpeningAmount: parseFloat(defaultOpening) } : {}),
          ...(defaultFee.trim() ? { defaultDeliveryFee: parseFloat(defaultFee) } : {}),
        },
      })
      qc.invalidateQueries({ queryKey: ['configuracion'] })
      Alert.alert('Guardado', 'La configuración fue actualizada correctamente.')
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  function addPayMethod() {
    const label = newMethodLabel.trim()
    if (!label) return
    const key = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    if (payMethods.find((m) => m.key === key)) {
      Alert.alert('Duplicado', 'Ya existe un método con ese nombre.')
      return
    }
    setPayMethods((prev) => [...prev, { key, label, isCredit: newMethodCredit }])
    setNewLabel('')
    setNewCredit(false)
  }

  function removePayMethod(key: string) {
    setPayMethods((prev) => prev.filter((m) => m.key !== key))
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.root}>
        <ActivityIndicator style={{ flex: 1 }} size="large" color={PRIMARY} />
      </SafeAreaView>
    )
  }

  if (isError) {
    return <ErrorView message="No se pudo cargar la configuración." onRetry={refetch} />
  }

  return (
    <SafeAreaView style={styles.root}>
      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color={c.warning} />
          <Text style={styles.offlineBannerText}>Sin conexión — mostrando última configuración guardada</Text>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Montos por defecto */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Montos por defecto</Text>
          <Text style={styles.label}>Base de caja (apertura)</Text>
          <TextInput
            style={styles.input}
            value={defaultOpening}
            onChangeText={setDefaultOpening}
            placeholder="Ej: 50000"
            placeholderTextColor={c.textMuted}
            keyboardType="numeric"
            editable={isConnected}
          />
          <Text style={[styles.label, { marginTop: 10 }]}>Costo de envío por defecto</Text>
          <TextInput
            style={styles.input}
            value={defaultFee}
            onChangeText={setDefaultFee}
            placeholder="Ej: 5000"
            placeholderTextColor={c.textMuted}
            keyboardType="numeric"
            editable={isConnected}
          />
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
                trackColor={{ false: c.border, true: PRIMARY + '88' }}
                thumbColor={delivery[key] ? PRIMARY : c.textMuted}
              />
            </View>
          ))}
        </View>

        {/* Métodos de pago */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Métodos de pago</Text>
          <Text style={styles.hint}>Define los métodos disponibles al cobrar un pedido</Text>

          {payMethods.map((m) => (
            <View key={m.key} style={styles.pmRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.pmLabel, { color: c.text }]}>{m.label}</Text>
                {m.isCredit && <Text style={[styles.pmCredit, { color: c.warning }]}>Pendiente de pago</Text>}
              </View>
              <TouchableOpacity
                onPress={() => removePayMethod(m.key)}
                disabled={!isConnected}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="trash-outline" size={18} color={isConnected ? c.danger : c.textMuted} />
              </TouchableOpacity>
            </View>
          ))}

          <View style={[styles.pmAddRow, { borderTopColor: c.border }]}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={newMethodLabel}
              onChangeText={setNewLabel}
              placeholder="Nombre del método (ej: Bancolombia)"
              placeholderTextColor={c.textMuted}
              editable={isConnected}
            />
            <View style={styles.pmCreditRow}>
              <Text style={[styles.hint, { marginBottom: 0 }]}>Fiado</Text>
              <Switch
                value={newMethodCredit}
                onValueChange={setNewCredit}
                disabled={!isConnected}
                trackColor={{ false: c.border, true: PRIMARY + '88' }}
                thumbColor={newMethodCredit ? PRIMARY : c.textMuted}
              />
            </View>
            <TouchableOpacity
              style={[styles.pmAddBtn, { backgroundColor: newMethodLabel.trim() && isConnected ? PRIMARY : c.border }]}
              onPress={addPayMethod}
              disabled={!newMethodLabel.trim() || !isConnected}
            >
              <Ionicons name="add" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Guardar */}
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: isConnected ? PRIMARY : c.textMuted }, saving && styles.saveBtnDisabled]}
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

function makeStyles(c: ReturnType<typeof import('@/lib/theme').useAppColors>) {
  return StyleSheet.create({
    root:   { flex: 1, backgroundColor: c.background },
    scroll: { padding: 16, gap: 16, paddingBottom: 40 },

    offlineBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: c.warningLight, paddingHorizontal: 16, paddingVertical: 8,
      borderBottomWidth: 1, borderBottomColor: c.warning,
    },
    offlineBannerText: { fontSize: 12, color: c.warning, flex: 1 },

    card: {
      backgroundColor: c.surface, borderRadius: 16, padding: 18,
      shadowColor: c.shadow, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
      gap: 10,
    },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 4 },
    hint:         { fontSize: 13, color: c.textMuted, marginBottom: 4 },

    label: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    input: {
      borderWidth: 1, borderColor: c.border, borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: 10,
      fontSize: 15, color: c.text, backgroundColor: c.surfaceAlt,
    },

    switchRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 6,
    },
    switchLabel: { fontSize: 15, color: c.textSecondary },

    pmRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 12, borderBottomWidth: 1, borderBottomColor: c.background },
    pmLabel:     { fontSize: 15, fontWeight: '500' },
    pmCredit:    { fontSize: 11, marginTop: 2 },
    pmAddRow:    { paddingTop: 12, borderTopWidth: 1, gap: 8, marginTop: 4 },
    pmCreditRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    pmAddBtn:    { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

    saveBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      borderRadius: 14, padding: 16,
    },
    saveBtnDisabled: { opacity: 0.7 },
    saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  })
}
