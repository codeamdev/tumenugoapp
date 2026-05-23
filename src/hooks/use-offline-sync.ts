import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNetworkStatus } from './use-network'
import { processSyncQueue } from '@/lib/offline/sync-queue'

export function useOfflineSync() {
  const { isConnected } = useNetworkStatus()
  const qc = useQueryClient()
  const wasOffline = useRef(false)
  const syncing = useRef(false)

  useEffect(() => {
    if (isConnected && wasOffline.current && !syncing.current) {
      syncing.current = true
      // Process local queue first, then invalidate all cached data so any
      // changes made via web (orders, products, etc.) are fetched fresh.
      processSyncQueue().finally(() => {
        qc.invalidateQueries()
        syncing.current = false
      })
    }
    wasOffline.current = !isConnected
  }, [isConnected])
}
