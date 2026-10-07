# Architecture Decision Records

## 철학
MVP 속도 최우선. 작동하는 최소 구현을 선택한다. 파일·폴더·추상화를 늘리기 전에 "지금 없으면 안 되는가?"를 묻는다.

---

### ADR-001: Next.js 서버 컴포넌트 한 페이지
**결정**: `app/page.tsx` 하나가 env를 읽고 `lib/`를 호출해 리포트를 렌더한다. API 라우트, 클라이언트 컴포넌트 없음.
**이유**: 입력 폼이 없고 채널 URL은 env에서 온다. 서버 컴포넌트면 API 키가 브라우저로 나가지 않는다.
**트레이드오프**: 분석이 끝날 때까지(약 1분) 로딩 화면만 보인다. 단계별 표시는 포기.

### ADR-002: YouTube Data API v3를 fetch로 직접 호출
**결정**: `googleapis` 패키지 없이 `fetch`로 `channels.list` → `playlistItems.list` → `videos.list`를 호출한다. 최근 업로드 50개만 본다.
**이유**: 호출 3개뿐이라 SDK가 필요 없다. `search.list`(100 units) 대신 `playlistItems.list`(1 unit)를 써서 분석 1회에 3 units (일일 한도 10,000).
**트레이드오프**: 채널 URL은 `@핸들`과 `/channel/UC...` 형식만 지원한다. `/c/`, `/user/` 형식은 미지원.

### ADR-003: Claude 1회 호출 + 구조화 응답
**결정**: `claude-opus-5-5`를 `client.beta.messages.parse` + `betaZodOutputFormat`으로 1회 호출한다. `fallbacks: "default"`(beta `server-side-fallback-2026-07-01`)로 안전 분류기 거절 시 서버가 다른 모델로 재시도한다. effort는 `medium`.
**이유**: 콘텐츠 분류와 쇼츠 추천은 의미 이해가 필요하다. 구조화 응답이면 파싱 실패가 없다.
**트레이드오프**: 분석 1회에 비용이 든다(대략 $0.2 안팎 추정). 캐시가 없어 새로고침마다 재분석한다.

### ADR-004: 숫자는 코드, 해석은 Claude
**결정**: 일평균 조회수·평소 대비 배수·참여율·쇼츠 판별은 `lib/youtube.ts`에서 계산한다. Claude 응답의 영상 ID와 챕터 시간은 입력에 실제로 있는 값만 남긴다.
**이유**: LLM이 숫자나 존재하지 않는 영상·구간을 지어내지 않게 한다.
**트레이드오프**: 챕터가 없는 영상은 정확한 구간을 추천하지 못한다 (자막 분석은 MVP 제외).
