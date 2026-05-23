import { useEffect, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useNetworkStatus } from '@/hooks/use-network'
import { getPendingCount } from '@/lib/offline/sync-queue'

export function OfflineBanner() {
  const { isConnected } = useNetworkStatus()
  const { top } = useSafeAreaInsets()
  const [pending, setPending] = useState(0)

  useEffect(() => {
    setPending(getPendingCount())
    // Poll while offline OR while connected and still draining the queue
    const interval = setInterval(() => setPending(getPendingCount()), 3000)
    return () => clearInterval(interval)
  }, [isConnected])

  if (isConnected && pending === 0) return null

  return (
    <View style={[styles.banner, isConnected ? styles.syncing : styles.offline, { paddingTop: top + 5 }]}>
      <Ionicons
        name={isConnected ? 'sync-outline' : 'cloud-offline-outline'}
        size={13}
        color="#fff"
      />
      <Text style={styles.text}>
        {isConnected
          ? `Sincronizando ${pending} operación${pending !== 1 ? 'es' : ''}…`
          : `Sin conexión${pending > 0 ? ` · ${pending} pendiente${pending !== 1 ? 's' : ''}` : ''}`}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    paddingVertical: 5,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  offline: { backgroundColor: '#f59e0b' },
  syncing: { backgroundColor: '#3b82f6' },
  text: { color: '#fff', fontWeight: '700', fontSize: 12 },
})
