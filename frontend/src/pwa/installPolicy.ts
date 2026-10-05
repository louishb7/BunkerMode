export const INSTALL_DISMISS_KEY = "bunkermode_install_dismissed_until"
const DISMISS_DURATION = 30 * 86400_000

type Device = Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">
export function isMobileInstallDevice(device: Device) {
  return /Android|iPhone|iPad|iPod/i.test(device.userAgent) ||
    (device.platform === "MacIntel" && device.maxTouchPoints > 1)
}
export function isIosSafari(device: Device) {
  const ios = /iPhone|iPad|iPod/i.test(device.userAgent) ||
    (device.platform === "MacIntel" && device.maxTouchPoints > 1)
  return ios && /Safari/.test(device.userAgent) && !/CriOS|FxiOS|EdgiOS|Chrome/.test(device.userAgent)
}
export function installDismissed(storage: Storage, now = Date.now()) {
  try { return Number(storage.getItem(INSTALL_DISMISS_KEY)) > now } catch { return false }
}
export function dismissInstall(storage: Storage, now = Date.now()) {
  try { storage.setItem(INSTALL_DISMISS_KEY, String(now + DISMISS_DURATION)) } catch { /* A sessão ainda guarda a dispensa. */ }
}
