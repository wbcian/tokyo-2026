/* 東京 2026 行程 app 的 service worker（最小版）
   - 核心檔預快取；HTML／JSON 走 network-first，但跟 2.5 秒計時器 race：
     地下站半開連線時不會白畫面等到 TCP 逾時，逾時就退 cache。
   - 版本字串換掉就會裝新 SW、activate 時刪舊 cache；skipWaiting＋clients.claim 讓下次載入就吃到新版。
   - 收到 'nuke' 訊息＝逃生口：清所有 cache 並解除註冊（standalone 沒網址列，頁內按鈕會送這個）。
   VERSION 由 deploy.sh 以時間戳替換；本地開發時是固定字串。 */
var VERSION = 'tokyo-2026-20260915-1529';
var CORE = ['./', './index.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];
var NET_TIMEOUT_MS = 2500;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    // addAll 是全有全無：核心清單任一 404 就整個 SW 不裝，所以核心只放一定存在的檔
    return c.addAll(CORE).then(function () {
      return c.add('./private.enc.json').catch(function () {}); // 選用：尚未上線時允許缺
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (e) {
  if (!e.data || e.data !== 'nuke') return;
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.registration.unregister(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(caches.open(VERSION).then(function (cache) {
    var net = fetch(req).then(function (r) {
      if (r && r.ok) cache.put(req, r.clone());
      return r;
    }).catch(function () { return null; });
    var slow = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, NET_TIMEOUT_MS); });
    return Promise.race([net, slow]).then(function (fresh) {
      if (fresh) return fresh;
      return cache.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') return cache.match('./index.html');
        return net.then(function (late) { return late || Response.error(); });
      });
    });
  }));
});
