import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '@/stores/auth-store'

type IoniconsName = React.ComponentProps<typeof Ionicons>['name']

function TabIcon({ name, color, size }: { name: IoniconsName; color: string; size: number }) {
  return <Ionicons name={name} size={size} color={color} />
}

// Role visibility matrix
const ROLE_TABS: Record<string, string[]> = {
  admin:   ['pos', 'pedidos', 'cocina', 'caja', 'mas'],
  cajero:  ['pos', 'pedidos', 'caja', 'mas'],
  mesero:  ['pos', 'pedidos', 'mas'],
  cocina:  ['cocina', 'mas'],
}

export default function TabsLayout() {
  const { tenant, user } = useAuthStore()
  const PRIMARY  = tenant?.primaryColor ?? '#2563eb'
  const GRAY     = '#9ca3af'
  const role     = user?.role ?? 'mesero'
  const visible  = ROLE_TABS[role] ?? ROLE_TABS.mesero

  function tabOpts(name: string, title: string, icon: IoniconsName) {
    const isVisible = visible.includes(name)
    return {
      title,
      tabBarIcon: ({ color, size }: { color: string; size: number }) => (
        <TabIcon name={icon} color={color} size={size} />
      ),
      ...(isVisible ? {} : { href: null }),
    }
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: PRIMARY,
        tabBarInactiveTintColor: GRAY,
        tabBarStyle: {
          borderTopWidth: 1,
          borderTopColor: '#e5e7eb',
          backgroundColor: '#ffffff',
        },
        headerStyle: { backgroundColor: PRIMARY },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="pos"
        options={{
          ...tabOpts('pos', 'Vender', 'cart-outline'),
          headerTitle: 'Nuevo Pedido',
        }}
      />
      <Tabs.Screen
        name="pedidos"
        options={tabOpts('pedidos', 'Pedidos', 'list-outline')}
      />
      <Tabs.Screen
        name="cocina"
        options={tabOpts('cocina', 'Cocina', 'restaurant-outline')}
      />
      <Tabs.Screen
        name="caja"
        options={tabOpts('caja', 'Caja', 'cash-outline')}
      />
      <Tabs.Screen
        name="mas"
        options={{
          ...tabOpts('mas', 'Más', 'grid-outline'),
          headerShown: false,
        }}
      />
    </Tabs>
  )
}
