# Step 0: project-setup

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md`
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md`
- `/.gitignore`
- `/.claude/settings.json` (Stop hook이 `npm run lint && npm run build && npm run test`를 실행한다)

현재 레포에는 앱 코드가 없다. 이 step에서 Next.js 프로젝트 뼈대만 만든다.

## 작업

### 1. Next.js 뼈대

레포 루트에 Next.js(App Router) + TypeScript strict + Tailwind CSS + ESLint 프로젝트를 구성한다.

- `create-next-app@latest`를 **레포 밖 임시 디렉토리**에서 실행해 뼈대를 만든 뒤 필요한 파일만 레포 루트로 옮긴다.
  - 권장 플래그: `--ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes`
  - 옮길 것: `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.*`, `postcss.config.*`, `eslint.config.*`, `src/app/` 아래 파일
  - `public/`의 기본 svg 파일과 `README.md`는 옮기지 않는다.
- `package.json`의 `name`은 `shorts-scout`로 한다.
- `tsconfig.json`의 `"strict": true`를 확인한다.
- 레포 루트에서 `npm install`을 실행한다.

### 2. 테스트 환경 (Vitest)

- `vitest`를 devDependency로 설치한다.
- `package.json` scripts에 `"test": "vitest run --passWithNoTests"`를 추가한다.
- `dev`, `build`, `lint` 스크립트는 scaffold가 만든 것을 그대로 쓴다.
- 이 단계에서는 테스트 파일을 만들지 않는다. 테스트는 `src/lib/*.test.ts`에 위치하며 상대 경로로 import한다(별도 alias 설정 불필요).

### 3. 기본 페이지 정리

- `src/app/page.tsx`: scaffold 기본 내용을 지우고 `<main>` 안에 제목 "Shorts Scout"만 렌더하는 서버 컴포넌트로 바꾼다.
- `src/app/layout.tsx`: `metadata.title`을 `"Shorts Scout"`, `<html lang="ko">`로 한다. 외부 폰트(`next/font/google`)는 제거하고 시스템 폰트를 쓴다.
- `src/app/globals.css`: Tailwind import만 남기고 scaffold의 예시 스타일은 지운다.

### 4. 환경 변수 파일

레포 루트에 `.env.example`을 만든다 (커밋 대상):

```
# 분석할 유튜브 채널 주소 (@핸들 또는 /channel/UC... 형식)
YOUTUBE_CHANNEL_URL=https://www.youtube.com/@channel_handle

# YouTube Data API v3 키 — Google Cloud Console > API 및 서비스 > 사용자 인증 정보
YOUTUBE_API_KEY=

# Anthropic API 키 — https://console.anthropic.com
ANTHROPIC_API_KEY=
```

### 5. .gitignore

기존 `.gitignore` 내용을 유지하면서 아래 규칙이 있는지 확인하고, 없으면 추가한다 (이미 있으면 그대로 둔다):

```
.env*
!.env.example
```

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
test -f .env.example && grep -q YOUTUBE_CHANNEL_URL .env.example
git check-ignore -q .env.local && ! git check-ignore -q .env.example
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/app/`만 존재, `src/lib/`는 다음 step에서 생성)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 레포 루트에서 `create-next-app`을 바로 실행하지 마라. 이유: `CLAUDE.md`, `docs/`, `scripts/`, `phases/` 같은 기존 파일 때문에 실패하거나 덮어쓸 수 있다.
- 기존 `CLAUDE.md`, `docs/`, `scripts/`, `phases/`, `.claude/` 파일을 수정하지 마라 (`phases/0-mvp/index.json`의 이 step 상태 업데이트만 예외). 이유: 하네스 설정과 설계 문서다.
- `src/lib/`, `src/components/`, `src/types/` 등 다른 폴더를 만들지 마라. 이유: 이후 step의 범위이거나 ARCHITECTURE.md에 없는 구조다.
- `@anthropic-ai/sdk`, `zod` 등 앱 의존성을 이 step에서 설치하지 마라. 이유: 해당 모듈을 만드는 step에서 설치한다.
- `.env.local`을 만들거나 커밋하지 마라. 이유: 실제 키는 사용자가 직접 넣는다.
- 기존 테스트를 깨뜨리지 마라
