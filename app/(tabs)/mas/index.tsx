import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, SafeAreaView } from 'react-native'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '@/stores/auth-store'
import { useAppColors } from '@/lib/theme'
import { useThemeStore, type ThemeMode } from '@/stores/theme-store'

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

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: string }[] = [
  { value: 'system', label: 'Sistema', icon: 'phone-portrait-outline' },
  { value: 'light',  label: 'Claro',   icon: 'sunny-outline' },
  { value: 'dark',   label: 'Oscuro',  icon: 'moon-outline' },
]

export default function MasIndex() {
  const router = useRouter()
  const qc     = useQueryClient()
  const { user, tenant, logout } = useAuthStore()
  const c = useAppColors()
  const s = makeStyles(c)
  const { mode, setMode } = useThemeStore()

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
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Header */}
        <View style={s.header}>
          <View style={[s.avatar, { backgroundColor: PRIMARY }]}>
            <Text style={s.avatarLetter}>{(user?.name ?? user?.email ?? '?')[0].toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.userName}>{user?.name ?? user?.email}</Text>
            <Text style={s.userRole}>{ROLE_LABELS[role] ?? role} · {tenant?.name}</Text>
          </View>
        </View>

        {/* Menu grid */}
        <View style={s.grid}>
          {visible.map((item) => (
            <TouchableOpacity
              key={item.route}
              style={s.card}
              onPress={() => router.push(item.route as any)}
              activeOpacity={0.75}
            >
              <View style={[s.cardIcon, { backgroundColor: item.color + '18' }]}>
                <Ionicons name={item.icon} size={28} color={item.color} />
              </View>
              <Text style={s.cardLabel}>{item.label}</Text>
              <Text style={s.cardDesc}>{item.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Theme toggle */}
        <View style={s.themeSection}>
          <Text style={s.themeLabel}>Apariencia</Text>
          <View style={s.themeRow}>
            {THEME_OPTIONS.map((opt) => {
              const active = mode === opt.value
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[s.themeChip, active && { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
                  onPress={() => setMode(opt.value)}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name={opt.icon as React.ComponentProps<typeof Ionicons>['name']}
                    size={16}
                    color={active ? '#fff' : c.textMuted}
                  />
                  <Text style={[s.themeChipText, active && s.themeChipTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        {/* Logout */}
        <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color={c.danger} />
          <Text style={s.logoutText}>Cerrar sesión</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

function makeStyles(c: ReturnType<typeof import('@/lib/theme').useAppColors>) {
  return StyleSheet.create({
    root:   { flex: 1, backgroundColor: c.background },
    scroll: { padding: 20, gap: 20, paddingBottom: 40 },

    header: {
      flexDirection: 'row', alignItems: 'center', gap: 14,
      backgroundColor: c.surface, borderRadius: 16, padding: 16,
      shadowColor: c.shadow, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    },
    avatar: {
      width: 48, height: 48, borderRadius: 24,
      alignItems: 'center', justifyContent: 'center',
    },
    avatarLetter: { color: c.textInverse, fontSize: 20, fontWeight: '700' },
    userName:     { fontSize: 16, fontWeight: '700', color: c.text },
    userRole:     { fontSize: 13, color: c.textMuted, marginTop: 2 },

    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    card: {
      width: '47%', backgroundColor: c.surface, borderRadius: 16, padding: 18,
      shadowColor: c.shadow, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
      gap: 10,
    },
    cardIcon:  { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    cardLabel: { fontSize: 15, fontWeight: '700', color: c.text },
    cardDesc:  { fontSize: 12, color: c.textMuted, lineHeight: 16 },

    themeSection: { gap: 10 },
    themeLabel:   { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    themeRow:     { flexDirection: 'row', gap: 8 },
    themeChip: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      paddingVertical: 10, borderRadius: 10,
      backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
    },
    themeChipText:       { fontSize: 13, fontWeight: '600', color: c.textMuted },
    themeChipTextActive: { color: c.textInverse },

    logoutBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      borderWidth: 1, borderColor: c.danger, borderRadius: 12,
      padding: 14, backgroundColor: c.dangerLight,
    },
    logoutText: { color: c.danger, fontWeight: '600', fontSize: 15 },
  })
}
