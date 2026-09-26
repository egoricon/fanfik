// Сервис-воркер «Двойников»: игру можно поставить на главный экран, а без интернета открываются
// игра на одном экране и обучение.
// Свои файлы — «сначала сеть, при ошибке кэш»: обновления доходят сразу, без сети игра берётся из кэша.
// Библиотеки с CDN (Trystero) и шрифты — «сначала кэш»: адреса с версией не меняются.
// Поменялась логика воркера — поднять VERSION: старый кэш удалится при активации.
const VERSION = 'dvoyniki-1';
const OWN = ['./', 'rules.js', 'crypto.js', 'net.js', 'manifest.webmanifest',
  'favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];
const CDN = /^https:\/\/(cdn\.jsdelivr\.net\/npm\/|esm\.sh\/|fonts\.googleapis\.com\/|fonts\.gstatic\.com\/)/;

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(VERSION).then((c) => c.addAll(OWN)).then(() => self.skipWaiting()));
});

// Кэш общий на весь egoricon.github.io (там могут жить и другие проекты): удаляем только свои старые версии.
self.addEventListener('activate', (ev) => {
  ev.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dvoyniki-') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Страница присылает адреса библиотек и шрифтов, загруженных до того, как воркер взял её под себя
// (при самом первом заходе): кладём их в кэш, чтобы в следующий раз они были и без сети.
self.addEventListener('message', (ev) => {
  const urls = (ev.data?.cache || []).filter((u) => typeof u === 'string' && CDN.test(u));
  if (urls.length) ev.waitUntil(caches.open(VERSION).then((c) => Promise.all(urls.map((u) => remember(c, u)))));
});

async function remember(cache, url) {
  if (await cache.match(url, { ignoreVary: true })) return;
  const res = await fetch(url, { mode: 'cors' }).catch(() => null);
  if (!res?.ok) return;
  // Файлы шрифтов подключает чужой стиль, в список загрузок страницы они не попадают: берём адреса из стиля.
  // Google отдаёт стиль с CORS, поэтому воркер может его прочитать.
  if (url.startsWith('https://fonts.googleapis.com/')) {
    const fonts = new Set((await res.clone().text()).match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+/g));
    await Promise.all([...fonts].map((f) => remember(cache, f)));
  }
  await cache.put(url, res);
}

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) ev.respondWith(networkFirst(req, url));
  else if (CDN.test(req.url)) ev.respondWith(cacheFirst(req));
});

async function networkFirst(req, url) {
  const cache = await caches.open(VERSION);
  // Страница игры лежит в кэше под одним адресом: без ?room= и без index.html (иначе без сети могла бы открыться старая копия).
  const key = req.mode === 'navigate' ? url.origin + url.pathname.replace(/index\.html$/, '') : req;
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key, { ignoreVary: true }) || (req.mode === 'navigate' && await cache.match('./'));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  // Ответы CDN и Google различаются по Vary (Origin, Sec-Fetch-*), а файл по адресу с версией всегда один
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') await cache.put(req, res.clone());
  return res;
}
