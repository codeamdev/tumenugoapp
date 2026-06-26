export const TENANT_URL  = (process.env.EXPO_PUBLIC_TENANT_URL  ?? '').replace(/\/$/, '')
export const TENANT_SLUG = (process.env.EXPO_PUBLIC_TENANT_SLUG ?? '')

if (__DEV__ && !TENANT_URL)  console.warn('[config] EXPO_PUBLIC_TENANT_URL no está definido')
// TENANT_SLUG vacío es válido en modo multi-tenant — solo advertir en desarrollo
if (__DEV__ && !TENANT_SLUG) console.warn('[config] EXPO_PUBLIC_TENANT_SLUG no está definido (modo multi-tenant activo)')
