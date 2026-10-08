# 프로젝트: Shorts Scout

유튜브 채널 하나를 분석해 "어떤 콘텐츠를 하는지, 무엇이 뜨는지, 어떤 롱폼을 쇼츠로 잘라낼 만한지"를 한 페이지로 보여주는 MVP 웹앱.

## 기술 스택
- Next.js (App Router)
- TypeScript strict mode
- Tailwind CSS
- Vitest (테스트)
- openai + zod (OpenAI 분석)

## 아키텍처 규칙
- CRITICAL: MVP다. 오버 엔지니어링 금지. docs/ARCHITECTURE.md에 없는 폴더·파일·추상화(캐시, DB, API 라우트, components/·types/·services/ 폴더, 상태 관리 라이브러리, 공통 유틸 계층)를 만들지 말 것.
- CRITICAL: API 키(YOUTUBE_API_KEY, OPENAI_API_KEY)는 서버 코드에서만 사용한다. `'use client'` 파일을 만들지 말 것 (MVP에는 클라이언트 인터랙션이 없다).
- CRITICAL: 테스트에서 실제 YouTube/OpenAI API를 호출하지 말 것. `fetch`와 OpenAI client는 mock한다.
- 숫자 지표는 코드로 계산하고, LLM(OpenAI)은 해석과 추천만 한다.
- 타입은 그 타입을 쓰는 모듈 안에서 export한다.

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)
- 커밋 메시지는 conventional commits 형식을 따를 것 (feat:, fix:, docs:, refactor:)

## 명령어
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run lint     # ESLint
npm run test     # 테스트 (vitest run)
