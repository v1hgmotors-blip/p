/* ══════════════════════════════════════════════════════════════
   sw.js — 주차현황판 / 키불출앱 / 출고서류앱 공용 서비스워커
   (각 앱의 index.html 과 같은 폴더에 함께 업로드)

   ★ 핵심 동작 ★
   1) HTML 앱은 "네트워크 우선" — 항상 서버의 최신 파일을 받는다.
      → 앱을 새로 배포하면 별도 캐시삭제 없이도 최신 화면이 뜬다.
      → 네트워크가 끊겼을 때만 캐시된 껍데기로 열어준다 (오프라인 지원).
   2) Firebase·솔라피·텔레그램·카카오·조합사이트 등 "데이터/API"는
      절대 캐시하지 않는다. → 데이터·알림이 항상 최신 (옛 데이터 사고 방지).
   3) CDN 스크립트·이미지 등 정적 자원은 "캐시 우선" — 빠르고 오프라인 대응.
   ══════════════════════════════════════════════════════════════ */

/* ★ 버전 — 앱을 새로 배포할 때 이 숫자를 올리면 옛 캐시가 완전히 정리된다.
   (예: 'app-v1' → 'app-v2'). HTML은 네트워크 우선이라 안 올려도 최신이 뜨지만,
   확실히 갱신하고 싶을 때 올리면 좋다. */
var CACHE_NAME = 'app-v1';

/* 캐시 절대 금지 (데이터·API — 반드시 네트워크로 통과) */
var NEVER_CACHE = [
  'firebaseio.com',            // Realtime Database
  'firebasedatabase.app',      // RTDB 신 도메인
  'googleapis.com',            // Firebase/Google API, Functions, Auth
  'identitytoolkit',           // Firebase 익명 인증
  'securetoken',               // Firebase Auth 토큰
  'cloudfunctions.net',        // Cloud Functions
  'run.app',                   // Cloud Run
  'solapi.com',                // 솔라피(알림톡)
  'coolsms',                   // 솔라피 구 도메인
  'api.telegram.org',          // 텔레그램 알림
  'ntfy.sh',                   // ntfy 알림
  'kakao',                     // 카카오 SDK/알림
  'carmodoo.com'               // 조합 딜러조회 사이트 (항상 최신)
];

function _isNeverCache(url){
  for (var i = 0; i < NEVER_CACHE.length; i++){
    if (url.indexOf(NEVER_CACHE[i]) !== -1) return true;
  }
  return false;
}

/* ── 설치: 즉시 대기 해제 ── */
self.addEventListener('install', function(e){
  self.skipWaiting();
});

/* ── 활성화: 옛 버전 캐시 정리 ── */
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        if (k !== CACHE_NAME) return caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

/* ── 새 버전 즉시 적용 (앱이 SKIP_WAITING 보내면) ── */
self.addEventListener('message', function(e){
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ── fetch 가로채기 ── */
self.addEventListener('fetch', function(e){
  var req = e.request;

  /* GET 외(POST 등)는 통과 — 알림 전송·업로드 등 방해 안 함 */
  if (req.method !== 'GET') return;

  var url = req.url;

  /* 데이터·API 는 캐시 금지 → 항상 네트워크 */
  if (_isNeverCache(url)) return;

  /* http(s) 아닌 스킴 무시 */
  if (url.indexOf('http') !== 0) return;

  /* ── HTML 문서: 네트워크 우선 (항상 최신 앱, 오프라인이면 캐시 폴백) ── */
  if (req.mode === 'navigate' ||
      (req.headers.get('accept') || '').indexOf('text/html') !== -1){
    e.respondWith(
      fetch(req).then(function(res){
        try{
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function(c){ c.put(req, copy); });
        }catch(err){}
        return res;
      }).catch(function(){
        return caches.match(req).then(function(cached){
          return cached || caches.match('./index.html') ||
                 new Response('오프라인 상태입니다. 네트워크 연결 후 다시 시도하세요.',
                   { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        });
      })
    );
    return;
  }

  /* ── 그 외 정적 자원(CDN·이미지): 캐시 우선 ── */
  e.respondWith(
    caches.match(req).then(function(cached){
      if (cached) return cached;
      return fetch(req).then(function(res){
        try{
          if (res && res.status === 200 && res.type === 'basic'){
            var copy = res.clone();
            caches.open(CACHE_NAME).then(function(c){ c.put(req, copy); });
          }
        }catch(err){}
        return res;
      }).catch(function(){ return cached; });
    })
  );
});
