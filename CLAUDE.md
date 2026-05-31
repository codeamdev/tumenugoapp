# CLAUDE.md — CafeteriaOS Mobile

App mobile POS multi-tenant para cafeterías/restaurantes (iOS + Android + web).

## Stack

- React Native 0.81.5 · Expo ~54.0.0 · Expo Router ~6.0.23 (file-based, typed routes)
- TypeScript 5.3.0 — strict mode
- Zustand ^5.0.0 (auth-store, pos-store)
- TanStack Query ^5.59.0 + AsyncStorage persister (cache 24h para offline)
- expo-sqlite ~16.0.10 (cola de sync offline)
- expo-secure-store ~15.0.8 (tokens en nativo; AsyncStorage en web)
- @react-native-community/netinfo 11.4.1
- Íconos: @expo/vector-icons (Ionicons)
- Gestor de paquetes: **npm**

## Comandos

```bash
npm install                  # instalar deps
npx expo start               # dev (Expo Go / emulador)
npm run android              # correr en Android nativo
npm run ios                  # correr en iOS nativo
npx tsc --noEmit             # type check (único check automatizable; no hay lint ni tests)
```

Build de distribución requiere `eas.json` (no está en el repo) + `npm run build:android|ios`.

## Variables de entorno (.env.local)

```
EXPO_PUBLIC_TENANT_URL=http://<ip>:<puerto>   # sin / al final
EXPO_PUBLIC_TENANT_SLUG=<slug>                # vacío = modo multi-tenant
```

## Estructura

```
app/
  _layout.tsx        Root: QueryClient, PersistQueryClientProvider, AuthGuard, SyncManager
  login.tsx          Login + TenantPicker (HTTP 300 → selector de establecimiento)
  index.tsx          Redirect entry
  (tabs)/
    _layout.tsx      Tab bar con visibilidad por rol
    pos.tsx          Catálogo + carrito + crear pedido (offline-ready)
    pedidos.tsx      Lista activa/historial + detalle + cobrar
    cocina.tsx       KDS — auto-refresh 5 s, optimistic updates
    caja.tsx         Abrir/cerrar caja, KPIs, historial (requiere conexión)
    mas/
      index.tsx      Hub de menú (visibilidad por rol)
      mesas.tsx      Estado de mesas
      informes.tsx   Ventas y estadísticas
      productos.tsx  Toggle disponibilidad de productos
      usuarios.tsx   Gestión de empleados
      configuracion.tsx Config del tenant

src/
  types/index.ts     Todos los tipos + ORDER_STATUS_LABELS/COLORS, ORDER_TYPE_LABELS
  lib/
    api.ts           Wrapper fetch: JWT, auto-refresh (single-flight), ApiError, HTTP 300
    auth.ts          SecureStore/AsyncStorage: tokens + sesión (user, tenant, config)
    config.ts        EXPO_PUBLIC_* vars
    utils.ts         formatCurrency (es-CO), formatDateTime, elapsedMinutes
    order-calc.ts    Cálculo puro de totales — sin imports de RN, compartible con web
    offline/
      db.ts          Init SQLite: tablas sync_queue + offline_orders
      sync-queue.ts  Enqueue/process operaciones offline
  stores/
    auth-store.ts    Zustand: user, tenant, config, login/logout/restore
    pos-store.ts     Zustand: cart, orderType, campos de cliente
  hooks/
    use-network.ts      NetInfo + onlineManager de RQ
    use-offline-sync.ts Procesar cola al reconectar
  components/
    OfflineBanner.tsx   Banner offline/sincronizando con conteo de pendientes
```

## Convenciones

**Tipos y API**
- Valores monetarios llegan del backend como `string` (Prisma Decimal). Siempre `parseFloat()` antes de aritmética.
- Todos los tipos compartidos van en `src/types/index.ts`. Tipos locales de pantalla pueden ser inline.
- Path alias `@/` → `src/`. Usar siempre; nunca paths relativos que crucen carpetas.

**Estilos**
- Todo con `StyleSheet.create()` al final del archivo. Sin librerías de estilos externas.
- Color primario: `tenant?.primaryColor ?? '#2563eb'`. Divisa: `tenant?.currencySign ?? '$'` + `formatCurrency()`.

**Estado**
- Estado de servidor → TanStack Query. UI efímera → `useState`. Global persistente → Zustand.
- `clearCart()` limpia también tableId, customerName, deliveryFee, notes. Llamarlo siempre tras crear un pedido.

**Offline**
- Crear pedido offline: `saveOfflineOrder(localId, payload)` + `enqueueSync('create_order', payload)`.
- Detección de error de red: `!isConnected || err?.message?.includes('Network request failed')`.
- Operaciones soportadas en cola: `create_order`, `update_order_status`, `cancel_item`, `toggle_product`, `toggle_table_status`.
- Patrón en pantallas: optimistic update → llamada API → si falla por red, re-aplica el estado, encola y cierra el modal.

**Roles**
- `admin | cajero | mesero | cocina`.
- Visibilidad de tabs: `ROLE_TABS` en `app/(tabs)/_layout.tsx`.
- Visibilidad en "Más": `MENU[].roles` en `app/(tabs)/mas/index.tsx`.
- Redirect por rol al login: `ROLE_HOME` en `app/_layout.tsx`.

## Reglas / cosas a evitar

- No terminar `EXPO_PUBLIC_TENANT_URL` con `/`.
- No importar nada de React Native en `src/lib/order-calc.ts` — es puro para poder compartirlo con la web.
- No llamar `setupOnlineManager()` más de una vez; tiene guard interno pero duplicaría el listener de NetInfo.
- Las operaciones de `caja.tsx` no tienen soporte offline — siempre verificar `isConnected` antes de llamar a la API.
- No cambiar `gcTime` de las queries sin razón: el persister usa el global (24h) para la deserialización.

## Eficiencia de tokens

- Respuestas cortas. Sin preámbulos ("Claro, voy a...") ni resúmenes finales de lo que se hizo.
- No explicar qué hace un framework o librería — el stack ya es conocido.
- No repetir el código que se acaba de editar; el diff es suficiente.
- Leer solo las secciones del archivo necesarias (`offset` + `limit`), no archivos completos.
- No hacer `Read` de un archivo recién escrito para "verificar" — si el tool no falló, el cambio fue aplicado.
- Preferir `Edit` sobre `Write` en archivos existentes.
- Agrupar todas las llamadas a tools independientes en un solo turno (parallel tool calls).
- Si la tarea es clara, ejecutar directamente sin pedir confirmación previa.

## Definición de "terminado"

```bash
npx tsc --noEmit   # debe pasar sin errores
```

No hay tests automatizados. Los cambios de UI requieren verificación manual en Expo Go o emulador.
