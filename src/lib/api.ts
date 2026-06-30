import { getToken, saveToken, getRefreshToken, saveRefreshToken, clearSession } from './auth'
import { TENANT_URL, TENANT_SLUG } from './config'
import { triggerAuthFail, triggerSuspended } from './auth-signal'

export class ApiError extends Error {
  body?: unknown
  constructor(message: string, public readonly status: number, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.body = body
  }
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
    // redirect: 'manual' intenta evitar que fetch siga el 307 a /login HTML.
    // En React Native puede ignorarse; el Content-Type check más abajo es el fallback.
    response = await fetch(`${TENANT_URL}${path}`, { ...options, headers, redirect: 'manual' })
  } catch (err) {
    // Pure network error (device offline, DNS failure, timeout)
    throw new ApiError('Sin conexión', 0)
  }

  // Si el servidor siguió la redirección y devolvió HTML (login page),
  // la respuesta tendrá status 200 pero Content-Type text/html.
  // Tratarlo como expiración de sesión y disparar refresh.
  const contentType = response.headers.get('content-type') ?? ''
  if (response.ok && contentType.includes('text/html')) {
    if (!isRetry) {
      try {
        if (!inflightRefresh) {
          inflightRefresh = attemptTokenRefresh().finally(() => { inflightRefresh = null })
        }
        await inflightRefresh
        return request<T>(path, options, slugOverride, true)
      } catch (err) {
        const msg = (err as Error).message
        if (msg === 'NETWORK_ERROR') throw new ApiError('Sin conexión', 0)
        await clearSession()
        triggerAuthFail()
        throw new ApiError('Sesión expirada', 401)
      }
    }
    await clearSession()
    triggerAuthFail()
    throw new ApiError('Sesión expirada', 401)
  }

  // Los endpoints de auth manejan sus propios 401 (credenciales inválidas, etc.)
  // No disparar el ciclo de refresh para ellos — caerán al handler de !response.ok
  const isAuthEndpoint = path.startsWith('/api/auth/') || path.startsWith('/api/superadmin/auth/')

  // 401 or 307 (Next.js redirect to /login when session expired)
  if ((response.status === 401 || response.status === 307) && !isRetry && !isAuthEndpoint) {
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

  if ((response.status === 401 || response.status === 307) && !isAuthEndpoint) {
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
      // Detectar suspensión del tenant → mostrar pantalla informativa
      const code = (body as Record<string, unknown>)?.code
      if (response.status === 403 && code === 'TENANT_SUSPENDED') {
        triggerSuspended()
      }
    } catch {}
    throw new ApiError(message, response.status, body)
  }

  const text = await response.text()
  if (!text) return {} as T
  try {
    return JSON.parse(text)
  } catch {
    // Respuesta no es JSON (ej: HTML inesperado) — tratar como error de sesión
    if (!isRetry) {
      try {
        if (!inflightRefresh) {
          inflightRefresh = attemptTokenRefresh().finally(() => { inflightRefresh = null })
        }
        await inflightRefresh
        return request<T>(path, options, slugOverride, true)
      } catch {}
    }
    await clearSession()
    triggerAuthFail()
    throw new ApiError('Sesión expirada', 401)
  }
}

export const api = {
  get:    <T>(path: string)                               => request<T>(path, { method: 'GET' }),
  post:   <T>(path: string, body: unknown, slug?: string) => request<T>(path, { method: 'POST',   body: JSON.stringify(body) }, slug),
  patch:  <T>(path: string, body: unknown)                => request<T>(path, { method: 'PATCH',  body: JSON.stringify(body) }),
  put:    <T>(path: string, body: unknown)                => request<T>(path, { method: 'PUT',    body: JSON.stringify(body) }),
  delete: <T>(path: string)                               => request<T>(path, { method: 'DELETE' }),
}
