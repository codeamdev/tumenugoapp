import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

interface Props {
  message?: string
  onRetry?: () => void
}

export function ErrorView({ message = 'No se pudo cargar la información.', onRetry }: Props) {
  return (
    <View style={s.container}>
      <Ionicons name="cloud-offline-outline" size={48} color="#ef4444" />
      <Text style={s.title}>Error de conexión</Text>
      <Text style={s.message}>{message}</Text>
      {onRetry && (
        <TouchableOpacity style={s.btn} onPress={onRetry} activeOpacity={0.8}>
          <Ionicons name="refresh-outline" size={18} color="#fff" />
          <Text style={s.btnText}>Reintentar</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#2563eb',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  btnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
})
