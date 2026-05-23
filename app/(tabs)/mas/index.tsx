import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, SafeAreaView } from 'react-native'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '@/stores/auth-store'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador', cajero: 'Cajero',
  mesero: 'Mesero', cocina: 'Cocina',
}

interface MenuItem {
  icon: React.ComponentProps<typeof Ionicons>['name']
  label: string
  desc: string
  route: string
  roles?: string[]
  color: string
}

const MENU: MenuItem[] = [
  { icon: 'grid-outline',        label: 'Mesas',          desc: 'Estado y asignación de mesas',    route: '/mas/mesas',          color: '#6366f1' },
  { icon: 'bar-chart-outline',   label: 'Informes',       desc: 'Ventas, pedidos y estadísticas',  route: '/mas/informes',       roles: ['admin', 'cajero'], color: '#10b981' },
  { icon: 'fast-food-outline',   label: 'Productos',      desc: 'Disponibilidad del catálogo',     route: '/mas/productos',      roles: ['admin', 'cajero'], color: '#f59e0b' },
  { icon: 'people-outline',      label: 'Usuarios',       desc: 'Gestión de empleados',            route: '/mas/usuarios',       roles: ['admin'], color: '#ef4444' },
  { icon: 'settings-outline',    label: 'Configuración',  desc: 'Personalización del negocio',     route: '/mas/configuracion',  roles: ['admin'], color: '#8b5cf6' },
]

export default function MasIndex() {
  const router = useRouter()
  const qc     = useQueryClient()
  const { user, tenant, logout } = useAuthStore()

  const role    = user?.role ?? ''
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'

  async function handleLogout() {
    Alert.alert('Cerrar sesión', '¿Salir de la aplicación?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar sesión', style: 'destructive', onPress: async () => {
          await logout()
          qc.clear()
          router.replace('/login')
        },
      },
    ])
  }

  const visible = MENU.filter((m) => !m.roles || m.roles.includes(role))

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.avatar, { backgroundColor: PRIMARY }]}>
            <Text style={styles.avatarLetter}>{(user?.name ?? user?.email ?? '?')[0].toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{user?.name ?? user?.email}</Text>
            <Text style={styles.userRole}>{ROLE_LABELS[role] ?? role} · {tenant?.name}</Text>
          </View>
        </View>

        {/* Menu grid */}
        <View style={styles.grid}>
          {visible.map((item) => (
            <TouchableOpacity
              key={item.route}
              style={styles.card}
              onPress={() => router.push(item.route as any)}
              activeOpacity={0.75}
            >
              <View style={[styles.cardIcon, { backgroundColor: item.color + '18' }]}>
                <Ionicons name={item.icon} size={28} color={item.color} />
              </View>
              <Text style={styles.cardLabel}>{item.label}</Text>
              <Text style={styles.cardDesc}>{item.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color="#ef4444" />
          <Text style={styles.logoutText}>Cerrar sesión</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 20, gap: 20, paddingBottom: 40 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#fff', borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { color: '#fff', fontSize: 20, fontWeight: '700' },
  userName:     { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  userRole:     { fontSize: 13, color: '#64748b', marginTop: 2 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    width: '47%', backgroundColor: '#fff', borderRadius: 16, padding: 18,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    gap: 10,
  },
  cardIcon:  { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardLabel: { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  cardDesc:  { fontSize: 12, color: '#94a3b8', lineHeight: 16 },

  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: '#fecaca', borderRadius: 12,
    padding: 14, backgroundColor: '#fff5f5',
  },
  logoutText: { color: '#ef4444', fontWeight: '600', fontSize: 15 },
})
