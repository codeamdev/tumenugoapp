import { useEffect } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { StatusBar } from 'expo-status-bar'
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
      retry: 1,
      staleTime: 30_000,
      gcTime: 24 * 60 * 60 * 1000, // keep cache 24h for offline use
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

export default function RootLayout() {
  return (
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
    </PersistQueryClientProvider>
  )
}
