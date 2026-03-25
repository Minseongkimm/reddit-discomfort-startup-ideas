# Reddit Discomfort Startup Ideas

서브레딧별로 게시글을 수집하고, 규칙 기반으로 "불편함 문제"를 추출해 보여주는 Next.js 대시보드입니다.

## 핵심 기능

- Reddit OAuth API로 서브레딧 최신글 수집
- 증분 수집(`after` 커서) + 로컬 캐시 저장(`.data/reddit-store.json`)
- 규칙 기반 문제 추출/클러스터링
- 서브레딧 클릭 시 해당 문제만 필터링해서 확인
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
```

## 동기화 방식

- UI에서 `Reddit 동기화` 버튼 클릭 시 `POST /api/sync` 실행
- 초기 수집은 서브레딧당 최대 2페이지(각 100개)
- 이후에는 서브레딧당 1페이지씩 증분 수집
- 최대 저장 게시글 수: `MAX_STORED_POSTS` 값(기본 25,000, 초과 시 오래된 글 정리)

## API 엔드포인트

- `POST /api/sync`: Reddit 데이터 수집 실행
- `GET /api/results`: 현재 대시보드 집계 데이터 반환
