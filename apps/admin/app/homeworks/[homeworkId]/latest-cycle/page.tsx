"use client";

import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { ConsoleShell } from "../../../_components/console-shell";

type StudentStatus = "CHECKED_IN" | "IN_PROGRESS" | "NOT_STARTED";

interface LatestCycleResponse {
  homework: {
    id: string;
    title: string;
    classroomName: string | null;
    templateType: string;
    status: string;
  };
  cycle: null | {
    sequenceNumber: number;
    scheduledAt: string;
    studentCount: number;
    checkedInCount: number;
    inProgressCount: number;
    notStartedCount: number;
    students: Array<{
      occurrenceId: string;
      studentId: string;
      studentName: string;
      status: StudentStatus;
      submittedCount: number;
      totalCount: number;
      lastSubmittedAt: string | null;
    }>;
  };
}

const statusLabels: Record<StudentStatus, string> = {
  CHECKED_IN: "已打卡",
  IN_PROGRESS: "进行中",
  NOT_STARTED: "未开始",
};

const statusClasses: Record<StudentStatus, string> = {
  CHECKED_IN: "checkin-completed",
  IN_PROGRESS: "checkin-progress",
  NOT_STARTED: "checkin-not-started",
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function LatestHomeworkCyclePage() {
  const router = useRouter();
  const { homeworkId } = useParams<{ homeworkId: string }>();
  const [data, setData] = useState<LatestCycleResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setError("");
      try {
        const response = await fetch(`/api/admin/homeworks/${encodeURIComponent(homeworkId)}/latest-cycle`, {
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          router.replace("/login");
          return;
        }
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? "无法获取最近周期作业情况");
        setData(body);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "网络连接失败");
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [homeworkId, router]);

  return <ConsoleShell>
    <main className="main">
      <a className="back-link" href="/homeworks"><ArrowLeft size={16} />返回已发布作业</a>
      {error ? <div className="table-error page-message" role="alert">{error}</div> : null}
      {!data && !error ? <div className="panel loading">正在加载最近周期...</div> : null}
      {data ? <>
        <header className="page-header learning-page-header">
          <div><p className="eyebrow">{data.homework.classroomName ?? "未限定班级"} · 最近周期</p><h1>{data.homework.title}</h1></div>
          <span className="header-user">{data.cycle ? `第 ${data.cycle.sequenceNumber} 期 · ${formatDateTime(data.cycle.scheduledAt)}` : "首个周期尚未开始"}</span>
        </header>
        {data.cycle ? <>
          <section className="metrics" aria-label="最近周期学生作业汇总">
            <div className="metric"><span className="metric-label">已打卡</span><strong className="metric-value">{data.cycle.checkedInCount} / {data.cycle.studentCount}</strong></div>
            <div className="metric"><span className="metric-label">进行中</span><strong className="metric-value">{data.cycle.inProgressCount}</strong></div>
            <div className="metric"><span className="metric-label">未开始</span><strong className="metric-value">{data.cycle.notStartedCount}</strong></div>
          </section>
          <section className="panel" aria-labelledby="cycle-students-title">
            <div className="panel-header"><h2 id="cycle-students-title">学生作业情况</h2><span className="header-user">全部 {data.cycle.studentCount} 名学生</span></div>
            <div className="table-wrap"><table className="cycle-table"><thead><tr><th>学生</th><th>状态</th><th>题目进度</th><th>最近提交</th></tr></thead><tbody>{data.cycle.students.map((student) => <tr key={student.occurrenceId}><td><strong>{student.studentName}</strong></td><td><span className={`status ${statusClasses[student.status]}`}>{statusLabels[student.status]}</span></td><td>{student.submittedCount} / {student.totalCount}</td><td>{student.lastSubmittedAt ? formatDateTime(student.lastSubmittedAt) : <span className="table-muted">尚无提交</span>}</td></tr>)}</tbody></table></div>
          </section>
        </> : <section className="panel empty">首个周期尚未开始，暂时没有学生作业情况。</section>}
      </> : null}
    </main>
  </ConsoleShell>;
}
