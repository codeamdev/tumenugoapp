import { create } from 'zustand'
import {
  saveToken, saveRefreshToken, saveSession, clearSession,
  getToken, getRefreshToken, getSavedUser, getSavedTenant, getSavedConfig,
  saveOfflineCredential, verifyOfflineCredential, hasOfflineCredential,
  lockSession, unlockSession, isSessionLocked,
} from '@/lib/auth'
import { api } from '@/lib/api'
import { TENANT_URL } from '@/lib/config'
import type { AuthUser, AuthTenant, TenantConfig } from '@/types'

interface AuthState {
  user:            AuthUser | null
  tenant:          AuthTenant | null
  config:          TenantConfig | null
  isLoading:       boolean
  isAuthenticated: boolean

  login:         (params: { email: string; password: string; tenantSlug?: string }) => Promise<void>
  offlineLogin:  (params: { email: string; password: string }) => Promise<boolean>
  logout:        () => Promise<void>
  restore:       () => Promise<void>
}

const DEFAULT_CONFIG: TenantConfig = {
  paymentMethods: [
    { key: 'cash',     label: 'Efectivo'      },
    { key: 'card',     label: 'Tarjeta'       },
    { key: 'transfer', label: 'Transferencia' },
  ],
}

export const useAuthStore = create<AuthState>((set) => ({
  user:            null,
  tenant:          null,
  config:          null,
  isLoading:       true,
  isAuthenticated: false,

  // Login online: autenticación con el servidor
  login: async ({ email, password, tenantSlug }) => {
    const data = await api.post<{
      user:         AuthUser
      tenant:       AuthTenant
      config:       TenantConfig
      accessToken:  string
      refreshToken: string
    }>('/api/auth/login', { email, password }, tenantSlug)

    await saveToken(data.accessToken)
    if (data.refreshToken) await saveRefreshToken(data.refreshToken)
    await saveSession(
      data.user   as unknown as Record<string, unknown>,
      data.tenant as unknown as Record<string, unknown>,
      (data.config ?? DEFAULT_CONFIG) as unknown as Record<string, unknown>,
    )

    // Guarda credencial offline para permitir login sin internet
    await saveOfflineCredential(email, password)
    await unlockSession()

    set({
      user:            data.user,
      tenant:          data.tenant,
      config:          data.config ?? DEFAULT_CONFIG,
      isAuthenticated: true,
    })
  },

  // Login offline: verifica credenciales localmente y restaura sesión guardada
  offlineLogin: async ({ email, password }) => {
    const valid = await verifyOfflineCredential(email, password)
    if (!valid) return false

    const [token, user, tenant, config] = await Promise.all([
      getToken(),
      getSavedUser(),
      getSavedTenant(),
      getSavedConfig(),
    ])

    if (!user || !tenant) return false

    await unlockSession()

    set({
      user:            user   as unknown as AuthUser,
      tenant:          tenant as unknown as AuthTenant,
      config:          (config as unknown as TenantConfig) ?? DEFAULT_CONFIG,
      isAuthenticated: true,
    })
    return true
  },

  // Logout: intenta revocar en servidor (best-effort) y bloquea la sesión localmente.
  // Los tokens y datos quedan en el dispositivo para permitir reingreso offline.
  logout: async () => {
    try {
      const refreshToken = await getRefreshToken()
      if (refreshToken) {
        await fetch(`${TENANT_URL}/api/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${refreshToken}`,
          },
        })
      }
    } catch {
      // Sin red: la sesión queda bloqueada localmente, se revocará cuando vuelva la conexión
    }

    // Bloquear sesión (soft) — no borrar tokens ni datos offline
    await lockSession()
    set({ user: null, tenant: null, config: null, isAuthenticated: false })
  },

  // Restaurar sesión al arrancar la app
  restore: async () => {
    try {
      const locked = await isSessionLocked()

      // Si está bloqueada, no restaurar — el usuario debe volver a ingresar
      if (locked) return

      const [token, user, tenant, config] = await Promise.all([
        getToken(),
        getSavedUser(),
        getSavedTenant(),
        getSavedConfig(),
      ])

      if (token && user && tenant) {
        set({
          user:            user   as unknown as AuthUser,
          tenant:          tenant as unknown as AuthTenant,
          config:          (config as unknown as TenantConfig) ?? DEFAULT_CONFIG,
          isAuthenticated: true,
        })
      }
    } finally {
      set({ isLoading: false })
    }
  },
}))

// Exporta funciones de consulta para la pantalla de login
export { hasOfflineCredential }
