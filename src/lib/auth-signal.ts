// Módulo de señal para comunicar fallos de auth/suspension desde api.ts
// sin crear dependencia circular (api ↔ auth-store)
type Callback = () => void
let _onAuthFail:   Callback | null = null
let _onSuspended:  Callback | null = null

export function setOnAuthFail(cb: Callback)  { _onAuthFail = cb }
export function triggerAuthFail()             { _onAuthFail?.() }

export function setOnSuspended(cb: Callback) { _onSuspended = cb }
export function triggerSuspended()           { _onSuspended?.() }
