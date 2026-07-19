"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { ConsoleShell } from "../_components/console-shell";

type AssessmentStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | string;

interface ContextResponse {
  user: { id: string; displayName: string; role: string };
  speechAssessment: { configured: boolean; provider: string | null };
}

interface AssessmentRow {
  id: string;
  status: AssessmentStatus;
  provider: string | null;
  attempt?: number | null;
  attemptCount?: number | null;
  retryCount?: number | null;
  studentName?: string | null;
  homeworkTitle?: string | null;
  classroomName?: string | null;
  error?: string | null;
  errorMessage?: string | null;
  lastError?: string | null;
  queuedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
}

interface AssessmentListResponse {
  assessments: AssessmentRow[];
  pagination?: { page: number; pageSize: number; total: number };
  summary?: Record<string, number>;
}

function statusLabel(status: string) {
  if (status === "QUEUED") return "等待";
  if (status === "PROCESSING") return "处理中";
  if (status === "COMPLETED") return "完成";
  if (status === "FAILED") return "失败";
  return status;
}

function statusClass(status: string) {
  if (status === "FAILED") return "assessment-state assessment-failed";
  if (status === "COMPLETED") return "assessment-state assessment-done";
  return "assessment-state assessment-pending";
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "-";
}

function attemptText(row: AssessmentRow) {
  const value = row.attempt ?? row.attemptCount ?? row.retryCount;
  return value === undefined || value === null ? "-" : String(value);
}

function errorText(row: AssessmentRow) {
  return row.errorMessage ?? row.lastError ?? row.error ?? "-";
}

export default function AssessmentsPage() {
  const router = useRouter();
  const [context, setContext] = useState<ContextResponse | null>(null);
  const [data, setData] = useState<AssessmentListResponse | null>(null);
  const [status, setStatus] = useState("ALL");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const query = useMemo(() => new URLSearchParams({ page: "1", pageSize: "50", ...(status !== "ALL" ? { status } : {}) }), [status]);

  async function requireJson(response: Response, fallback: string) {
    const body = await response.json();
    if (response.status === 401 || response.status === 403) {
      router.replace("/login");
      throw new Error("请重新登录");
    }
    if (!response.ok) throw new Error(body.message ?? fallback);
    return body;
  }

  async function loadData() {
    setError("");
    const [contextResponse, assessmentsResponse] = await Promise.all([
      fetch("/api/admin/context"),
      fetch(`/api/admin/speech-assessments?${query}`),
    ]);
    setContext(await requireJson(contextResponse, "无法加载管理会话") as ContextResponse);
    setData(await requireJson(assessmentsResponse, "无法加载评测队列") as AssessmentListResponse);
  }

  useEffect(() => {
    void loadData().catch((cause) => setError(cause instanceof Error ? cause.message : "网络连接失败"));
  }, [query]);

  async function retry(row: AssessmentRow) {
    setError("");
    setNotice("");
    setRetryingId(row.id);
    try {
      const response = await fetch(`/api/admin/speech-assessments/${encodeURIComponent(row.id)}/retry`, { method: "POST" });
      const body = await requireJson(response, "重试失败") as { assessment: AssessmentRow };
      setData((current) => current ? { ...current, assessments: current.assessments.map((item) => item.id === row.id ? body.assessment : item) } : current);
      setNotice(`已重新排队评测 ${row.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重试失败");
    } finally {
      setRetryingId(null);
    }
  }

  const summary = data?.summary ?? {};
  const total = data?.pagination?.total ?? data?.assessments.length ?? 0;

  return <ConsoleShell>
    <main className="main">
      <header className="page-header"><div><p className="eyebrow">评测运营</p><h1>语音评测队列</h1></div><span className="header-user">{context ? `${context.user.displayName} · ${context.user.role}` : "正在确认会话"}</span></header>
      {error ? <p className="table-error page-message" role="alert">{error}</p> : null}
      {notice ? <p className="success-note" role="status">{notice}</p> : null}
      <section className="metrics" aria-label="评测统计">
        <div className="metric"><span className="metric-label">服务商</span><strong className="metric-value duration-value">{context?.speechAssessment.configured ? context.speechAssessment.provider ?? "已配置" : "未配置"}</strong></div>
        <div className="metric"><span className="metric-label">队列总量</span><strong className="metric-value">{total}</strong></div>
        <div className="metric"><span className="metric-label">失败 / 等待</span><strong className="metric-value duration-value">{summary.FAILED ?? 0} / {summary.QUEUED ?? 0}</strong></div>
      </section>
      {context && !context.speechAssessment.configured ? <p className="provider-warning" role="status">当前没有配置商业语音评测服务商。队列可见，但新任务会保持等待或失败状态，直到后端接入服务凭据。</p> : null}
      <section className="panel" aria-labelledby="assessments-title">
        <div className="panel-header"><h2 id="assessments-title">标准化评测行</h2><div className="review-toolbar"><select className="grade-select assessment-filter" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="按状态筛选"><option value="ALL">全部</option><option value="QUEUED">等待</option><option value="PROCESSING">处理中</option><option value="FAILED">失败</option><option value="COMPLETED">完成</option></select><button className="table-icon-button" type="button" title="刷新队列" aria-label="刷新队列" onClick={() => void loadData()}><RefreshCw size={16} /></button></div></div>
        {!data && !error ? <div className="loading">正在加载评测队列...</div> : null}
        {data ? <div className="table-wrap"><table className="assessment-table"><thead><tr><th>评测</th><th>学生 / 作业</th><th>班级</th><th>服务商</th><th>状态</th><th>尝试</th><th>错误</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{data.assessments.length === 0 ? <tr><td colSpan={9} className="empty">暂无评测任务</td></tr> : data.assessments.map((row) => <tr key={row.id}><td><strong>{row.id}</strong><br /><span className="table-muted">创建 {formatDate(row.createdAt ?? row.queuedAt)}</span></td><td><strong>{row.studentName ?? "-"}</strong><br /><span className="table-muted">{row.homeworkTitle ?? "-"}</span></td><td>{row.classroomName ?? "-"}</td><td>{row.provider ?? "-"}</td><td><span className={statusClass(row.status)}>{statusLabel(row.status)}</span></td><td>{attemptText(row)}</td><td className="error-cell">{errorText(row)}</td><td>{formatDate(row.updatedAt ?? row.completedAt ?? row.startedAt ?? row.queuedAt)}</td><td>{row.status === "FAILED" ? <button className="table-icon-button" type="button" title="重新排队失败评测" aria-label={`重新排队评测 ${row.id}`} disabled={retryingId === row.id} onClick={() => void retry(row)}>{retryingId === row.id ? "..." : <RotateCcw size={16} />}</button> : <span className="table-muted">-</span>}</td></tr>)}</tbody></table></div> : null}
      </section>
    </main>
  </ConsoleShell>;
}
