import { getToken, saveToken, getRefreshToken, saveRefreshToken, clearSession } from './auth'
import { TENANT_URL, TENANT_SLUG } from './config'
import { triggerAuthFail } from './auth-signal'

export class ApiError extends Error {
  body?: unknown
  constructor(message: string, public readonly status: number, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.body = body
  }
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true
  const msg = (err as any)?.message ?? ''
  return (
    msg.includes('Network request failed') ||
    msg.includes('Failed to fetch') ||
    msg.includes('network') ||
    msg.includes('timeout')
  )
}

// Single-flight guard
let inflightRefresh: Promise<void> | null = null

async function attemptTokenRefresh(): Promise<void> {
  const refreshToken = await getRefreshToken()
  if (!refreshToken) throw new Error('NO_TOKEN')

  let response: Response
  try {
    response = await fetch(`${TENANT_URL}/api/auth/refresh`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${refreshToken}`,
      },
    })
  } catch (err) {
    // Network error during refresh — device is offline
    // Do NOT clear session: the user is still authenticated, just has no connection
    throw new Error('NETWORK_ERROR')
  }

  if (!response.ok && response.status !== 0) {
    // Server explicitly rejected the token (401, 403, etc.)
    throw new Error('AUTH_ERROR')
  }

  const data = await response.json() as { accessToken: string; refreshToken: string }
  await Promise.all([
    saveToken(data.accessToken),
    saveRefreshToken(data.refreshToken),
  ])
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  slugOverride?: string,
  isRetry = false,
): Promise<T> {
  const token = await getToken()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  const slug = slugOverride ?? TENANT_SLUG
  if (slug) headers['x-tenant-slug'] = slug
  if (token) headers['Authorization'] = `Bearer ${token}`

  let response: Response
  try {
    // redirect: 'manual' prevents fetch from auto-following 307 to /login HTML
    response = await fetch(`${TENANT_URL}${path}`, { ...options, headers, redirect: 'manual' })
  } catch (err) {
    // Pure network error (device offline, DNS failure, timeout)
    // Throw as network error so TanStack Query retries when online
    throw new ApiError('Sin conexión', 0)
  }

  // 401 or 307 (Next.js redirect to /login when session expired)
  if ((response.status === 401 || response.status === 307) && !isRetry) {
    try {
      if (!inflightRefresh) {
        inflightRefresh = attemptTokenRefresh().finally(() => { inflightRefresh = null })
      }
      await inflightRefresh
      return request<T>(path, options, slugOverride, true)
    } catch (err) {
      const msg = (err as Error).message
      if (msg === 'NETWORK_ERROR') {
        // Offline during refresh: don't log out, just fail the current request
        // TanStack Query will serve from cache and retry when online
        throw new ApiError('Sin conexión', 0)
      }
      // Server explicitly rejected credentials → clear session and trigger login redirect
      await clearSession()
      triggerAuthFail()
      throw new ApiError('Sesión expirada', 401)
    }
  }

  if (response.status === 401 || response.status === 307) {
    // Second attempt also failed with auth error → clear session and redirect
    await clearSession()
    triggerAuthFail()
    throw new ApiError('Sesión expirada', 401)
  }

  if (response.status === 300) {
    let body: unknown
    try { body = await response.json() } catch {}
    throw new ApiError('Selecciona tu establecimiento', 300, body)
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`
    let body: unknown
    try {
      body    = await response.json()
      message = (body as Record<string, unknown>)?.error as string ?? message
    } catch {}
    throw new ApiError(message, response.status, body)
  }

  const text = await response.text()
  return text ? JSON.parse(text) : ({} as T)
}

export const api = {
  get:    <T>(path: string)                               => request<T>(path, { method: 'GET' }),
  post:   <T>(path: string, body: unknown, slug?: string) => request<T>(path, { method: 'POST',   body: JSON.stringify(body) }, slug),
  patch:  <T>(path: string, body: unknown)                => request<T>(path, { method: 'PATCH',  body: JSON.stringify(body) }),
  put:    <T>(path: string, body: unknown)                => request<T>(path, { method: 'PUT',    body: JSON.stringify(body) }),
  delete: <T>(path: string)                               => request<T>(path, { method: 'DELETE' }),
}
