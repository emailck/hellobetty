"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, BookOpen, LayoutDashboard, LogOut, Users } from "lucide-react";
import { useRouter } from "next/navigation";

interface User {
  id: string;
  phone: string;
  displayName: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

interface UserListResponse {
  users: User[];
  pagination: { total: number };
  summary: { studentCount: number; activeCount: number };
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<UserListResponse | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const query = useMemo(() => new URLSearchParams({ page: "1", pageSize: "20", ...(search ? { search } : {}) }), [search]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setError("");
      try {
        const response = await fetch(`/api/admin/users?${query}`, { signal: controller.signal });
        if (response.status === 401 || response.status === 403) {
          router.replace("/login");
          return;
        }
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? "无法获取学生账号");
        setData(body);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "网络连接失败");
      }
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, router]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return <div className="console">
    <aside className="sidebar">
      <div className="sidebar-brand">Hello Betty</div>
      <a className="nav-link active" href="/dashboard"><LayoutDashboard size={17} />概览</a>
      <a className="nav-link" href="#students"><Users size={17} />学生账号</a>
      <a className="nav-link" href="/homeworks"><BookOpen size={17} />作业管理</a>
      <div className="sidebar-footer"><button className="logout" onClick={logout}><LogOut size={16} />退出登录</button></div>
    </aside>
    <main className="main">
      <header className="page-header"><div><p className="eyebrow">账号管理</p><h1>学生账号概览</h1></div><span className="header-user">管理员会话已受保护</span></header>
      <section className="metrics" aria-label="账号统计">
        <div className="metric"><span className="metric-label">学生总数</span><strong className="metric-value">{data?.summary.studentCount ?? "-"}</strong></div>
        <div className="metric"><span className="metric-label">可用账号</span><strong className="metric-value">{data?.summary.activeCount ?? "-"}</strong></div>
        <div className="metric"><span className="metric-label">作业模块</span><strong className="metric-value">筹备中</strong></div>
      </section>
      <section id="students" className="panel" aria-labelledby="students-title">
        <div className="panel-header"><h2 id="students-title">学生列表</h2><input className="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索姓名或手机号" aria-label="搜索学生" /></div>
        {error ? <div className="table-error" role="alert">{error}</div> : null}
        {!data && !error ? <div className="loading">正在加载账号...</div> : null}
        {data ? <div className="table-wrap"><table><thead><tr><th>学生</th><th>手机号</th><th>状态</th><th>最近登录</th><th>注册时间</th><th>学习统计</th></tr></thead><tbody>{data.users.length === 0 ? <tr><td colSpan={6} className="empty">暂时没有匹配的学生账号</td></tr> : data.users.map((user) => <tr key={user.id}><td>{user.displayName}</td><td>{user.phone}</td><td><span className="status">{user.status === "ACTIVE" ? "可用" : "已停用"}</span></td><td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("zh-CN") : "尚未登录"}</td><td>{new Date(user.createdAt).toLocaleDateString("zh-CN")}</td><td>{user.status === "ACTIVE" ? <a className="table-icon-button" href={`/students/${encodeURIComponent(user.id)}/learning-stats?name=${encodeURIComponent(user.displayName)}`} title={`查看 ${user.displayName} 的学习统计`} aria-label={`查看 ${user.displayName} 的学习统计`}><BarChart3 size={17} /></a> : <span className="table-muted">不可查看</span>}</td></tr>)}</tbody></table></div> : null}
      </section>
    </main>
  </div>;
}
