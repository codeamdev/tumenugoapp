import { View, ActivityIndicator } from 'react-native'

// AuthGuard en _layout.tsx maneja la redirección.
// Esta pantalla solo muestra un spinner mientras se restaura la sesión.
export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' }}>
      <ActivityIndicator size="large" color="#2563eb" />
    </View>
  )
}
