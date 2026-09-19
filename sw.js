/* ══════════════════════════════════════════════════════════════
   sw.js — 한결 앱 공용 서비스워커 (오프라인 캐시)
   대상: 주차현황판 / 키불출앱 / 출고서류앱 (각 index.html 옆에 함께 업로드)

   ★ 설계 원칙 (매우 중요) ★
   1) 앱 껍데기(HTML)와 CDN 스크립트 같은 "정적 자원"만 캐시한다.
      → 네트워크가 끊겨도 앱 화면 자체는 열린다.
   2) Firebase / 솔라피 / 텔레그램 / 카카오 등 "데이터·API 요청"은
      절대 캐시하지 않고 항상 네트워크로 통과시킨다.
      → 주차현황·불출데이터·알림톡이 항상 최신으로 동작 (옛 데이터 사고 방지)
   3) 새 버전 배포 시: 앱이 보내는 SKIP_WAITING 메시지를 받으면 즉시 교체
      (앱 쪽은 "다음 실행부터 적용" 방식으로 등록되어 있어 작업 중 강제 리로드 없음)
   ══════════════════════════════════════════════════════════════ */

/* ★ 버전 — 앱을 새로 배포할 때마다 이 숫자를 올리면 캐시가 갱신된다.
   (예: 'hg-v1' → 'hg-v2'). 안 올려도 HTML은 네트워크 우선이라 최신이 뜬다. */
var CACHE_NAME = 'hg-app-v3';

/* 캐시에서 항상 제외할 도메인/경로 (데이터·API — 반드시 네트워크로) */
var NEVER_CACHE = [
  'firebaseio.com',            // Realtime Database
  'firebasedatabase.app',      // RTDB 신 도메인
  'googleapis.com',            // Firebase/Google API, Functions
  'identitytoolkit',           // Firebase Auth
  'securetoken',               // Firebase Auth 토큰
  'cloudfunctions.net',        // Cloud Functions
  'run.app',                   // Cloud Run (onKeyDispatch 등)
  'solapi.com',                // 솔라피(알림톡)
  'coolsms',                   // 솔라피 구 도메인
  'api.telegram.org',          // 텔레그램 알림
  'kakao'                      // 카카오 SDK/알림 (동적)
];

function _isNeverCache(url){
  for (var i = 0; i < NEVER_CACHE.length; i++){
    if (url.indexOf(NEVER_CACHE[i]) !== -1) return true;
  }
  return false;
}

/* ── 설치: 즉시 활성 대기 ── */
self.addEventListener('install', function(e){
  /* 앱 껍데기는 fetch 시점에 자동 캐시(런타임 캐시)하므로 여기서 미리 받지 않는다.
     (파일명이 앱마다 달라서 하드코딩하지 않음) */
  self.skipWaiting();
});

/* ── 활성화: 옛 캐시 정리 ── */
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

  /* GET 이외(POST 등)는 건드리지 않음 — 알림톡 전송 등은 그대로 통과 */
  if (req.method !== 'GET') return;

  var url = req.url;

  /* 데이터·API 는 캐시 절대 금지 → 항상 네트워크 (오프라인이면 그대로 실패) */
  if (_isNeverCache(url)) return;

  /* chrome-extension 등 비 http(s) 스킴은 무시 */
  if (url.indexOf('http') !== 0) return;

  /* ── HTML 문서: 네트워크 우선(Network-First) ──
     항상 최신 앱을 받되, 오프라인이면 캐시된 껍데기로 폴백 */
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

  /* ── 그 외 정적 자원(CDN 스크립트·이미지 등): 캐시 우선(Cache-First) ──
     한 번 받으면 캐시에서 빠르게, 오프라인에서도 동작 */
  e.respondWith(
    caches.match(req).then(function(cached){
      if (cached) return cached;
      return fetch(req).then(function(res){
        /* 정상 응답만 캐시 (불투명/에러 응답은 저장 안 함) */
        try{
          if (res && res.status === 200 && res.type === 'basic'){
            var copy = res.clone();
            caches.open(CACHE_NAME).then(function(c){ c.put(req, copy); });
          }
        }catch(err){}
        return res;
      }).catch(function(){
        /* 네트워크 실패 + 캐시 없음 → 그대로 실패 */
        return cached;
      });
    })
  );
});
