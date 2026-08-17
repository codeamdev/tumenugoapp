import { getDb } from './db'
import type { Product, Category, Table, Order } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseRows<T>(rows: { data: string }[]): T[] {
  return rows.map((r) => JSON.parse(r.data) as T)
}

// ─── Products ─────────────────────────────────────────────────────────────────

export function saveProductsToCache(products: Product[]) {
  const db = getDb()
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM cache_products')
    for (const p of products) {
      db.runSync('INSERT INTO cache_products (id, data) VALUES (?, ?)', [p.id, JSON.stringify(p)])
    }
  })
}

export function getProductsFromCache(): Product[] | null {
  const rows = getDb().getAllSync<{ data: string }>('SELECT data FROM cache_products ORDER BY rowid')
  return rows.length ? parseRows<Product>(rows) : null
}

// ─── Categories ───────────────────────────────────────────────────────────────

export function saveCategoriesToCache(categories: Category[]) {
  const db = getDb()
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM cache_categories')
    for (const c of categories) {
      db.runSync('INSERT INTO cache_categories (id, data) VALUES (?, ?)', [c.id, JSON.stringify(c)])
    }
  })
}

export function getCategoriesFromCache(): Category[] | null {
  const rows = getDb().getAllSync<{ data: string }>('SELECT data FROM cache_categories ORDER BY rowid')
  return rows.length ? parseRows<Category>(rows) : null
}

// ─── Tables ───────────────────────────────────────────────────────────────────

export function saveTablesToCache(tables: Table[]) {
  const db = getDb()
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM cache_tables')
    for (const t of tables) {
      db.runSync('INSERT INTO cache_tables (id, data) VALUES (?, ?)', [t.id, JSON.stringify(t)])
    }
  })
}

export function getTablesFromCache(): Table[] | null {
  const rows = getDb().getAllSync<{ data: string }>('SELECT data FROM cache_tables ORDER BY rowid')
  return rows.length ? parseRows<Table>(rows) : null
}

// ─── Kitchen orders (upsert — no borra los que no son sent/preparing) ─────────

export function saveKitchenOrdersToCache(orders: Order[]) {
  const db = getDb()
  for (const o of orders) {
    db.runSync(
      'INSERT OR REPLACE INTO cache_orders (id, data, is_local) VALUES (?, ?, 0)',
      [o.id, JSON.stringify(o)],
    )
  }
}

// ─── Orders ───────────────────────────────────────────────────────────────────

// Reemplaza todos los pedidos del servidor (guarda los locales)
export function saveActiveOrdersToCache(orders: Order[]) {
  const db = getDb()
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM cache_orders WHERE is_local = 0')
    for (const o of orders) {
      db.runSync(
        'INSERT INTO cache_orders (id, data, is_local) VALUES (?, ?, 0)',
        [o.id, JSON.stringify(o)],
      )
    }
  })
}

// Upsert individual (para pedidos de cocina que tienen items completos, o pedidos locales)
export function upsertOrderInCache(order: Order, isLocal = false) {
  getDb().runSync(
    'INSERT OR REPLACE INTO cache_orders (id, data, is_local) VALUES (?, ?, ?)',
    [order.id, JSON.stringify(order), isLocal ? 1 : 0],
  )
}

export function getActiveOrdersFromCache(): Order[] | null {
  const rows = getDb().getAllSync<{ data: string }>('SELECT data FROM cache_orders ORDER BY rowid DESC')
  if (!rows.length) return null
  const all = parseRows<Order>(rows).filter(
    (o) => o.status !== 'closed' && o.status !== 'cancelled',
  )
  return all.length ? all : null
}

export function getKitchenOrdersFromCache(): Order[] | null {
  const rows = getDb().getAllSync<{ data: string }>('SELECT data FROM cache_orders ORDER BY rowid ASC')
  if (!rows.length) return null
  const kitchen = parseRows<Order>(rows).filter(
    (o) => o.status === 'sent' || o.status === 'preparing',
  )
  return kitchen.length ? kitchen : null
}

export function updateOrderStatusInCache(orderId: string, status: Order['status']) {
  const row = getDb().getFirstSync<{ data: string }>('SELECT data FROM cache_orders WHERE id = ?', [orderId])
  if (!row) return
  const order = JSON.parse(row.data) as Order
  order.status = status
  getDb().runSync('UPDATE cache_orders SET data = ? WHERE id = ?', [JSON.stringify(order), orderId])
}

export function removeOrderFromCache(orderId: string) {
  getDb().runSync('DELETE FROM cache_orders WHERE id = ?', [orderId])
}
