# Reddit Discomfort Startup Ideas - Project Flow

## 1) 프로젝트 목적

이 프로젝트는 Reddit 게시글에서 반복적으로 등장하는 불편/문제를 추출하고,
서브레딧별로 정리해서 아이디어 탐색에 쓰는 대시보드입니다.

- 수집: Reddit API (또는 샘플 데이터)
- 분석: 규칙 기반 + 선택적 로컬 LLM(Ollama)
- 저장: 로컬 JSON 스토어(`.data`)
- 표시: Next.js UI

---

## 2) 전체 아키텍처

```text
UI(page.tsx + subreddit-browser.tsx)
  ├─ GET /api/results  -> 현재 스냅샷 조회
  └─ POST /api/sync    -> 데이터 동기화 + 스냅샷 재생성

sync.ts
  ├─ sample mode: sample-posts.ts 적재
  └─ live mode: reddit-client.ts로 subreddit/new 수집
       -> store.ts에 저장
       -> dashboard.ts로 분석/집계

dashboard.ts
  ├─ snapshot fresh면 재사용
  └─ stale면 problem-analyzer.ts로 재분석
       -> extractor.ts 집계
       -> dashboard-snapshot.ts 저장
```

---

## 3) 요청 기준 실행 플로우

### A. 첫 페이지 진입

1. `src/app/page.tsx`
2. `getDashboardData()` 호출 (`src/lib/dashboard.ts`)
3. 스냅샷이 최신이면 그대로 사용
4. 아니면 `rebuildDashboardSnapshot()` 실행 후 결과 반환

### B. Reddit 동기화 버튼 클릭

1. `RefreshButton`가 `POST /api/sync` 호출
2. `syncRedditData()` 실행 (`src/lib/sync.ts`)
3. 설정 여부로 분기
4. API 키 없음: 샘플 포스트 적재
5. API 키 있음: 대상 서브레딧 증분 수집(`after` 커서 사용)
6. 저장 상한(`MAX_STORED_POSTS`) 초과 시 오래된 글 prune
7. 마지막에 `rebuildDashboardSnapshot()`로 분석 결과 재생성
8. 응답 summary 반환 후 `router.refresh()`로 UI 갱신

---

## 4) 데이터 수집 플로우

### 샘플 모드

- 파일: `src/lib/sample-posts.ts`
- 기본: 타깃 서브레딧마다 샘플 게시글 생성
- 장점: API 승인 전에도 화면/분석 플로우 검증 가능

### 실데이터 모드

- 파일: `src/lib/reddit-client.ts`
- 인증: client credentials (`REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`)
- 호출: `https://oauth.reddit.com/{subreddit}/new`
- 페이지 정책:
  - 최초: `INITIAL_BACKFILL_PAGES` (기본 2)
  - 이후: `INCREMENTAL_PAGES` (기본 1)
  - 페이지당 `SYNC_LIMIT_PER_REQUEST` (기본 100)

---

## 5) 문제 분석 플로우

분석 엔트리: `analyzeProblemsFromPosts()` (`src/lib/problem-analyzer.ts`)

### LLM 비활성화 경로

1. `extractProblemsFromPosts()`로 규칙 기반 추출
2. 유사 서비스 URL 검증 후 반환

### LLM 활성화 경로

1. 게시글마다 규칙 매칭 + pain 힌트 체크
2. 캐시(`.data/llm-cache.json`) 확인
3. 신규/결측 필드에 한해 Ollama 분류 시도
4. 분류 결과에서 다음을 생성
   - `ruleIds`, `severity`, `reason`, `solution`, `similarServices`
5. 유사 서비스 URL 검증(상한 있음)
6. extractor로 subreddit/problem 단위 집계
7. pain index 계산 후 정렬

### 집계 기준(핵심)

- 집계 파일: `src/lib/extractor.ts`
- `frequency/mentionCount`, `totalScore`, `totalComments` 누적
- `painIndex(1~100)` 계산
  - mention 45%
  - empathy(점수+댓글) 35%
  - severity 20%
- 유사 서비스는 규칙 기본값 + LLM 추출값 merge

---

## 6) 저장 구조

모든 런타임 데이터는 루트 `.data/`에 저장됩니다.

- `reddit-store.json`
  - 원본 게시글 저장소
  - subreddit별 `after` 커서 포함
- `llm-cache.json`
  - 게시글 단위 LLM 분류 캐시
  - reason/solution/similar services 보관
- `dashboard-snapshot.json`
  - UI가 바로 읽는 집계 결과
  - `GET /api/results`가 주로 이 파일 사용

원자적 쓰기(temp -> rename)와 간단한 mutex lock으로 파일 손상 가능성을 줄여둠.

---

## 7) API 엔드포인트

- `GET /api/results`
  - 현재 대시보드 데이터 반환
- `POST /api/sync`
  - Reddit(또는 샘플) 동기화 + 스냅샷 재생성
- `POST /api/rebuild-full`
  - LLM/검증 상한을 무시하고 전체 재분석 실행(`forceFullPass`)

---

## 8) 프론트 UI 구성

- `src/app/page.tsx`
  - 상단 요약/동기화 버튼
  - 결과 브라우저 셸 로드
- `src/app/subreddit-browser-shell.tsx`
  - `subreddit-browser.tsx`를 `ssr: false` 동적 로딩
- `src/app/subreddit-browser.tsx`
  - 서브레딧 선택/검색/더보기
  - 문제 카드(LLM 요약/솔루션/원문 링크/유사 서비스)
  - 좋아요/싫어요 정렬 및 분리 표시

---

## 9) 주요 환경변수

- Reddit
  - `REDDIT_CLIENT_ID`
  - `REDDIT_CLIENT_SECRET`
  - `REDDIT_USER_AGENT`
  - `REDDIT_SUBREDDITS`
- 저장/수집
  - `MAX_STORED_POSTS`
- LLM(Ollama)
  - `LLM_CLASSIFIER_ENABLED`
  - `OLLAMA_BASE_URL`
  - `OLLAMA_MODEL`
  - `LLM_TIMEOUT_MS`
  - `LLM_MAX_RUNTIME_MS`
  - `LLM_MAX_NEW_CLASSIFICATIONS_PER_RUN`

---

## 10) 운영 시 알아두면 좋은 점

- `GET /api/results`는 스냅샷 기반이라 페이지 새로고침만으로 LLM 비용이 늘지 않음
- 새 데이터 반영은 `Reddit 동기화` 버튼을 눌러야 진행됨
- 유사 서비스 URL 검증은 상한 기반으로 점진 반영됨(한 번에 전부가 아닐 수 있음)
- 캐시/스냅샷 파일이 비정상 JSON일 때 복구 파서로 첫 JSON 블록을 재사용하도록 처리됨
