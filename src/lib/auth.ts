import * as SecureStore from 'expo-secure-store'
import * as Crypto from 'expo-crypto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'

async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(key)
  return SecureStore.getItemAsync(key)
}

async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') { await AsyncStorage.setItem(key, value); return }
  await SecureStore.setItemAsync(key, value)
}

async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === 'web') { await AsyncStorage.removeItem(key); return }
  await SecureStore.deleteItemAsync(key)
}

const TOKEN_KEY          = 'cf_access_token'
const REFRESH_TOKEN_KEY  = 'cf_refresh_token'
const USER_KEY           = 'cf_user'
const TENANT_KEY         = 'cf_tenant'
const CONFIG_KEY         = 'cf_config'
const OFFLINE_CRED_KEY   = 'cf_offline_cred'   // { email, hash }
const SESSION_LOCKED_KEY = 'cf_session_locked'  // 'true' cuando cerró sesión sin borrar tokens

// ─── Tokens ──────────────────────────────────────────────────────────────────

export async function saveToken(token: string): Promise<void> { await secureSet(TOKEN_KEY, token) }
export async function getToken(): Promise<string | null>       { return secureGet(TOKEN_KEY) }
export async function clearToken(): Promise<void>              { await secureDelete(TOKEN_KEY) }

export async function saveRefreshToken(token: string): Promise<void> { await secureSet(REFRESH_TOKEN_KEY, token) }
export async function getRefreshToken(): Promise<string | null>       { return secureGet(REFRESH_TOKEN_KEY) }
export async function clearRefreshToken(): Promise<void>              { await secureDelete(REFRESH_TOKEN_KEY) }

// ─── Sesión (user / tenant / config) ─────────────────────────────────────────

export async function saveSession(
  user: Record<string, unknown>,
  tenant: Record<string, unknown>,
  config: Record<string, unknown>,
): Promise<void> {
  await AsyncStorage.multiSet([
    [USER_KEY,   JSON.stringify(user)],
    [TENANT_KEY, JSON.stringify(tenant)],
    [CONFIG_KEY, JSON.stringify(config)],
  ])
}

export async function getSavedUser():   Promise<Record<string, unknown> | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);   return raw ? JSON.parse(raw) : null
}
export async function getSavedTenant(): Promise<Record<string, unknown> | null> {
  const raw = await AsyncStorage.getItem(TENANT_KEY); return raw ? JSON.parse(raw) : null
}
export async function getSavedConfig(): Promise<Record<string, unknown> | null> {
  const raw = await AsyncStorage.getItem(CONFIG_KEY); return raw ? JSON.parse(raw) : null
}

// Borra TODO (logout online / forzado por servidor)
export async function clearSession(): Promise<void> {
  await Promise.all([clearToken(), clearRefreshToken()])
  await AsyncStorage.multiRemove([USER_KEY, TENANT_KEY, CONFIG_KEY])
  await secureDelete(OFFLINE_CRED_KEY)
  await secureDelete(SESSION_LOCKED_KEY)
}

// ─── Credenciales offline ─────────────────────────────────────────────────────

// Guarda un hash derivado de email+password tras login exitoso online.
// Permite verificar la identidad del usuario cuando no hay internet.
export async function saveOfflineCredential(email: string, password: string): Promise<void> {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${email.toLowerCase()}:${password}:cf_offline_v1`,
  )
  await secureSet(OFFLINE_CRED_KEY, JSON.stringify({ email: email.toLowerCase(), hash }))
}

export async function verifyOfflineCredential(email: string, password: string): Promise<boolean> {
  const raw = await secureGet(OFFLINE_CRED_KEY)
  if (!raw) return false
  try {
    const stored = JSON.parse(raw) as { email: string; hash: string }
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${email.toLowerCase()}:${password}:cf_offline_v1`,
    )
    return stored.email === email.toLowerCase() && stored.hash === hash
  } catch {
    return false
  }
}

export async function hasOfflineCredential(): Promise<boolean> {
  const raw = await secureGet(OFFLINE_CRED_KEY)
  return raw !== null
}

// ─── Sesión bloqueada (logout soft) ──────────────────────────────────────────

// Marca la sesión como "bloqueada" — los tokens y datos quedan en el dispositivo
// para permitir reingreso offline, pero el estado Zustand se limpia.
export async function lockSession(): Promise<void> {
  await secureSet(SESSION_LOCKED_KEY, 'true')
}

export async function isSessionLocked(): Promise<boolean> {
  return (await secureGet(SESSION_LOCKED_KEY)) === 'true'
}

export async function unlockSession(): Promise<void> {
  await secureDelete(SESSION_LOCKED_KEY)
}
