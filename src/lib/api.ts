import { getToken, saveToken, getRefreshToken, saveRefreshToken, clearSession } from './auth'
import { TENANT_URL, TENANT_SLUG } from './config'

export class ApiError extends Error {
  // body is populated for non-2xx responses that return JSON (e.g. 300 multi-tenant)
  body?: unknown

  constructor(message: string, public readonly status: number, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.body = body
  }
}

// Single-flight guard: if a refresh is already in progress, all callers await the same promise
let inflightRefresh: Promise<void> | null = null

async function attemptTokenRefresh(): Promise<void> {
  const refreshToken = await getRefreshToken()
  if (!refreshToken) throw new Error('No refresh token stored')

  const response = await fetch(`${TENANT_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${refreshToken}`,
    },
  })

  if (!response.ok) throw new Error('Refresh failed')

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

  // Use explicit slug override (tenant picker), fall back to env var, fall back to nothing
  const slug = slugOverride ?? TENANT_SLUG
  if (slug) headers['x-tenant-slug'] = slug
  if (token) headers['Authorization'] = `Bearer ${token}`

  const response = await fetch(`${TENANT_URL}${path}`, { ...options, headers })

  // 401: try a token refresh once, then retry the original request
  if ((response.status === 401 || response.status === 307) && !isRetry) {
    try {
      if (!inflightRefresh) {
        inflightRefresh = attemptTokenRefresh().finally(() => { inflightRefresh = null })
      }
      await inflightRefresh
      return request<T>(path, options, slugOverride, true)
    } catch {
      await clearSession()
      throw new ApiError('Sesión expirada', 401)
    }
  }

  if (response.status === 401 || response.status === 307) {
    throw new ApiError('Sesión expirada', 401)
  }

  // 300: server signals "multiple tenants found, pick one" — parse body and re-throw
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
  get:    <T>(path: string)                                    => request<T>(path, { method: 'GET' }),
  post:   <T>(path: string, body: unknown, slug?: string)      => request<T>(path, { method: 'POST',   body: JSON.stringify(body) }, slug),
  patch:  <T>(path: string, body: unknown)                     => request<T>(path, { method: 'PATCH',  body: JSON.stringify(body) }),
  put:    <T>(path: string, body: unknown)                     => request<T>(path, { method: 'PUT',    body: JSON.stringify(body) }),
  delete: <T>(path: string)                                    => request<T>(path, { method: 'DELETE' }),
}
