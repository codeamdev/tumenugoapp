import { Stack } from 'expo-router'
import { useAuthStore } from '@/stores/auth-store'

export default function MasLayout() {
  const { tenant } = useAuthStore()
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'

  const HDR = {
    headerStyle: { backgroundColor: PRIMARY },
    headerTintColor: '#fff',
    headerTitleStyle: { fontWeight: '700' as const },
  }

  return (
    <Stack>
      <Stack.Screen name="index"          options={{ headerShown: false }} />
      <Stack.Screen name="mesas"          options={{ title: 'Mesas',          ...HDR }} />
      <Stack.Screen name="informes"       options={{ title: 'Informes',       ...HDR }} />
      <Stack.Screen name="productos"      options={{ title: 'Productos',      ...HDR }} />
      <Stack.Screen name="usuarios"       options={{ title: 'Usuarios',       ...HDR }} />
      <Stack.Screen name="configuracion"  options={{ title: 'Configuración',  ...HDR }} />
    </Stack>
  )
}
