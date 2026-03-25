import { getTargetSubreddits } from "@/lib/config";
import { getDashboardData } from "@/lib/dashboard";
import { isRedditConfigured } from "@/lib/reddit-client";
import styles from "./page.module.css";
import RefreshButton from "./refresh-button";
import SubredditBrowser from "./subreddit-browser";

export const dynamic = "force-dynamic";

export default async function Home() {
  const configured = isRedditConfigured();
  const targets = getTargetSubreddits();
  const data = await getDashboardData();

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.topBar}>
          {data.mode === "sample" ? (
            <p className={styles.syncStatus}>샘플 모드 실행 중</p>
          ) : null}
          <RefreshButton className={styles.refreshButton} />
        </div>

        <section className={styles.statsGrid}>
          <article className={styles.statCard}>
            <span>스캔 게시글</span>
            <strong>{data.scannedPostCount}</strong>
          </article>
          <article className={styles.statCard}>
            <span>추출 문제</span>
            <strong>{data.totalProblems}</strong>
          </article>
          <article className={styles.statCard}>
            <span>활성 서브레딧</span>
            <strong>{data.activeSubredditCount}</strong>
          </article>
          <article className={styles.statCard}>
            <span>대상 서브레딧</span>
            <strong>{targets.length}</strong>
          </article>
        </section>

        <SubredditBrowser results={data.results} />

        {data.mode === "empty" && configured === false ? (
          <section className={styles.alert}>
            <strong>API 키 없이도 샘플 모드로 시작할 수 있습니다.</strong>
            <p>
              <code>Reddit 동기화</code> 버튼을 누르면 샘플 데이터가 적재됩니다.
              API 키를 설정한 뒤 다시 동기화하면 실데이터로 전환됩니다.
            </p>
          </section>
        ) : null}

        {configured && data.scannedPostCount === 0 ? (
          <section className={styles.alert}>
            <strong>초기 데이터가 비어 있습니다.</strong>
            <p>
              <code>Reddit 동기화</code> 버튼을 눌러 대상 서브레딧 {targets.length}
              개에서 수집을 시작하세요.
            </p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
