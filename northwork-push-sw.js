const NORTHWORK_PUSH_ICON = "/northwork-push-icon.png";

self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", event => {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); }
  catch (_) { payload = { body: event.data.text() }; }

  const title = String(payload.title || "Northwork Chat").slice(0, 120);
  const body = String(payload.body || "You received a new message.").slice(0, 220);
  const icon = /^https:\/\//i.test(payload.icon || "") ? payload.icon : NORTHWORK_PUSH_ICON;
  const image = /^https:\/\//i.test(payload.image || "") ? payload.image : undefined;
  let safeTarget = new URL("/", self.location.origin);
  try {
    const candidate = new URL(typeof payload.url === "string" ? payload.url : "/", self.location.origin);
    if (candidate.origin === self.location.origin) safeTarget = candidate;
  } catch (_) {}

  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon,
    image,
    badge: NORTHWORK_PUSH_ICON,
    tag: String(payload.tag || "northwork-chat-message"),
    renotify: false,
    data: { url: safeTarget.pathname + safeTarget.search + safeTarget.hash, conversationId: payload.conversationId || null }
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(data.url || "/", self.location.origin);
  if (data.conversationId) target.searchParams.set("northwork-open-chat", data.conversationId);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && "focus" in client) {
        await client.navigate(target.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
