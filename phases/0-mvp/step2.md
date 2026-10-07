# Step 2: claude-lib

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (특히 "핵심 기능" 2, 4)
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md` (ADR-003, ADR-004)
- `/src/lib/youtube.ts` (Step 1에서 생성 — `Channel`, `Video`, `Chapter` 타입을 여기서 import한다)
- `/src/lib/youtube.test.ts` (테스트 작성 스타일 참고)
- `/package.json`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

`@anthropic-ai/sdk`와 `zod`를 dependency로 설치한다. `src/lib/claude.ts` 하나에 Claude 분석 로직을 넣는다. **테스트(`src/lib/claude.test.ts`)를 먼저 작성**하고, 그다음 구현한다 (TDD).

### 공개 인터페이스

```ts
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Channel, Video } from "./youtube";

export const AnalysisSchema = z.object({
  channelSummary: z.string(),
  categories: z.array(z.object({ name: z.string(), description: z.string() })),
  shortsCandidates: z.array(
    z.object({
      videoId: z.string(),
      chapterStart: z.string().nullable(), // 해당 영상 Chapter.start 값 그대로, 없으면 null
      hook: z.string(),
      reason: z.string(),
      score: z.number(),                   // 1~10
    }),
  ),
});
export type ChannelAnalysis = z.infer<typeof AnalysisSchema>;

export function buildPrompt(channel: Channel, videos: Video[]): string;
export function validateAnalysis(analysis: ChannelAnalysis, videos: Video[]): ChannelAnalysis;
export async function analyzeChannel(
  channel: Channel,
  videos: Video[],
  client?: Anthropic,                      // 기본값 new Anthropic() — 테스트에서 mock 주입
): Promise<ChannelAnalysis>;
```

### Claude 호출 (이 형태를 그대로 따른다 — SDK 0.131 기준으로 타입 검사 확인됨)

```ts
const res = await client.beta.messages.parse({
  model: "claude-opus-5-5",
  max_tokens: 16000,
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
  output_config: { effort: "medium", format: betaZodOutputFormat(AnalysisSchema) },
  messages: [{ role: "user", content: buildPrompt(channel, videos) }],
});
```

- `res.stop_reason === "refusal"`이면 한국어 메시지로 throw한다.
- `res.parsed_output`이 `null`이면 throw한다.
- 성공하면 `validateAnalysis(res.parsed_output, videos)` 결과를 반환한다.
- Anthropic SDK 에러는 잡아서 삼키지 말고 그대로 던진다 (페이지에서 메시지를 표시한다).

### buildPrompt 내용

한국어로 작성한다. 포함할 것:

- 역할: 유튜브 쇼츠 기획자로서 채널을 분석한다.
- 채널 정보: 채널명, 구독자 수, 분석 영상 수
- 영상마다: `id`, 제목, 롱폼/쇼츠, 업로드일, 길이, 조회수, 일평균 조회수, 평소 대비 배수, 참여율, 태그 앞 5개, 설명 앞 300자, 챕터 목록(`start 제목`)
- 요청:
  1. `channelSummary`: 이 채널이 어떤 콘텐츠를 하는지 한 단락
  2. `categories`: 주요 콘텐츠 카테고리 3~6개
  3. `shortsCandidates`: **롱폼 영상 중에서만** 쇼츠로 잘라낼 만한 영상 최대 6개. 평소 대비 배수·참여율이 높고 짧게 떼어내도 이해되는 장면이 있는 영상을 우선. 이미 성과가 좋은 쇼츠의 주제를 참고한다.
     - `chapterStart`: 그 영상의 챕터 목록에 있는 `start` 값 중 하나. 적절한 챕터가 없거나 챕터가 없으면 `null`. 시간을 지어내지 말 것.
     - `hook`: 쇼츠 첫 3초에 쓸 자막/제목, 30자 이내
     - `reason`: 왜 쇼츠로 터질 만한지 2~3문장, 지표 근거 포함
     - `score`: 1~10 정수
- 모든 텍스트는 한국어로 쓴다.

### validateAnalysis 규칙 (ADR-004: Claude가 지어낸 값 제거)

- `videoId`가 입력 `videos`에 없는 후보는 제거한다.
- 쇼츠 영상(`isShort: true`)을 가리키는 후보는 제거한다.
- `chapterStart`가 해당 영상 `chapters[].start`에 없으면 `null`로 바꾼다.
- `score`는 반올림 후 1~10으로 clamp한다.
- `score` 내림차순 정렬 후 최대 6개만 남긴다.
- 입력 객체를 변경하지 말고 새 객체를 반환한다.

### 테스트 (src/lib/claude.test.ts)

최소한 아래를 검증한다:

- `buildPrompt`: 영상 ID·제목·지표·챕터가 들어가는지, 설명이 300자로 잘리는지
- `validateAnalysis`: 위 규칙 각각
- `analyzeChannel`: `{ beta: { messages: { parse: vi.fn() } } }` 형태의 mock client 주입
  - `model: "claude-opus-5-5"`, `fallbacks: "default"`, `betas`에 `"server-side-fallback-2026-07-01"`을 넘기는지
  - refusal → throw, `parsed_output: null` → throw
  - 정상 응답이 `validateAnalysis`를 거쳐 반환되는지

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
test -f src/lib/claude.ts && test -f src/lib/claude.test.ts
grep -q '"claude-opus-5-5"' src/lib/claude.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/lib/claude.ts`, `src/lib/claude.test.ts`만 추가)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (export한 함수·타입 이름 포함)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 모델 ID를 바꾸거나 날짜 접미사를 붙이지 마라 (`claude-opus-5-5` 그대로). 이유: ADR-003 결정이며, 잘못된 ID는 404가 난다.
- `temperature`, `top_p`, `thinking: { type: "disabled" }`, `budget_tokens`를 넣지 마라. 이유: `claude-opus-5-5`에서 400 에러가 난다.
- zod 스키마에 `.min()`, `.max()`, `.int()` 같은 제약을 넣지 마라. 이유: 구조화 응답 스키마 변환에서 지원되지 않을 수 있다. 범위 보정은 `validateAnalysis`에서 한다.
- 스트리밍, tool use, 프롬프트 캐싱, 재시도 로직을 추가하지 마라. 이유: MVP에 불필요하다 (SDK가 기본 재시도를 이미 한다).
- 테스트에서 실제 Anthropic API를 호출하지 마라. 이유: 키가 없는 환경에서도 테스트가 통과해야 하고, 호출마다 비용이 든다.
- `src/lib/youtube.ts`와 `src/app/` 파일을 수정하지 마라. 이유: 다른 step의 범위다.
- 기존 테스트를 깨뜨리지 마라
