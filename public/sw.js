/* ==========================================================================
   VORTEX VIP ⚡ - Service Worker Oficial PWA
   ========================================================================== */

const CACHE_NAME = 'vortex-vip-v1.0.227';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/style.css?v=1.0.227',
  '/script.js?v=1.0.227',
  '/manifest.json',
  '/icons/vortex-vip-192.png',
  '/icons/vortex-vip-512.png',
  '/icons/vortex-vip-maskable-512.png',
  '/icons/vortex-vip.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/icon.svg',
  '/favicon.ico',
  '/sounds/ringtone.mp3',
  '/sounds/notification.mp3',
  '/sounds/message-send.mp3',
  '/sounds/unlock.mp3'
];

// Instalação: Pré-carrega o App Shell no Cache e ativa imediatamente
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Aviso no precache:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Ativação: Limpa caches de versões anteriores e assume o controle dos clientes
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Requisições (Fetch): Estratégia híbrida resiliente e suporte offline
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!request || request.method !== 'GET') return;

  const url = new URL(request.url);

  // Ignora APIs de tempo real do Firebase, WebRTC e pagamentos (devem ir direto à rede)
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('mercadopago.com') ||
    url.protocol === 'chrome-extension:' ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/version.json' ||
    url.pathname === '/sw.js'
  ) {
    return;
  }

  // Navegação de páginas (HTML): Network-first com fallback para index em cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match('/index.html').then((cached) => cached || caches.match('/'));
        })
    );
    return;
  }

  // Recursos estáticos locais (CSS, JS, Imagens, Fontes): Cache-first com revalidação
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          // Atualiza em segundo plano (stale-while-revalidate)
          fetch(request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
            }
          }).catch(() => {});
          return cachedResponse;
        }

        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Requisições externas CDN (Lucide, Google Fonts, MercadoPago SDK): Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        }
        return networkResponse;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});

// ===== Chamadas recebidas com o app fechado (Firebase Cloud Messaging) =====
const FIRESTORE_REST_BASE = 'https://firestore.googleapis.com/v1/projects/menssagem-dx/databases/(default)/documents';
const CALL_RING_MAX_MS = 40000;
const CALL_RING_INTERVAL_MS = 4000;

// O FCM entrega { data: {...}, from, fcmMessageId }; push comum entrega o JSON direto.
function normalizePushPayload(event) {
  let raw = {};
  if (event.data) {
    try {
      raw = event.data.json();
    } catch (_) {
      raw = { body: event.data.text() };
    }
  }
  if (raw && raw.data && typeof raw.data === 'object') {
    return { ...raw.data, ...(raw.notification || {}) };
  }
  return raw || {};
}

async function fetchCallStatus(callId) {
  try {
    const res = await fetch(`${FIRESTORE_REST_BASE}/calls/${encodeURIComponent(callId)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const doc = await res.json();
    return doc && doc.fields && doc.fields.status ? doc.fields.status.stringValue : null;
  } catch (_) {
    return null;
  }
}

async function rejectCallFromWorker(callId) {
  try {
    await fetch(
      `${FIRESTORE_REST_BASE}/calls/${encodeURIComponent(callId)}?updateMask.fieldPaths=status&updateMask.fieldPaths=endedAt`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            status: { stringValue: 'rejected' },
            endedAt: { integerValue: String(Date.now()) }
          }
        })
      }
    );
  } catch (err) {
    console.warn('[SW] Não foi possível recusar a chamada:', err);
  }
}

function buildCallNotificationOptions(payload, renotify) {
  const callId = payload.callId;
  const isVideo = payload.isVideo !== '0';
  return {
    body: isVideo ? 'Chamada de vídeo recebida' : 'Chamada de voz recebida',
    icon: payload.callerAvatar || '/icons/vortex-vip-192.png',
    badge: '/icons/vortex-vip-192.png',
    tag: `vortex-call-${callId}`,
    renotify: !!renotify,
    requireInteraction: true,
    silent: false,
    vibrate: [600, 250, 600, 250, 600, 250, 600],
    timestamp: Date.now(),
    actions: [
      { action: 'answer', title: 'Atender' },
      { action: 'decline', title: 'Recusar' }
    ],
    data: {
      type: 'call',
      callId,
      callerUid: payload.callerUid || '',
      url: payload.url || `/?call=${encodeURIComponent(callId)}`
    }
  };
}

async function closeCallNotifications(callId) {
  const list = await self.registration.getNotifications({ tag: `vortex-call-${callId}` });
  list.forEach((n) => n.close());
}

// Mantém o celular "tocando": reapresenta a notificação enquanto a chamada ainda estiver chamando
async function ringCallNotification(payload) {
  const callTitle = `${payload.callerName || 'Contato VIP'} está ligando`;
  await self.registration.showNotification(callTitle, buildCallNotificationOptions(payload, false));

  const startedAt = Date.now();
  while (Date.now() - startedAt < CALL_RING_MAX_MS) {
    await new Promise((resolve) => setTimeout(resolve, CALL_RING_INTERVAL_MS));
    const status = await fetchCallStatus(payload.callId);
    if (status && status !== 'ringing') {
      await closeCallNotifications(payload.callId);
      return;
    }
    const stillShown = await self.registration.getNotifications({ tag: `vortex-call-${payload.callId}` });
    if (stillShown.length === 0) return; // usuário dispensou ou atendeu
    await self.registration.showNotification(callTitle, buildCallNotificationOptions(payload, true));
  }
  await closeCallNotifications(payload.callId);
}

// Suporte a Notificações Push PWA
self.addEventListener('push', (event) => {
  const payload = normalizePushPayload(event);

  if (payload.type === 'call' && payload.callId) {
    event.waitUntil((async () => {
      // Se o app estiver aberto e visível, o próprio app já toca a chamada
      const openClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (openClients.some((c) => c.visibilityState === 'visible')) return;
      await ringCallNotification(payload);
    })());
    return;
  }

  const data = {
    title: payload.title || 'VORTEX VIP ⚡',
    body: payload.body || 'Você recebeu uma nova notificação!',
    url: payload.url
  };

  const options = {
    body: data.body,
    icon: '/icons/vortex-vip-192.png',
    badge: '/icons/vortex-vip-192.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/'
    }
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Clique na Notificação PWA (Mobile e Desktop)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};
  const isCall = notifData.type === 'call' && notifData.callId;

  if (isCall && event.action === 'decline') {
    event.waitUntil(rejectCallFromWorker(notifData.callId));
    return;
  }

  const targetChatId = notifData.chatId;
  const answerNow = isCall && event.action === 'answer';
  let targetUrl = notifData.url || '/';
  if (isCall && answerNow) {
    targetUrl = `/?call=${encodeURIComponent(notifData.callId)}&answer=1`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if (isCall) {
            client.postMessage({ type: 'INCOMING_CALL', callId: notifData.callId, answer: answerNow });
          } else if (targetChatId) {
            client.postMessage({ type: 'OPEN_CHAT', chatId: targetChatId });
          }
          return client.focus();
        }
      }
      if (clients.openWindow) {
        const fullUrl = (!isCall && targetChatId) ? `/?chat=${targetChatId}` : targetUrl;
        return clients.openWindow(fullUrl);
      }
    })
  );
});

// Ativação Imediata solicitada pelo aplicativo (Botão Atualizar)
self.addEventListener('message', (event) => {
  if (event.data && (event.data.type === 'SKIP_WAITING' || event.data === 'skipWaiting')) {
    self.skipWaiting();
  }
});

