# Guía de compilación — TuMenuGo App Mobile

## Resumen

La app usa **Expo SDK 54** con Expo Router. Hay dos métodos de compilación:

| Método | Ventajas | Requiere |
|---|---|---|
| **EAS Build** (recomendado) | Compila en la nube, funciona desde Windows | Cuenta Expo gratuita |
| **Build local** | Sin dependencia de servicios externos | Android Studio / Mac con Xcode |

---

## Prerequisitos comunes

### 1. Node.js y herramientas
```bash
node --version   # >= 18
npm --version    # >= 9
```

### 2. Instalar Expo CLI y EAS CLI
```bash
npm install -g expo-cli eas-cli
```

### 3. Cuenta en Expo
Crear cuenta gratuita en https://expo.dev → necesaria para EAS Build.

### 4. Variables de entorno de producción
Crear el archivo `app/.env` (o `.env.local`) con:
```
EXPO_PUBLIC_TENANT_URL=http://2.25.145.148
EXPO_PUBLIC_TENANT_SLUG=
```
> `TENANT_SLUG` vacío = modo multi-tenant (el cajero inicia sesión y el sistema detecta su restaurante).
> Si la app es para un solo restaurante, poner el slug: `EXPO_PUBLIC_TENANT_SLUG=micafe`

---

## Método 1: EAS Build (recomendado para producción)

EAS compila la app en servidores de Expo. **Funciona desde Windows**, no requiere Android Studio ni Mac.

### Paso 1 — Configurar el proyecto

En `app/app.json`, verificar/ajustar:
```json
{
  "expo": {
    "name": "TuMenuGo",
    "slug": "tumenugo",
    "version": "1.0.0",
    "android": {
      "package": "com.tumenugo.app",
      "versionCode": 1
    },
    "ios": {
      "bundleIdentifier": "com.tumenugo.app",
      "buildNumber": "1"
    }
  }
}
```

### Paso 2 — Crear `eas.json`
Crear el archivo `app/eas.json`:
```json
{
  "cli": {
    "version": ">= 10.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "android": {
        "buildType": "app-bundle"
      }
    }
  },
  "submit": {
    "production": {}
  }
}
```

### Paso 3 — Login y vincular proyecto
```bash
cd app
eas login              # inicia sesión con tu cuenta Expo
eas build:configure    # vincula el proyecto (crea el project ID en expo.dev)
```

### Paso 4 — Compilar

#### Android — APK para pruebas (sideload, sin Play Store)
```bash
eas build --platform android --profile preview
```
Descarga el `.apk` desde el link que genera y lo instalas directamente en el teléfono.

#### Android — AAB para Google Play Store
```bash
eas build --platform android --profile production
```

#### iOS — IPA para pruebas (TestFlight / ad-hoc)
```bash
eas build --platform ios --profile preview
```
> Requiere Apple Developer Program ($99/año). EAS guía el proceso de certificates.

#### iOS — para App Store
```bash
eas build --platform ios --profile production
```

#### Ambas plataformas a la vez
```bash
eas build --platform all --profile production
```

---

## Método 2: Build local

### Android (desde Windows, Linux o Mac)

#### Requisitos
- **Android Studio** con SDK Platform 34+
- **JDK 17** (`java --version`)
- Variables de entorno configuradas:
  ```
  ANDROID_HOME=C:\Users\<usuario>\AppData\Local\Android\Sdk   (Windows)
  ANDROID_HOME=$HOME/Android/Sdk                               (Linux/Mac)
  ```

#### Pasos
```bash
cd app
npm install

# Generar el proyecto nativo (solo la primera vez)
npx expo prebuild --platform android

# Compilar APK de debug
cd android && ./gradlew assembleDebug

# Compilar APK de release (requiere keystore configurado)
cd android && ./gradlew assembleRelease

# O desde la raíz del proyecto
npx expo run:android
```

El APK queda en: `android/app/build/outputs/apk/release/app-release.apk`

#### Keystore para release (firma obligatoria)
```bash
keytool -genkey -v -keystore tumenugo.keystore \
  -alias tumenugo -keyalg RSA -keysize 2048 -validity 10000
```
Configurar en `android/app/build.gradle`:
```gradle
signingConfigs {
    release {
        storeFile file("tumenugo.keystore")
        storePassword "TU_PASSWORD"
        keyAlias "tumenugo"
        keyPassword "TU_PASSWORD"
    }
}
```

---

### iOS (solo desde Mac)

#### Requisitos
- **Mac** con macOS 13+
- **Xcode 15+** (desde App Store)
- **CocoaPods**: `sudo gem install cocoapods`
- **Apple Developer Program** ($99/año) para dispositivos físicos y distribución

#### Pasos
```bash
cd app
npm install

# Generar proyecto nativo (solo la primera vez)
npx expo prebuild --platform ios

# Instalar dependencias nativas
cd ios && pod install && cd ..

# Abrir en Xcode para firmar y compilar
open ios/tumenugo.xcworkspace
```

En Xcode:
1. Seleccionar el target → **Signing & Capabilities**
2. Elegir tu Apple Team
3. Product → **Archive** → distribuir por TestFlight o Ad Hoc

---

## Distribución

### Android

| Canal | Método | Para quién |
|---|---|---|
| **Directo (APK)** | Compartir el `.apk` por WhatsApp/Drive | Pruebas internas |
| **Google Play** | Subir `.aab` en Play Console | Clientes finales |
| **Firebase App Distribution** | `eas submit` o manual | Equipo de pruebas |

### iOS

| Canal | Método | Para quién |
|---|---|---|
| **TestFlight** | Subir IPA desde Xcode / EAS | Pruebas beta (hasta 10.000 testers) |
| **App Store** | Subir desde App Store Connect | Clientes finales |
| **Ad Hoc** | IPA instalado con UDID registrado | Máx. 100 dispositivos |

> Para iOS **no existe** el equivalente al APK de Android — no se puede instalar libremente sin Apple Developer Program.

---

## Flujo recomendado (primera vez)

```
1. Crear cuenta en expo.dev (gratis)
2. Ajustar app.json con nombre, package y bundleIdentifier
3. Crear eas.json (usar el de arriba)
4. Configurar .env con la URL del servidor de producción
5. eas build --platform android --profile preview
   → Obtienes APK en ~5 minutos para probar
6. Cuando esté listo para producción:
   eas build --platform android --profile production
   → Obtienes AAB para Play Store
7. Para iOS: contratar Apple Developer Program y repetir con --platform ios
```

---

## Actualizar la app (OTA — sin pasar por tiendas)

Expo permite actualizar el código JavaScript **sin recompilar** usando EAS Update:
```bash
eas update --branch production --message "Fix en pantalla de pedidos"
```
Los usuarios reciben la actualización automáticamente al abrir la app.
> Solo funciona para cambios en JS/assets. Cambios en código nativo (permisos, librerías nativas) requieren nueva build.

---

## Checklist antes de la primera build de producción

- [ ] `EXPO_PUBLIC_TENANT_URL` apunta al servidor real (`http://2.25.145.148` o dominio)
- [ ] `app.json` tiene `package` (Android) y `bundleIdentifier` (iOS) únicos
- [ ] `eas.json` creado en la carpeta `app/`
- [ ] Versión (`version` y `versionCode`/`buildNumber`) son correctas
- [ ] El servidor está levantado y responde en `/api/auth/me`
- [ ] Al menos un tenant activo creado en el superadmin
