import { getTargetSubreddits } from "@/lib/config";
import { getDashboardData } from "@/lib/dashboard";
import { isRedditConfigured } from "@/lib/reddit-client";
import styles from "./page.module.css";
import RefreshButton from "./refresh-button";
import SubredditBrowserShell from "./subreddit-browser-shell";

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
          <p className={styles.topSummary}>
            스캔 {data.scannedPostCount} · 문제 {data.totalProblems} · 활성 {data.activeSubredditCount}/{targets.length}
          </p>
          <RefreshButton className={styles.refreshButton} />
        </div>

        <SubredditBrowserShell results={data.results} />

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
