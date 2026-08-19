/* ══════════════════════════════════════════════════════════
 *  주차위치현황판 — 오프라인 서비스워커 (sw.js)
 *
 *  역할
 *   · 앱 HTML(껍데기)과 Firebase CDN 스크립트를 캐시해, 인터넷이 없어도
 *     현황판 화면이 뜨고 마지막으로 받은 데이터로 조회가 되도록 함.
 *   · 실시간 동기화(다른 기기와 즉시 반영)는 인터넷이 있어야 동작 —
 *     Firebase 실시간 통신은 캐시 대상이 아니며 항상 최신으로 통과시킴.
 *
 *  배포
 *   · 이 파일(sw.js)을 index.html 과 "같은 폴더"에 올린다.
 *     (Netlify, GitHub Pages 모두 동일)
 *   · 내용이 바뀌면 아래 CACHE_VER 의 v숫자를 올려 새 캐시로 교체한다.
 *     (파일 내용이 그대로면 다시 올릴 필요 없음)
 * ══════════════════════════════════════════════════════════ */

var CACHE_VER = 'parking-cache-v1';

/* 오프라인 구동에 꼭 필요한 최소 자원 */
var PRECACHE_URLS = [
  './',
  './index.html',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js'
];

/* ── 설치: 핵심 자원 미리 캐시 ── */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VER).then(function (cache) {
      return Promise.all(PRECACHE_URLS.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    })
  );
});

/* ── 활성화: 이전 버전 캐시 정리 ── */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_VER) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* ── 새 버전 즉시 적용(앱에서 SKIP_WAITING 메시지 받을 때) ── */
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ── fetch 전략 ──
 *  · Firebase 실시간 DB / 구글 API 통신: 캐시 개입 없이 그대로 통과(항상 최신)
 *  · 페이지 이동(HTML): 네트워크 우선 → 실패 시 캐시(오프라인에서도 앱 구동)
 *  · Firebase CDN 스크립트: 캐시 우선(빠르고 오프라인 대비)
 *  · 그 외 GET: 네트워크 우선 → 실패 시 캐시
 */
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = req.url;

  /* Firebase 실시간 통신·구글 API는 절대 캐시하지 않음(실시간성 보장) */
  if (url.indexOf('firebaseio.com') !== -1 ||
      url.indexOf('googleapis.com') !== -1 ||
      url.indexOf('google.com') !== -1) {
    return;
  }

  /* Firebase CDN 스크립트: 캐시 우선 */
  if (url.indexOf('gstatic.com/firebasejs') !== -1) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE_VER).then(function (c) { c.put(req, copy); });
          return res;
        });
      })
    );
    return;
  }

  /* 페이지 이동(앱 HTML): 네트워크 우선 → 실패 시 캐시 */
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') !== -1) {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_VER).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (cached) {
          return cached || caches.match('./index.html') || caches.match('./');
        });
      })
    );
    return;
  }

  /* 그 외 GET: 네트워크 우선 → 실패 시 캐시 */
  event.respondWith(
    fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE_VER).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () {
      return caches.match(req);
    })
  );
});
