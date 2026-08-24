import { useState } from 'react'
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '@/lib/api'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useAppColors } from '@/lib/theme'
import { ErrorView } from '@/components/ErrorView'
import type { CashRegister } from '@/types'

interface CierresData {
  history: CashRegister[]
  currencySign: string
}

export default function CierresScreen() {
  const router = useRouter()
  const { tenant } = useAuthStore()
  const c = useAppColors()
  const s = makeStyles(c)
  const PRIMARY = tenant?.primaryColor ?? '#2563eb'

  const { data, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ['caja-history'],
    queryFn: () => api.get<{ data: CierresData }>('/api/tenant/caja?type=history').then((r) => r.data),
    staleTime: 2 * 60_000,
  })

  const sign    = data?.currencySign ?? '$'
  const history = data?.history ?? []

  if (isLoading) {
    return <View style={s.centered}><ActivityIndicator size="large" color={PRIMARY} /></View>
  }

  if (isError) {
    return <ErrorView message="No se pudo cargar el historial de cierres." onRetry={refetch} />
  }

  return (
    <SafeAreaView style={s.root}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={24} color={PRIMARY} />
        </TouchableOpacity>
        <Text style={s.title}>Cierres de caja</Text>
        <TouchableOpacity onPress={() => refetch()} style={s.backBtn}>
          <Ionicons name="refresh-outline" size={20} color={isRefetching ? PRIMARY : c.textMuted} />
        </TouchableOpacity>
      </View>

      {history.length === 0 ? (
        <View style={s.centered}>
          <Ionicons name="document-text-outline" size={48} color={c.border} />
          <Text style={[s.emptyText, { color: c.textMuted }]}>Sin cierres registrados</Text>
        </View>
      ) : (
        <FlatList
          data={history}
          keyExtractor={(h) => h.id}
          contentContainerStyle={s.list}
          renderItem={({ item: h }) => {
            const diff = parseFloat(h.difference ?? '0')
            const hasDiff = Math.abs(diff) > 0.01
            return (
              <View style={[s.card, { backgroundColor: c.surface, borderColor: c.border }]}>
                <View style={s.cardHeader}>
                  <Text style={[s.date, { color: c.text }]}>{h.closedAt ? formatDateTime(h.closedAt) : '—'}</Text>
                  <View style={[s.diffBadge, hasDiff ? (diff >= 0 ? s.badgePos : s.badgeNeg) : s.badgeNeutral]}>
                    <Text style={[s.diffBadgeText, hasDiff ? (diff >= 0 ? s.textPos : s.textNeg) : { color: '#10b981' }]}>
                      {hasDiff ? `${diff >= 0 ? '+' : ''}${formatCurrency(diff, sign)}` : 'Exacto'}
                    </Text>
                  </View>
                </View>
                <View style={s.row}>
                  <View style={s.col}>
                    <Text style={[s.colLabel, { color: c.textMuted }]}>Apertura</Text>
                    <Text style={[s.colValue, { color: c.text }]}>{formatCurrency(parseFloat(h.openingAmount ?? '0'), sign)}</Text>
                  </View>
                  <View style={s.col}>
                    <Text style={[s.colLabel, { color: c.textMuted }]}>Esperado</Text>
                    <Text style={[s.colValue, { color: c.text }]}>{h.expectedCash ? formatCurrency(parseFloat(h.expectedCash), sign) : '—'}</Text>
                  </View>
                  <View style={s.col}>
                    <Text style={[s.colLabel, { color: c.textMuted }]}>Contado</Text>
                    <Text style={[s.colValue, { color: c.text }]}>{h.countedCash ? formatCurrency(parseFloat(h.countedCash), sign) : '—'}</Text>
                  </View>
                </View>
                {h.notes ? (
                  <Text style={[s.notes, { color: c.textMuted }]}>{h.notes}</Text>
                ) : null}
              </View>
            )
          }}
        />
      )}
    </SafeAreaView>
  )
}

function makeStyles(c: ReturnType<typeof useAppColors>) {
  return StyleSheet.create({
    root:    { flex: 1, backgroundColor: c.background },
    centered:{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    emptyText: { fontSize: 14 },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1,
    },
    backBtn: { padding: 4 },
    title:   { fontSize: 18, fontWeight: '700', color: c.text },
    list:    { padding: 16, gap: 12, paddingBottom: 40 },
    card:    { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    date:    { fontSize: 14, fontWeight: '600' },
    diffBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    badgePos:  { backgroundColor: '#d1fae5' },
    badgeNeg:  { backgroundColor: '#fee2e2' },
    badgeNeutral: { backgroundColor: '#d1fae5' },
    diffBadgeText: { fontSize: 13, fontWeight: '700' },
    textPos:   { color: '#059669' },
    textNeg:   { color: '#dc2626' },
    row:     { flexDirection: 'row', gap: 8 },
    col:     { flex: 1, gap: 2 },
    colLabel:{ fontSize: 11, fontWeight: '500', textTransform: 'uppercase' },
    colValue:{ fontSize: 14, fontWeight: '700' },
    notes:   { fontSize: 13, fontStyle: 'italic' },
  })
}
