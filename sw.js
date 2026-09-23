/* ============================================================
 * 深海汤屋 · 离线缓存
 * ------------------------------------------------------------
 * 策略：
 *   - 页面 / 样式 / 脚本 / manifest 走「网络优先」，保证改完就生效
 *   - 图片 / 字体走「缓存优先」，二次访问秒开
 * ============================================================ */
var CACHE = "deepsea-soup-v7";
var SHELL = [
  "./",
  "index.html",
  "style.css",
  "manifest.webmanifest",
  "js/data.js",
  "js/library.public.js",
  "js/engine.js",
  "js/ai.js",
  "js/audio.js",
  "js/fx.js",
  "js/net.js",
  "js/room-ui.js",
  "js/app.js",
  "js/data-more.js",
  "assets/bg-castle.webp",
  "assets/bg-hall.webp",
  "assets/bg-dawn.webp",
  "assets/bg-gate.webp",
  "assets/fonts/NotoSerifSC-title.woff2"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .catch(function () { /* 个别文件缺失也不阻塞安装 */ })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  var networkFirst = req.mode === "navigate" || /\.(html|css|js|json|webmanifest)$/.test(url.pathname);

  if (networkFirst) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () { });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match("index.html");
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () { });
        return res;
      });
    })
  );
});
