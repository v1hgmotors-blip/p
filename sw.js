/* ══════════════════════════════════════════════════════════════════
   주차현황판 서비스워커 (오프라인 캐시)
   ------------------------------------------------------------------
   · 이 파일(sw.js)은 index.html 과 "같은 폴더"에 함께 올려야 합니다.
     (Netlify / GitHub Pages 모두 index.html 옆에 sw.js 를 업로드)
   · 하는 일:
       1) 앱 HTML 과 Firebase 라이브러리(gstatic)를 기기에 캐시 →
          인터넷이 없어도 홈화면 앱이 그대로 켜집니다.
       2) Firebase 실시간 데이터 통신(firebaseio.com 등)은 절대 가로채지
          않고 그대로 통과 → 실시간 연동에 영향 없음.
   · 앱을 크게 수정해 배포할 때는 아래 CACHE_VER 의 v숫자만 올리면
     (예: v4 → v5) 사용자 기기가 새 버전으로 자동 갱신됩니다.
   ══════════════════════════════════════════════════════════════════ */

var CACHE_VER = 'parking-cache-v4';

/* 오프라인에서도 로드되어야 하는 외부 라이브러리(앱 시작에 필수) */
var FB_URLS = [
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js'
];

/* 이 서비스워커가 담당하는 범위의 루트(= index.html 이 있는 폴더) */
function _scopeUrl(){
  try { return self.registration.scope; } catch (e) { return './'; }
}

/* ── install: 앱 HTML + Firebase 라이브러리 미리 캐시 ── */
self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_VER).then(function (c) {
      var scope = _scopeUrl();
      var reqs = [scope, scope + 'index.html'].concat(FB_URLS);
      return Promise.all(reqs.map(function (u) {
        /* cache:'reload' → 항상 최신본을 받아 캐시 (있으면 갱신) */
        return fetch(u, { cache: 'reload' })
          .then(function (r) { if (r && (r.ok || r.type === 'opaque')) return c.put(u, r); })
          .catch(function () {
            /* 설치 시점에 오프라인이면, 기존 캐시가 있으면 그대로 유지 */
            return caches.match(u).then(function (hit) { if (hit) return c.put(u, hit); });
          });
      }));
    })
  );
});

/* ── activate: 옛 버전 캐시 정리 후 즉시 제어권 확보 ── */
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_VER; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

/* ── fetch 전략 ── */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  var u = req.url;

  /* 1) Firebase 실시간 DB / Google API → 절대 가로채지 않음(그대로 통과)
        → 실시간 연동·인증은 Firebase 가 스스로 처리 */
  if (u.indexOf('firebaseio.com') !== -1 ||
      u.indexOf('googleapis.com') !== -1 ||
      u.indexOf('google.com/firebase') !== -1 ||
      u.indexOf('firebaseinstallations') !== -1) {
    return;
  }

  /* 2) GET 이 아닌 요청(POST 등) → 통과 */
  if (req.method !== 'GET') return;

  /* 3) Firebase 라이브러리(gstatic) → 캐시 우선(오프라인에서도 로드) */
  if (FB_URLS.indexOf(u) !== -1) {
    e.respondWith(
      caches.match(u).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (r) {
          if (r && r.ok) { var cl = r.clone(); caches.open(CACHE_VER).then(function (c) { c.put(u, cl); }); }
          return r;
        });
      })
    );
    return;
  }

  /* 4) 페이지(앱 HTML) 열기 → 네트워크 우선, 실패(오프라인) 시 캐시 반환 */
  var isNav = (req.mode === 'navigate');
  if (isNav) {
    e.respondWith(
      fetch(req).then(function (r) {
        /* 온라인이면 최신본을 받아 캐시도 갱신 */
        if (r && r.ok) { var cl = r.clone(); caches.open(CACHE_VER).then(function (c) { c.put(req, cl); }); }
        return r;
      }).catch(function () {
        /* 오프라인: 이 요청 → index.html → 스코프 루트 순으로 캐시에서 찾음 */
        var scope = _scopeUrl();
        return caches.match(req).then(function (hit) {
          return hit ||
                 caches.match(scope + 'index.html').then(function (h2) {
                   return h2 ||
                          caches.match(scope).then(function (h3) {
                            return h3 || new Response(
                              '<meta charset="utf-8"><h2 style="font-family:sans-serif;padding:24px">오프라인 상태입니다.<br>인터넷이 연결된 상태에서 한 번 이상 앱을 연 뒤에 사용하세요.</h2>',
                              { headers: { 'Content-Type': 'text/html;charset=utf-8' } }
                            );
                          });
                 });
        });
      })
    );
    return;
  }

  /* 5) 그 외 같은 폴더의 정적 요청 → 캐시 우선, 없으면 네트워크(받으면 캐시) */
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (r) {
        if (r && r.ok && r.type === 'basic') {
          var cl = r.clone(); caches.open(CACHE_VER).then(function (c) { c.put(req, cl); });
        }
        return r;
      }).catch(function () { return hit; });
    })
  );
});

/* ── 앱에서 SKIP_WAITING 메시지 → 새 버전 즉시 대기 해제 ── */
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
