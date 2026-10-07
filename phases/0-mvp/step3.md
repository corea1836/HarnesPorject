# Step 3: report-page

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (특히 "사용 흐름", "핵심 기능", "디자인")
- `/docs/ARCHITECTURE.md` (특히 "데이터 흐름")
- `/docs/ADR.md` (ADR-001)
- `/src/lib/youtube.ts` (Step 1 — `fetchChannelData`, `Channel`, `Video`)
- `/src/lib/claude.ts` (Step 2 — `analyzeChannel`, `ChannelAnalysis`)
- `/src/app/page.tsx`, `/src/app/layout.tsx`, `/src/app/globals.css` (Step 0)
- `/.env.example`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

`src/app/page.tsx`를 리포트 화면으로 바꾸고 `src/app/loading.tsx`를 추가한다. 화면 전체를 `page.tsx` 한 파일 안에서 렌더한다 (섹션별 작은 함수 컴포넌트를 같은 파일 안에 두는 것은 괜찮다).

### page.tsx 흐름

```ts
export const dynamic = "force-dynamic";

export default async function Page(); // 반환 타입은 추론에 맡긴다 (React 19에는 전역 JSX 네임스페이스가 없다)
```

1. `process.env`에서 `YOUTUBE_CHANNEL_URL`, `YOUTUBE_API_KEY`, `ANTHROPIC_API_KEY`를 읽는다.
   - 빠진 값이 있으면 **설정 안내**를 렌더하고 끝: 빠진 변수 이름 목록, "`.env.example`을 `.env.local`로 복사해 값을 채운 뒤 새로고침" 안내.
2. `fetchChannelData(url, youtubeKey)` → `analyzeChannel(channel, videos)`를 순서대로 호출한다.
   - `ANTHROPIC_API_KEY`는 SDK가 env에서 직접 읽으므로 따로 넘기지 않는다.
   - 영상이 0개면 "분석할 영상이 없습니다"를 렌더하고 Claude를 호출하지 않는다.
3. 두 호출을 하나의 try/catch로 감싼다. 에러가 나면 같은 페이지에 에러 메시지(`error.message`)를 렌더한다.
4. 성공하면 아래 4개 섹션을 위에서 아래로 렌더한다.

### 섹션 (PRD "핵심 기능")

1. **채널 개요**: 채널명, 구독자 수(null이면 "비공개"), 분석 영상 수, 쇼츠 비중(%). 오른쪽에 "새로고침하면 다시 분석합니다" 안내 문구.
2. **이 채널은 어떤 콘텐츠를 하나**: `channelSummary` 문단 + `categories`를 이름·설명 목록으로.
3. **지금 뜨는 영상 Top 10**: `outlierScore` 내림차순 10개 표. 열: 제목(유튜브 링크), 형식(롱폼/쇼츠), 업로드일, 조회수, 일평균 조회수, 평소 대비(예: `3.2배`), 참여율(예: `4.1%`).
4. **쇼츠 후보**: `shortsCandidates` 카드 목록 (이미 점수순). 카드마다:
   - 원본 영상 제목(링크)과 그 영상의 평소 대비 배수
   - 구간: `chapterStart`가 있으면 `챕터 start ~ 다음 챕터 start 「챕터 제목」`(마지막 챕터면 `start ~ 끝`)과 해당 시점 링크 `https://www.youtube.com/watch?v={id}&t={seconds}s`. 없으면 "구간 정보 없음 — 영상 전체 검토".
   - 훅 문구, 추천 이유, 점수(`8 / 10`)
   - 후보가 0개면 "추천할 쇼츠 후보가 없습니다".

- 숫자는 `Intl.NumberFormat("ko-KR")`로 표시한다 (조회수·구독자는 `notation: "compact"`).
- 영상 링크: `https://www.youtube.com/watch?v={id}`, `target="_blank" rel="noopener noreferrer"`.

### loading.tsx

"채널 분석 중… 영상 수집과 AI 분석에 약 1분 걸립니다" 문구만 렌더한다.

### 디자인 (PRD "디자인")

- Tailwind로 최소한만. 흰 배경, 무채색 텍스트, 포인트 색 1개(링크·점수), 시스템 폰트, `max-w-5xl` 중앙 정렬.
- 그라데이션, 그림자 글로우, blur, 애니메이션, 이모지 장식 금지.

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
grep -q 'force-dynamic' src/app/page.tsx
test -f src/app/loading.tsx
! grep -rn "use client" src
test ! -d src/components && test ! -d src/types && test ! -d src/app/api
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/app/page.tsx` 수정, `src/app/loading.tsx` 추가만)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `export const dynamic = "force-dynamic"`을 빼지 마라. 이유: 없으면 `npm run build`가 페이지를 정적으로 미리 렌더하면서 YouTube/Claude를 호출하거나, env 없는 상태의 안내 화면이 그대로 굳는다.
- `'use client'` 컴포넌트, `error.tsx`, API 라우트, 캐시를 만들지 마라. 이유: MVP 구조 (ADR-001). 에러는 page.tsx의 try/catch로 처리한다.
- `components/`, `types/` 폴더를 만들지 마라. 이유: ARCHITECTURE.md에 없는 구조다.
- `next/image`나 썸네일 이미지를 쓰지 마라. 이유: PRD MVP 제외 사항이다.
- 실제 키 없이 `npm run dev`로 화면을 확인하려고 API를 호출하지 마라. 이유: 키가 없고 비용이 든다. 검증은 AC 커맨드로 한다.
- 화면에 API 키 값을 렌더하거나 로그로 출력하지 마라. 이유: 키 노출.
- `src/lib/` 파일을 수정하지 마라. 이유: 이전 step의 산출물이다. 필요한 값이 없으면 page.tsx에서 계산한다.
- 기존 테스트를 깨뜨리지 마라
