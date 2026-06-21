import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useAppColors } from '@/lib/theme'

interface Props {
  message?: string
  onRetry?: () => void
}

export function ErrorView({ message = 'No se pudo cargar la información.', onRetry }: Props) {
  const c = useAppColors()
  const s = makeStyles(c)

  return (
    <View style={s.container}>
      <Ionicons name="cloud-offline-outline" size={48} color={c.danger} />
      <Text style={s.title}>Error de conexión</Text>
      <Text style={s.message}>{message}</Text>
      {onRetry && (
        <TouchableOpacity style={s.btn} onPress={onRetry} activeOpacity={0.8}>
          <Ionicons name="refresh-outline" size={18} color={c.textInverse} />
          <Text style={s.btnText}>Reintentar</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

function makeStyles(c: ReturnType<typeof import('@/lib/theme').useAppColors>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      padding: 32,
      backgroundColor: c.background,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: c.text,
      textAlign: 'center',
    },
    message: {
      fontSize: 14,
      color: c.textMuted,
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
      color: c.textInverse,
      fontWeight: '600',
      fontSize: 15,
    },
  })
}
