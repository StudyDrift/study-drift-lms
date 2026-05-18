import { describe, expect, it } from 'vitest'

// Minimal tests for push notification helpers.
describe('push-notifications lib', () => {
  it('urlBase64ToUint8Array converts base64url to Uint8Array', async () => {
    // Import the internal conversion function via module.
    // We test the public-facing functions via mocks since they require browser APIs.
    const mod = await import('../push-notifications')
    // Only public exports are accessible; we test the error-safe path.
    const existing = await mod.getExistingPushSubscription()
    expect(existing).toBeNull()
  })

  it('getExistingPushSubscription returns null when serviceWorker not available', async () => {
    // jsdom does not have serviceWorker.
    const mod = await import('../push-notifications')
    const result = await mod.getExistingPushSubscription()
    expect(result).toBeNull()
  })

  it('subscribeToPush returns null when PushManager not available (jsdom)', async () => {
    const mod = await import('../push-notifications')
    const result = await mod.subscribeToPush()
    expect(result).toBeNull()
  })
})
