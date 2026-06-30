import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useAppColors } from '@/lib/theme'

export function SuspendedScreen({ tenantName }: { tenantName?: string }) {
  const c = useAppColors()
  return (
    <View style={[s.root, { backgroundColor: c.background }]}>
      <View style={[s.iconBox, { backgroundColor: c.warningLight }]}>
        <Ionicons name="warning-outline" size={56} color={c.warning} />
      </View>
      {tenantName && <Text style={[s.tenant, { color: c.textMuted }]}>{tenantName}</Text>}
      <Text style={[s.title, { color: c.text }]}>Sistema temporalmente suspendido</Text>
      <Text style={[s.body, { color: c.textMuted }]}>
        Este sistema se encuentra temporalmente fuera de servicio.{'\n'}
        Por favor comuníquese con soporte para más información.
      </Text>
      <View style={[s.note, { backgroundColor: c.warningLight, borderColor: c.warning }]}>
        <Text style={[s.noteText, { color: c.warning }]}>
          Todos sus datos están seguros. No se ha modificado ninguna información.
        </Text>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  root:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  iconBox: { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  tenant:  { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  title:   { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  body:    { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  note:    { borderWidth: 1, borderRadius: 10, padding: 14, marginTop: 8 },
  noteText:{ fontSize: 13, textAlign: 'center', fontWeight: '500' },
})
