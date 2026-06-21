import { useColorScheme } from 'react-native'
import { useThemeStore } from '@/stores/theme-store'

export interface AppColors {
  // Backgrounds
  background: string    // screen root
  surface: string       // cards, modals
  surfaceAlt: string    // input backgrounds, secondary surfaces
  overlay: string       // bottom sheets, overlays
  // Text
  text: string          // primary
  textSecondary: string // secondary
  textMuted: string     // hints, placeholders
  textInverse: string   // text on dark/colored backgrounds
  // Borders
  border: string
  borderStrong: string
  // Semantic
  danger: string
  dangerLight: string
  success: string
  successLight: string
  warning: string
  warningLight: string
  // Shadows
  shadow: string
}

export const lightColors: AppColors = {
  background: '#f8fafc',
  surface: '#ffffff',
  surfaceAlt: '#f1f5f9',
  overlay: '#ffffff',
  text: '#0f172a',
  textSecondary: '#374151',
  textMuted: '#94a3b8',
  textInverse: '#ffffff',
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  danger: '#ef4444',
  dangerLight: '#fee2e2',
  success: '#10b981',
  successLight: '#d1fae5',
  warning: '#f59e0b',
  warningLight: '#fef3c7',
  shadow: '#000000',
}

export const darkColors: AppColors = {
  background: '#0f172a',
  surface: '#1e293b',
  surfaceAlt: '#0f172a',
  overlay: '#1e293b',
  text: '#f1f5f9',
  textSecondary: '#cbd5e1',
  textMuted: '#64748b',
  textInverse: '#ffffff',
  border: '#334155',
  borderStrong: '#475569',
  danger: '#f87171',
  dangerLight: '#450a0a',
  success: '#34d399',
  successLight: '#022c22',
  warning: '#fbbf24',
  warningLight: '#451a03',
  shadow: '#000000',
}

/** Returns the active color palette based on user preference or system setting. */
export function useAppColors(): AppColors {
  const systemScheme = useColorScheme()
  const { mode } = useThemeStore()

  const resolved = mode === 'system' ? systemScheme : mode
  return resolved === 'dark' ? darkColors : lightColors
}
