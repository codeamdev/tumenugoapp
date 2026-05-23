import { api } from '@/lib/api'
import { getDb } from './db'

export type SyncOpType =
  | 'create_order'
  | 'update_order_status'
  | 'cancel_item'
  | 'toggle_product'
  | 'toggle_table_status'

export interface SyncItem {
  id: string
  operation: SyncOpType
  payload: Record<string, unknown>
  createdAt: number
  attempts: number
  lastError?: string
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// ─── Queue CRUD ───────────────────────────────────────────────────────────────

export function enqueueSync(operation: SyncOpType, payload: Record<string, unknown>): string {
  const db = getDb()
  const id = uuid()
  db.runSync(
    'INSERT INTO sync_queue (id, operation, payload, created_at) VALUES (?, ?, ?, ?)',
    [id, operation, JSON.stringify(payload), Date.now()],
  )
  return id
}

export function getPendingQueue(): SyncItem[] {
  const db = getDb()
  type Row = { id: string; operation: string; payload: string; created_at: number; attempts: number; last_error: string | null }
  const rows = db.getAllSync<Row>('SELECT * FROM sync_queue WHERE synced = 0 ORDER BY created_at ASC')
  return rows.map((r) => ({
    id: r.id,
    operation: r.operation as SyncOpType,
    payload: JSON.parse(r.payload),
    createdAt: r.created_at,
    attempts: r.attempts,
    lastError: r.last_error ?? undefined,
  }))
}

export function getPendingCount(): number {
  const db = getDb()
  const row = db.getFirstSync<{ count: number }>('SELECT COUNT(*) as count FROM sync_queue WHERE synced = 0')
  return row?.count ?? 0
}

function markSynced(id: string) {
  getDb().runSync('UPDATE sync_queue SET synced = 1 WHERE id = ?', [id])
}

function markFailed(id: string, error: string) {
  getDb().runSync(
    'UPDATE sync_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?',
    [error, id],
  )
}

// ─── Offline orders ───────────────────────────────────────────────────────────

export function saveOfflineOrder(localId: string, orderPayload: Record<string, unknown>) {
  getDb().runSync(
    'INSERT OR REPLACE INTO offline_orders (local_id, data, created_at) VALUES (?, ?, ?)',
    [localId, JSON.stringify(orderPayload), Date.now()],
  )
}

export function getOfflineOrders(): Array<Record<string, unknown>> {
  type Row = { local_id: string; data: string; created_at: number }
  const rows = getDb().getAllSync<Row>('SELECT * FROM offline_orders ORDER BY created_at DESC')
  return rows.map((r) => ({ ...JSON.parse(r.data), _offline: true, localId: r.local_id }))
}

export function removeOfflineOrder(localId: string) {
  getDb().runSync('DELETE FROM offline_orders WHERE local_id = ?', [localId])
}

// ─── Sync processor ──────────────────────────────────────────────────────────

export async function processSyncQueue(): Promise<{ synced: number; failed: number }> {
  const queue = getPendingQueue()
  let synced = 0
  let failed = 0

  for (const item of queue) {
    try {
      await processSyncItem(item)
      markSynced(item.id)
      synced++
    } catch (err: any) {
      markFailed(item.id, err?.message ?? 'Error desconocido')
      failed++
    }
  }

  return { synced, failed }
}

async function processSyncItem(item: SyncItem): Promise<void> {
  switch (item.operation) {
    case 'create_order': {
      const result = await api.post<{ data: { localId: string | null } }>(
        '/api/tenant/orders',
        item.payload,
      )
      // Remove from offline_orders once synced
      const localId = (item.payload.localId as string) ?? result.data?.localId
      if (localId) removeOfflineOrder(localId)
      break
    }

    case 'update_order_status': {
      const { orderId, ...body } = item.payload
      await api.patch(`/api/tenant/orders/${orderId}`, body)
      break
    }

    case 'cancel_item': {
      const { orderId, itemId } = item.payload
      await api.delete(`/api/tenant/orders/${orderId}/items/${itemId}`)
      break
    }

    case 'toggle_product': {
      const { productId, ...body } = item.payload
      await api.patch(`/api/tenant/products/${productId}`, body)
      break
    }

    case 'toggle_table_status': {
      const { tableId, ...body } = item.payload
      await api.patch(`/api/tenant/tables/${tableId}`, body)
      break
    }
  }
}
