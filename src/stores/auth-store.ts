import { create } from 'zustand'
import { saveToken, saveRefreshToken, saveSession, clearSession, getToken, getRefreshToken, getSavedUser, getSavedTenant, getSavedConfig } from '@/lib/auth'
import { api } from '@/lib/api'
import { TENANT_URL } from '@/lib/config'
import type { AuthUser, AuthTenant, TenantConfig } from '@/types'

interface AuthState {
  user:            AuthUser | null
  tenant:          AuthTenant | null
  config:          TenantConfig | null
  isLoading:       boolean
  isAuthenticated: boolean

  login:   (params: { email: string; password: string; tenantSlug?: string }) => Promise<void>
  logout:  () => Promise<void>
  restore: () => Promise<void>
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

  login: async ({ email, password, tenantSlug }) => {
    // Pass tenantSlug as slug override so api.post sends x-tenant-slug for that call.
    // If tenantSlug is undefined, the env TENANT_SLUG is used (white-label mode).
    // If both are absent, backend resolves the tenant from user_tenant_map.
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

    set({
      user:            data.user,
      tenant:          data.tenant,
      config:          data.config ?? DEFAULT_CONFIG,
      isAuthenticated: true,
    })
  },

  logout: async () => {
    // Revoke the refresh token on the server before clearing local session.
    // If the request fails (network down, token already expired), we still
    // clear locally so the user is not stuck in a broken auth state.
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
      // Network error or token already invalid — proceed with local clear
    }
    await clearSession()
    set({ user: null, tenant: null, config: null, isAuthenticated: false })
  },

  restore: async () => {
    try {
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
