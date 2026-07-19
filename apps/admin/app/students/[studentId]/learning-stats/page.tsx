"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, LayoutDashboard, LogOut, Users } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

interface LearningStats {
  summary: {
    checkinDays: number;
    currentStreak: number;
    voiceSeconds: number;
    homeworkSeconds: number;
  };
  checkins: Array<{
    checkinDate: string;
    firstActivityAt: string;
    voiceSeconds: number;
    homeworkSeconds: number;
  }>;
}

function formatDuration(rawSeconds: number) {
  const seconds = Math.max(0, Math.floor(rawSeconds));
  if (seconds < 60) return `${seconds} 秒`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} 分钟`;
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分钟`;
}

function formatCheckinDate(value: string) {
  const date = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function formatActivityTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export default function StudentLearningStatsPage() {
  const router = useRouter();
  const { studentId } = useParams<{ studentId: string }>();
  const searchParams = useSearchParams();
  const studentName = searchParams.get("name")?.trim();
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function loadStats() {
      setError("");
      try {
        const response = await fetch(`/api/admin/students/${encodeURIComponent(studentId)}/learning-stats`, {
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          router.replace("/login");
          return;
        }
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? "无法获取学生学习统计");
        setStats(body);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "网络连接失败");
      }
    }
    void loadStats();
    return () => controller.abort();
  }, [router, studentId]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const recentCheckins = stats?.checkins.slice(0, 30) ?? [];

  return <div className="console">
    <aside className="sidebar">
      <div className="sidebar-brand">Hello Betty</div>
      <a className="nav-link active" href="/dashboard"><LayoutDashboard size={17} />概览</a>
      <a className="nav-link" href="/dashboard#students"><Users size={17} />学生账号</a>
      <a className="nav-link" href="/homeworks"><BookOpen size={17} />作业管理</a>
      <div className="sidebar-footer"><button className="logout" onClick={logout}><LogOut size={16} />退出登录</button></div>
    </aside>
    <main className="main">
      <a className="back-link" href="/dashboard#students"><ArrowLeft size={16} />返回学生列表</a>
      <header className="page-header learning-page-header"><div><p className="eyebrow">学生账号</p><h1>{studentName ? `${studentName}的学习统计` : "学习统计"}</h1></div><span className="header-user">按北京时间记录每日学习</span></header>
      {error ? <div className="table-error page-message" role="alert">{error}</div> : null}
      {!stats && !error ? <div className="panel loading">正在加载学习统计...</div> : null}
      {stats ? <>
        <section className="metrics learning-metrics" aria-label="学习汇总">
          <div className="metric"><span className="metric-label">累计打卡</span><strong className="metric-value">{stats.summary.checkinDays} 天</strong></div>
          <div className="metric"><span className="metric-label">连续打卡</span><strong className="metric-value">{stats.summary.currentStreak} 天</strong></div>
          <div className="metric"><span className="metric-label">累计开口</span><strong className="metric-value duration-value">{formatDuration(stats.summary.voiceSeconds)}</strong></div>
          <div className="metric"><span className="metric-label">有效作业</span><strong className="metric-value duration-value">{formatDuration(stats.summary.homeworkSeconds)}</strong></div>
        </section>
        <section className="panel learning-history" aria-labelledby="checkins-title">
          <div className="panel-header"><h2 id="checkins-title">最近打卡</h2><span className="header-user">最近 {recentCheckins.length} 条</span></div>
          <div className="table-wrap"><table><thead><tr><th>打卡日期</th><th>首次活动</th><th>开口时长</th><th>有效作业时长</th><th>当日合计</th></tr></thead><tbody>{recentCheckins.length === 0 ? <tr><td colSpan={5} className="empty">这名学生还没有学习打卡记录</td></tr> : recentCheckins.map((checkin) => <tr key={checkin.checkinDate}><td><strong>{formatCheckinDate(checkin.checkinDate)}</strong></td><td>{formatActivityTime(checkin.firstActivityAt)}</td><td>{formatDuration(checkin.voiceSeconds)}</td><td>{formatDuration(checkin.homeworkSeconds)}</td><td>{formatDuration(checkin.voiceSeconds + checkin.homeworkSeconds)}</td></tr>)}</tbody></table></div>
        </section>
      </> : null}
    </main>
  </div>;
}
