// Módulo de señal para comunicar fallos de auth desde api.ts
// sin crear dependencia circular (api ↔ auth-store)
type Callback = () => void
let _onAuthFail: Callback | null = null

export function setOnAuthFail(cb: Callback) { _onAuthFail = cb }
export function triggerAuthFail() { _onAuthFail?.() }
