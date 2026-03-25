"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type SyncSuccess = {
  ok: true;
  mode: "live" | "sample" | "empty";
  newPosts: number;
  totalStoredPosts: number;
};

type SyncFailure = {
  ok: false;
  message?: string;
};

type RefreshButtonProps = {
  className?: string;
};

export default function RefreshButton({ className }: RefreshButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>("");
  const [isError, setIsError] = useState(false);

  const handleSync = () => {
    startTransition(async () => {
      setMessage("");
      setIsError(false);

      const response = await fetch("/api/sync", {
        method: "POST",
      });

      const payload = (await response.json().catch(() => null)) as
        | SyncSuccess
        | SyncFailure
        | null;

      if (!response.ok || !payload || payload.ok === false) {
        setIsError(true);
        setMessage(payload && "message" in payload ? payload.message ?? "동기화에 실패했습니다." : "동기화에 실패했습니다.");
        return;
      }

      const modeLabel = payload.mode === "sample" ? "샘플" : "실데이터";
      setMessage(`${modeLabel} 동기화 완료 · 신규 ${payload.newPosts}개 · 누적 ${payload.totalStoredPosts}개`);
      router.refresh();
    });
  };

  return (
    <div>
      <button
        type="button"
        className={className}
        onClick={handleSync}
        disabled={pending}
      >
        {pending ? "동기화 중..." : "Reddit 동기화"}
      </button>
      {message ? (
        <p
          style={{
            marginTop: 8,
            color: isError ? "#dc2626" : "#1d4ed8",
            fontSize: 13,
          }}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
