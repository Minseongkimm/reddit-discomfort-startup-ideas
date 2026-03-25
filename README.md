# Reddit Discomfort Startup Ideas

서브레딧별로 게시글을 수집하고, 규칙 기반/로컬 LLM 기반으로 "불편함 문제"를 추출해 보여주는 Next.js 대시보드입니다.

## 핵심 기능

- Reddit OAuth API로 서브레딧 최신글 수집
- 증분 수집(`after` 커서) + 로컬 캐시 저장(`.data/reddit-store.json`)
- 규칙 기반 문제 추출/클러스터링
- Ollama 로컬 모델 기반 문제 분류 보정(옵션)
- 서브레딧 선택 후 해당 문제만 확인
- API 키가 없어도 샘플 데이터 모드로 즉시 데모 가능

## 시작하기

```bash
npm install
npm run dev
```

앱: `http://localhost:3000`

## 샘플 모드

- API 키가 없을 때 `Reddit 동기화` 버튼을 누르면 샘플 데이터가 적재됩니다.
- API 키를 설정하고 다시 동기화하면 자동으로 실데이터 모드로 전환됩니다.

## 환경변수

`.env.local` 파일을 만들고 아래 값을 설정하세요.

```bash
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...
REDDIT_USER_AGENT=web:reddit-discomfort-collector:v0.1 (by /u/your_username)
```

선택값:

```bash
# 콤마로 구분한 서브레딧 목록 (미설정 시 기본 30개)
REDDIT_SUBREDDITS=r/startups,r/smallbusiness,r/freelance

# 저장 상한 (미설정 시 25,000)
MAX_STORED_POSTS=100000

# 로컬 LLM 분류 (Ollama)
LLM_CLASSIFIER_ENABLED=true
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma3:4b-it-qat
LLM_TIMEOUT_MS=20000
LLM_MAX_RUNTIME_MS=15000
LLM_MAX_NEW_CLASSIFICATIONS_PER_RUN=300
```

## 로컬 LLM 설정 (Ollama)

```bash
# Ollama 설치 후
ollama pull gemma3:4b-it-qat
ollama serve
```

LLM 서버가 꺼져 있으면 자동으로 규칙 기반 추출로 fallback 됩니다.

## 동기화 방식

- UI에서 `Reddit 동기화` 버튼 클릭 시 `POST /api/sync` 실행
- 초기 수집은 서브레딧당 최대 2페이지(각 100개)
- 이후에는 서브레딧당 1페이지씩 증분 수집
- 수집 직후 LLM/규칙 기반 문제 분석을 실행해 대시보드 스냅샷(`.data/dashboard-snapshot.json`)을 갱신
- 샘플 모드는 분석 상한을 해제(풀패스)하여 한 번에 최대한 요약을 채움
- 실데이터 모드는 `LLM_MAX_RUNTIME_MS`, `LLM_MAX_NEW_CLASSIFICATIONS_PER_RUN` 상한을 적용
- `GET /api/results`는 저장된 스냅샷을 읽어 반환하므로, 새로고침할 때마다 추가 LLM 호출이 발생하지 않음
- 최대 저장 게시글 수: `MAX_STORED_POSTS` 값(기본 25,000, 초과 시 오래된 글 정리)

## API 엔드포인트

- `POST /api/sync`: Reddit 데이터 수집 실행
- `GET /api/results`: 현재 대시보드 집계 데이터 반환
