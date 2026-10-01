/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core"
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching"
import { NavigationRoute, registerRoute } from "workbox-routing"

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision?: string | null }>
}

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Somente navegações same-origin recebem o shell. Requests da API, arquivos e
// métodos de escrita não passam por esta rota.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api(?:\/|$)/, /\.[^/]+$/],
  })
)

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting()
})
clientsClaim()
