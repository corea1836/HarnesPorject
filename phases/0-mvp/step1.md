# Step 1: youtube-lib

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (특히 "지표 정의")
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md` (ADR-002, ADR-004)
- `/package.json`, `/tsconfig.json` (Step 0에서 생성)
- `/src/app/page.tsx` (Step 0에서 생성)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

`src/lib/youtube.ts` 하나에 YouTube 관련 로직을 모두 넣는다. **테스트(`src/lib/youtube.test.ts`)를 먼저 작성**하고, 그다음 구현한다 (TDD).

### 공개 인터페이스

```ts
export type ChannelRef =
  | { kind: "handle"; handle: string }   // "@" 없이 저장
  | { kind: "id"; id: string };          // "UC..."

export type Chapter = { start: string; seconds: number; title: string }; // start는 설명란에 적힌 그대로 ("3:12")

export type Channel = {
  id: string;
  title: string;
  subscribers: number | null;            // 구독자 수 비공개면 null
};

export type Video = {
  id: string;
  title: string;
  description: string;
  publishedAt: string;                   // ISO 문자열
  durationSec: number;
  isShort: boolean;                      // durationSec <= 180
  views: number;
  likes: number;                         // 비공개/누락이면 0
  comments: number;                      // 비공개/누락이면 0
  tags: string[];
  chapters: Chapter[];
  viewsPerDay: number;
  outlierScore: number;                  // 평소 대비 배수
  engagementRate: number;
};

export function parseChannelUrl(input: string): ChannelRef;
export function parseDuration(iso: string): number;                // "PT1H2M3S" → 3723
export function extractChapters(description: string): Chapter[];
export function addMetrics(
  videos: Omit<Video, "viewsPerDay" | "outlierScore" | "engagementRate">[],
  now?: Date,
): Video[];
export async function fetchChannelData(
  channelUrl: string,
  apiKey: string,
): Promise<{ channel: Channel; videos: Video[] }>;
```

내부 헬퍼와 API 응답 타입은 재량껏 만들되 export하지 않는다.

### parseChannelUrl 규칙

- 지원: `https://www.youtube.com/@handle`, `/@handle/videos` 같은 하위 경로, `m.youtube.com`, 프로토콜 없는 `youtube.com/@handle`, 맨 `@handle`, `https://www.youtube.com/channel/UCxxxx`
- 퍼센트 인코딩된 한글 핸들(`/@%EC%B9%A8...`)은 디코딩한다.
- 앞뒤 공백은 무시한다.
- 그 외 형식(`/c/`, `/user/`, 영상 URL 등)은 한국어 메시지로 throw한다. 메시지에 지원 형식 예시를 포함한다.

### extractChapters 규칙

- 설명란의 각 줄에서 맨 앞(공백 허용)의 `m:ss`, `mm:ss`, `h:mm:ss` 타임스탬프와 뒤따르는 제목을 뽑는다.
- 타임스탬프가 없는 줄은 무시한다. 결과는 등장 순서대로.

### addMetrics 규칙 (PRD "지표 정의"를 따른다)

- `viewsPerDay = views / max(1, 경과 일수)`. 경과 일수는 `now`(기본값 현재 시각) 기준.
- `outlierScore = views / (같은 isShort 그룹의 views 중앙값)`. 중앙값이 0이면 0.
- `engagementRate = (likes + comments) / views`. views가 0이면 0.
- 테스트는 고정된 `now`를 넘겨 결정적으로 만든다.

### fetchChannelData 동작

전역 `fetch`로 YouTube Data API v3를 정확히 3번 호출한다 (base: `https://www.googleapis.com/youtube/v3`):

1. `GET /channels?part=snippet,statistics,contentDetails&forHandle={handle}&key=...` (또는 `id={id}`)
   - `items[0].id`, `snippet.title`, `statistics.subscriberCount`(문자열, 비공개면 없음), `contentDetails.relatedPlaylists.uploads`
   - `items`가 비어 있으면 "채널을 찾을 수 없습니다" 류의 한국어 메시지로 throw
2. `GET /playlistItems?part=contentDetails&playlistId={uploads}&maxResults=50&key=...`
   - `items[].contentDetails.videoId`
3. `GET /videos?part=snippet,statistics,contentDetails&id={쉼표로 연결한 ID}&key=...`
   - `snippet.title/description/publishedAt/tags`, `statistics.viewCount/likeCount/commentCount`(문자열, 누락 가능), `contentDetails.duration`

- 쿼리 문자열은 `URLSearchParams`로 만든다.
- 길이가 0초인 영상(라이브·예정 영상)은 결과에서 뺀다.
- 응답 순서(최신순)를 유지하고, 마지막에 `addMetrics`를 적용한다.
- HTTP 에러 응답(`{ error: { code, message, errors: [{ reason }] } }`)은 상태 코드와 reason을 담은 한국어 메시지로 throw한다. 예: 403 `quotaExceeded`면 "YouTube API 일일 할당량 초과", 400/403 키 오류면 "YouTube API 키를 확인하세요".

### 테스트 (src/lib/youtube.test.ts)

최소한 아래를 검증한다:

- `parseChannelUrl`: 위 지원 형식 각각, 한글 핸들 디코딩, 미지원 형식 throw
- `parseDuration`: `PT1H2M3S`, `PT45S`, `PT3M`, `P0D`
- `extractChapters`: `0:00`, `03:12`, `1:02:03` 줄 / 타임스탬프 없는 줄 무시 / 챕터 없는 설명
- `addMetrics`: 롱폼·쇼츠 그룹별 중앙값, views 0, 업로드 당일 영상
- `fetchChannelData`: `vi.stubGlobal("fetch", ...)`로 mock
  - 3번 호출하고 handle/id에 따라 `forHandle`/`id` 파라미터를 쓰는지
  - 누락된 likeCount/commentCount/subscriberCount 처리
  - 0초 영상 제외
  - 채널 없음 throw
  - 에러 응답 throw 시 메시지에 API 키 값이 포함되지 않는지

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
test -f src/lib/youtube.ts && test -f src/lib/youtube.test.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/lib/youtube.ts`, `src/lib/youtube.test.ts`만 추가)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (export한 함수·타입 이름 포함)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `googleapis` 등 YouTube SDK를 설치하지 마라. 이유: 호출 3개뿐이라 `fetch`로 충분하다 (ADR-002).
- `search.list` 엔드포인트를 쓰지 마라. 이유: 호출당 100 units라 일일 할당량을 빨리 소진한다.
- 테스트에서 실제 네트워크를 호출하지 마라. 이유: 키가 없는 환경에서도 테스트가 통과해야 한다.
- 에러 메시지나 로그에 API 키를 넣지 마라. 이유: 요청 URL에 키가 포함되므로 URL을 그대로 출력하면 키가 노출된다.
- 파일을 `youtube.ts` 외로 쪼개거나 `types/` 폴더를 만들지 마라. 이유: MVP 구조 (ARCHITECTURE.md).
- `src/app/` 파일을 수정하지 마라. 이유: Step 3의 범위다.
- 기존 테스트를 깨뜨리지 마라
