# 아키텍처

## 디렉토리 구조
```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx         # env 읽기 → 수집 → 분석 → 리포트 렌더 (서버 컴포넌트, 화면 전체)
│   └── loading.tsx      # "채널 분석 중…" 화면
└── lib/
    ├── youtube.ts       # 채널 URL 파싱, YouTube API 호출, 영상 길이·챕터 파싱, 지표 계산
    ├── youtube.test.ts
    ├── claude.ts        # Claude 프롬프트, 구조화 응답, 결과 검증
    └── claude.test.ts
```
이 외의 소스 폴더(`components/`, `types/`, `services/`, `app/api/`)는 만들지 않는다.

## 패턴
- 페이지 하나가 서버 컴포넌트로 모든 일을 한다. 클라이언트 컴포넌트 없음.
- `page.tsx`는 `export const dynamic = "force-dynamic"`으로 요청마다 실행한다 (빌드 시 API 호출 방지).
- 외부 API 호출은 `lib/` 두 모듈에만 있다. `lib/youtube.ts`는 `fetch`를 직접 쓰고, `lib/claude.ts`는 `@anthropic-ai/sdk`를 쓴다.

## 데이터 흐름
```
브라우저 GET /
  → app/loading.tsx 먼저 표시
  → app/page.tsx (서버)
      1. process.env 에서 YOUTUBE_CHANNEL_URL, YOUTUBE_API_KEY, ANTHROPIC_API_KEY 읽기
         └ 빠진 값이 있으면 설정 안내를 렌더하고 끝
      2. lib/youtube.fetchChannelData(url, key)
         channels.list → playlistItems.list → videos.list (3 units) + 지표 계산
      3. lib/claude.analyzeChannel(channel, videos)
         Claude 1회 호출 → 응답 검증 (없는 영상 ID·챕터 시간 제거)
      4. 리포트 렌더
  → 2·3에서 에러가 나면 같은 페이지에 에러 메시지를 렌더
```

## 상태 관리
없음. 요청마다 서버에서 한 번 계산해 렌더한다. 캐시, DB, 클라이언트 상태 없음.
