export const TENANT_URL  = (process.env.EXPO_PUBLIC_TENANT_URL  ?? '').replace(/\/$/, '')
export const TENANT_SLUG = (process.env.EXPO_PUBLIC_TENANT_SLUG ?? '')

if (!TENANT_URL)  console.warn('[config] EXPO_PUBLIC_TENANT_URL no está definido')
if (!TENANT_SLUG) console.warn('[config] EXPO_PUBLIC_TENANT_SLUG no está definido')
