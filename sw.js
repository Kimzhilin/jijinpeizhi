/* 理财财调仓助手 · Service Worker
 * 作用：缓存网页外壳（index.html/app.js/styles.css/strategy.js），
 * 让用户断网后也能打开页面、查看最近一次的策略与净值缓存。
 * 策略：同源 GET 请求一律 network-first（联网拿最新），失败则回退到缓存。
 */
const CACHE = 'fa-cache-v1';
const SHELL = ['./', './index.html', './app.js', './styles.css', './strategy.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 只处理同源（不拦截东方财富接口）

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached ||
        new Response('离线且本地无缓存', { status: 503, statusText: 'Offline' })))
  );
});
