import { useEffect, useRef } from 'react'
import { View, BackHandler, ToastAndroid, Platform } from 'react-native'
import { setOnAuthFail, setOnSuspended } from '@/lib/auth-signal'
import { SuspendedScreen } from '@/components/SuspendedScreen'
import { Stack, useRouter, useSegments } from 'expo-router'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useAuthStore } from '@/stores/auth-store'
import { setupOnlineManager } from '@/hooks/use-network'
import { useOfflineSync } from '@/hooks/use-offline-sync'
import { OfflineBanner } from '@/components/OfflineBanner'
import { getDb } from '@/lib/offline/db'

// Initialize SQLite and network manager once at startup
getDb()
setupOnlineManager()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // offlineFirst: queries run from cache regardless of network state.
      // When offline, failed fetches don't set isError if cached data exists.
      networkMode: 'offlineFirst',
      retry: 1,
      staleTime: 30_000,
      gcTime: 24 * 60 * 60 * 1000, // keep cache 24h for offline use
    },
    mutations: {
      networkMode: 'offlineFirst',
    },
  },
})

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'cafeteria_rq_cache',
  throttleTime: 3000,
})

const ROLE_HOME: Record<string, string> = {
  admin:  '/(tabs)/pos',
  cajero: '/(tabs)/pos',
  mesero: '/(tabs)/pos',
  cocina: '/(tabs)/cocina',
}

function ExitHandler() {
  const lastBack = useRef(0)
  useEffect(() => {
    if (Platform.OS !== 'android') return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const now = Date.now()
      if (now - lastBack.current < 2000) return false // exit
      lastBack.current = now
      ToastAndroid.show('Presiona atrás de nuevo para salir', ToastAndroid.SHORT)
      return true
    })
    return () => sub.remove()
  }, [])
  return null
}

function AuthGuard() {
  const { isAuthenticated, isLoading, restore, user } = useAuthStore()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => { restore() }, [])

  useEffect(() => {
    if (isLoading) return
    const inAuth = segments[0] === 'login'
    const inApp  = segments[0] === '(tabs)'
    if (!isAuthenticated) {
      if (!inAuth) router.replace('/login')
    } else if (!inApp) {
      const home = ROLE_HOME[user?.role ?? 'mesero'] ?? '/(tabs)/pos'
      router.replace(home as any)
    }
  }, [isAuthenticated, isLoading, segments, user?.role])

  return null
}

function SyncManager() {
  useOfflineSync()
  return null
}

// Callbacks globales de auth/suspension — registrados una vez al arrancar.
setOnAuthFail(() => { useAuthStore.getState().logout() })
setOnSuspended(() => { useAuthStore.getState().setSuspended(true) })

// Overlay de suspensión: se muestra por encima de todo cuando el tenant está suspendido.
// No borra ni modifica nada — solo informa al usuario.
function SuspensionGuard() {
  const { isSuspended, tenant } = useAuthStore()
  if (!isSuspended) return null
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}>
      <SuspendedScreen tenantName={tenant?.name} />
    </View>
  )
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 24 * 60 * 60 * 1000,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => {
            const key = query.queryKey[0] as string
            return ['products', 'categories', 'tables', 'orders', 'kitchen', 'caja', 'users', 'informes', 'configuracion'].includes(key)
          },
        },
      }}
    >
      <StatusBar style="light" />
      <OfflineBanner />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      <AuthGuard />
      <SyncManager />
      <ExitHandler />
      <SuspensionGuard />
    </PersistQueryClientProvider>
    </SafeAreaProvider>
  )
}
