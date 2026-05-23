import { useState, useEffect } from 'react'
import NetInfo from '@react-native-community/netinfo'
import { onlineManager } from '@tanstack/react-query'

let networkListenerSetup = false

export function setupOnlineManager() {
  if (networkListenerSetup) return
  networkListenerSetup = true

  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(state.isConnected === true && state.isInternetReachable !== false)
    }),
  )
}

export function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState(true)

  useEffect(() => {
    NetInfo.fetch().then((state) => {
      setIsConnected(state.isConnected === true && state.isInternetReachable !== false)
    })

    return NetInfo.addEventListener((state) => {
      setIsConnected(state.isConnected === true && state.isInternetReachable !== false)
    })
  }, [])

  return { isConnected }
}
