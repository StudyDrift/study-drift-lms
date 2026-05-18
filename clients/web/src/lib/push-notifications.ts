import { authorizedFetch } from './api'

const SW_PATH = '/sw.js'

async function getVAPIDPublicKey(): Promise<string | null> {
  try {
    const res = await fetch('/api/v1/push/vapid-public-key')
    if (!res.ok) return null
    const data = (await res.json()) as { publicKey?: string }
    return data.publicKey ?? null
  } catch {
    return null
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; ++i) {
    output[i] = raw.charCodeAt(i)
  }
  return output
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.register(SW_PATH)
    return reg
  } catch (err) {
    console.warn('[push] SW registration failed', err)
    return null
  }
}

export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!('PushManager' in window)) return null
  const vapidKey = await getVAPIDPublicKey()
  if (!vapidKey) return null

  const reg = await registerServiceWorker()
  if (!reg) return null

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null

  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
    })
    await savePushSubscription(sub)
    return sub
  } catch (err) {
    console.warn('[push] subscribe failed', err)
    return null
  }
}

export async function unsubscribeFromPush(subscriptionId: string): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration(SW_PATH)
  if (reg) {
    const sub = await reg.pushManager.getSubscription()
    if (sub) await sub.unsubscribe()
  }
  try {
    await authorizedFetch(`/api/v1/me/push-subscriptions/${subscriptionId}`, { method: 'DELETE' })
  } catch {
    /* ignore */
  }
}

async function savePushSubscription(sub: PushSubscription): Promise<string | null> {
  const json = sub.toJSON()
  const keys = json.keys as { p256dh?: string; auth?: string } | undefined
  if (!json.endpoint || !keys?.p256dh || !keys.auth) return null
  try {
    const res = await authorizedFetch('/api/v1/me/push-subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        userAgent: navigator.userAgent,
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { id?: string }
    return data.id ?? null
  } catch {
    return null
  }
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_PATH)
    return reg ? (await reg.pushManager.getSubscription()) : null
  } catch {
    return null
  }
}
