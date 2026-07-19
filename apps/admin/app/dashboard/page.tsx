"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Check, Edit3, Plus, Power, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { ConsoleShell } from "../_components/console-shell";

type Role = "ADMIN" | "TEACHER" | "STUDENT";
type UserStatus = "ACTIVE" | "DISABLED" | string;
type ClassroomStatus = "ACTIVE" | "ARCHIVED" | string;

interface User {
  id: string;
  phone: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  lastLoginAt?: string | null;
  createdAt?: string;
}

interface Classroom {
  id: string;
  name: string;
  status: ClassroomStatus;
  teachers: User[];
  students: User[];
}

interface ContextResponse {
  user: User;
  speechAssessment: { configured: boolean; provider: string | null };
}

interface UserListResponse {
  users: User[];
  pagination?: { total: number; page?: number; pageSize?: number };
  summary?: { studentCount: number; activeCount: number };
}

interface ClassroomListResponse {
  classrooms: Classroom[];
}

interface ClassroomDraft {
  id: string | null;
  name: string;
  status: ClassroomStatus;
  teacherIds: string[];
  studentIds: string[];
}

const emptyClassroomDraft: ClassroomDraft = { id: null, name: "", status: "ACTIVE", teacherIds: [], studentIds: [] };

function roleLabel(role: Role) {
  if (role === "ADMIN") return "管理员";
  if (role === "TEACHER") return "教师";
  return "学生";
}

function statusLabel(status: string) {
  if (status === "ACTIVE") return "可用";
  if (status === "ARCHIVED") return "已归档";
  return "已停用";
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "-";
}

function uniqueUsers(users: User[], classrooms: Classroom[]) {
  const byId = new Map(users.map((user) => [user.id, user]));
  classrooms.forEach((classroom) => [...classroom.teachers, ...classroom.students].forEach((user) => byId.set(user.id, user)));
  return Array.from(byId.values());
}

function dedupeUsers(users: User[]) {
  return Array.from(new Map(users.map((user) => [user.id, user])).values());
}

function isManagedAccount(user: User) {
  return !user.role || user.role === "TEACHER" || user.role === "STUDENT";
}

export default function DashboardPage() {
  const router = useRouter();
  const [context, setContext] = useState<ContextResponse | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [userForm, setUserForm] = useState({ role: "STUDENT" as Extract<Role, "TEACHER" | "STUDENT">, displayName: "", phone: "", password: "" });
  const [classroomDraft, setClassroomDraft] = useState<ClassroomDraft>(emptyClassroomDraft);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const isAdmin = context?.user.role === "ADMIN";
  const allKnownUsers = useMemo(() => uniqueUsers(users, classrooms), [users, classrooms]);
  const teachers = allKnownUsers.filter((user) => user.role === "TEACHER" && user.status === "ACTIVE");
  const students = allKnownUsers.filter((user) => user.role === "STUDENT");
  const visibleUsers = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return users;
    return users.filter((user) => `${user.displayName} ${user.phone} ${roleLabel(user.role)}`.toLocaleLowerCase("zh-CN").includes(keyword));
  }, [search, users]);

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
    const contextResponse = await fetch("/api/admin/context");
    const nextContext = await requireJson(contextResponse, "无法加载管理会话") as ContextResponse;
    setContext(nextContext);

    const classroomResponse = await fetch("/api/admin/classrooms");
    const classroomBody = await requireJson(classroomResponse, "无法加载班级") as ClassroomListResponse;
    setClassrooms(classroomBody.classrooms ?? []);

    if (nextContext.user.role === "ADMIN") {
      setUsers(await loadAllUsers());
    } else {
      setUsers([]);
    }
  }

  async function loadAllUsers() {
    const pageSize = 100;
    const firstResponse = await fetch(`/api/admin/users?page=1&pageSize=${pageSize}`);
    const firstBody = await requireJson(firstResponse, "无法加载账号") as UserListResponse;
    const usersPage = firstBody.users ?? [];
    const total = firstBody.pagination?.total ?? usersPage.length;
    const pageCount = Math.ceil(total / pageSize);
    if (pageCount <= 1) return usersPage.filter(isManagedAccount);

    const remainingPages = await Promise.all(Array.from({ length: pageCount - 1 }, async (_, index) => {
      const page = index + 2;
      const response = await fetch(`/api/admin/users?page=${page}&pageSize=${pageSize}`);
      const body = await requireJson(response, `无法加载第 ${page} 页账号`) as UserListResponse;
      return body.users ?? [];
    }));

    return dedupeUsers([...usersPage, ...remainingPages.flat()]).filter(isManagedAccount);
  }

  useEffect(() => {
    void loadData().catch((cause) => setError(cause instanceof Error ? cause.message : "网络连接失败"));
  }, []);

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusyKey("create-user");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...userForm, displayName: userForm.displayName.trim(), phone: userForm.phone.trim() }),
      });
      const body = await requireJson(response, "账号创建失败") as { user: User };
      setUsers((current) => [body.user, ...current.filter((user) => user.id !== body.user.id)]);
      setUserForm({ role: "STUDENT", displayName: "", phone: "", password: "" });
      setNotice(`已创建${roleLabel(body.user.role)}账号：${body.user.displayName}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "账号创建失败");
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleUserStatus(user: User) {
    const nextStatus = user.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    setError("");
    setNotice("");
    setBusyKey(`user-${user.id}`);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const body = await requireJson(response, "账号状态更新失败") as { user: User };
      setUsers((current) => current.map((item) => item.id === user.id ? body.user : item));
      setNotice(`${body.user.displayName} 已${body.user.status === "ACTIVE" ? "启用" : "停用"}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "账号状态更新失败");
    } finally {
      setBusyKey(null);
    }
  }

  function editClassroom(classroom: Classroom) {
    setClassroomDraft({
      id: classroom.id,
      name: classroom.name,
      status: classroom.status,
      teacherIds: classroom.teachers.map((teacher) => teacher.id),
      studentIds: classroom.students.map((student) => student.id),
    });
  }

  function toggleDraftMember(kind: "teacherIds" | "studentIds", userId: string) {
    setClassroomDraft((current) => ({
      ...current,
      [kind]: current[kind].includes(userId) ? current[kind].filter((id) => id !== userId) : [...current[kind], userId],
    }));
  }

  async function saveClassroom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusyKey("classroom");
    try {
      const url = classroomDraft.id ? `/api/admin/classrooms/${encodeURIComponent(classroomDraft.id)}` : "/api/admin/classrooms";
      const response = await fetch(url, {
        method: classroomDraft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: classroomDraft.name.trim(),
          status: classroomDraft.status,
          teacherIds: classroomDraft.teacherIds,
          studentIds: classroomDraft.studentIds,
        }),
      });
      const body = await requireJson(response, "班级保存失败") as { classroom: Classroom };
      setClassrooms((current) => classroomDraft.id
        ? current.map((item) => item.id === body.classroom.id ? body.classroom : item)
        : [body.classroom, ...current]);
      setClassroomDraft(emptyClassroomDraft);
      setNotice(`已保存班级：${body.classroom.name}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "班级保存失败");
    } finally {
      setBusyKey(null);
    }
  }

  return <ConsoleShell>
    <main className="main">
      <header className="page-header"><div><p className="eyebrow">运营工作台</p><h1>账号与班级</h1></div><span className="header-user">{context ? `${context.user.displayName} · ${roleLabel(context.user.role)}` : "正在确认会话"}</span></header>
      {error ? <p className="table-error page-message" role="alert">{error}</p> : null}
      {notice ? <p className="success-note" role="status">{notice}</p> : null}
      <section className="metrics" aria-label="运营统计">
        <div className="metric"><span className="metric-label">当前角色</span><strong className="metric-value">{context ? roleLabel(context.user.role) : "-"}</strong></div>
        <div className="metric"><span className="metric-label">班级数量</span><strong className="metric-value">{classrooms.length}</strong></div>
        <div className="metric"><span className="metric-label">语音评测</span><strong className="metric-value duration-value">{context?.speechAssessment.configured ? context.speechAssessment.provider ?? "已配置" : "未配置"}</strong></div>
      </section>

      {isAdmin ? <div className="workspace-grid">
        <section className="panel" aria-labelledby="create-user-title">
          <div className="panel-header"><h2 id="create-user-title">创建账号</h2><span className="header-user">仅教师 / 学生</span></div>
          <form className="form-body" onSubmit={createUser}>
            <div className="schedule-grid">
              <div className="field"><label htmlFor="role">角色</label><select id="role" value={userForm.role} onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value as "TEACHER" | "STUDENT" }))}><option value="STUDENT">学生</option><option value="TEACHER">教师</option></select></div>
              <div className="field"><label htmlFor="display-name">姓名</label><input id="display-name" value={userForm.displayName} onChange={(event) => setUserForm((current) => ({ ...current, displayName: event.target.value }))} maxLength={40} required /></div>
              <div className="field"><label htmlFor="phone">手机号</label><input id="phone" value={userForm.phone} onChange={(event) => setUserForm((current) => ({ ...current, phone: event.target.value }))} inputMode="tel" maxLength={20} required /></div>
              <div className="field"><label htmlFor="initial-password">初始密码</label><input id="initial-password" type="password" value={userForm.password} onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))} minLength={8} required /></div>
            </div>
            <div className="publish-actions"><button className="primary-button publish-button" disabled={busyKey === "create-user"} type="submit"><Plus size={16} />创建账号</button></div>
          </form>
        </section>

        <section className="panel" aria-labelledby="classroom-form-title">
          <div className="panel-header"><h2 id="classroom-form-title">{classroomDraft.id ? "更新班级" : "创建班级"}</h2><button className="text-button" type="button" onClick={() => setClassroomDraft(emptyClassroomDraft)}>清空</button></div>
          <form className="form-body" onSubmit={saveClassroom}>
            <div className="schedule-grid">
              <div className="field"><label htmlFor="classroom-name">班级名称</label><input id="classroom-name" value={classroomDraft.name} onChange={(event) => setClassroomDraft((current) => ({ ...current, name: event.target.value }))} maxLength={80} required /></div>
              <div className="field"><label htmlFor="classroom-status">状态</label><select id="classroom-status" value={classroomDraft.status} onChange={(event) => setClassroomDraft((current) => ({ ...current, status: event.target.value }))}><option value="ACTIVE">可用</option><option value="ARCHIVED">归档</option></select></div>
            </div>
            <div className="membership-grid">
              <div><strong>教师</strong><div className="membership-list">{teachers.length === 0 ? <span className="table-muted">暂无可选教师</span> : teachers.map((teacher) => <label key={teacher.id} className="membership-row"><input type="checkbox" checked={classroomDraft.teacherIds.includes(teacher.id)} onChange={() => toggleDraftMember("teacherIds", teacher.id)} />{teacher.displayName}<small>{teacher.phone}</small></label>)}</div></div>
              <div><strong>学生</strong><div className="membership-list">{students.length === 0 ? <span className="table-muted">暂无可选学生</span> : students.map((student) => <label key={student.id} className="membership-row"><input type="checkbox" checked={classroomDraft.studentIds.includes(student.id)} onChange={() => toggleDraftMember("studentIds", student.id)} />{student.displayName}<small>{student.phone}</small></label>)}</div></div>
            </div>
            <div className="publish-actions"><button className="primary-button publish-button" disabled={busyKey === "classroom"} type="submit"><Save size={16} />保存班级</button></div>
          </form>
        </section>
      </div> : <section className="panel" aria-labelledby="teacher-context-title">
        <div className="panel-header"><h2 id="teacher-context-title">我的班级上下文</h2><span className="header-user">教师只读</span></div>
        <div className="table-wrap"><table><thead><tr><th>班级</th><th>状态</th><th>教师</th><th>学生</th></tr></thead><tbody>{classrooms.length === 0 ? <tr><td colSpan={4} className="empty">暂未分配班级</td></tr> : classrooms.map((classroom) => <tr key={classroom.id}><td>{classroom.name}</td><td><span className="status">{statusLabel(classroom.status)}</span></td><td>{classroom.teachers.map((teacher) => teacher.displayName).join("、") || "-"}</td><td>{classroom.students.map((student) => student.displayName).join("、") || "-"}</td></tr>)}</tbody></table></div>
      </section>}

      {isAdmin ? <section className="panel homework-history" aria-labelledby="accounts-title">
        <div className="panel-header"><h2 id="accounts-title">账号列表</h2><input className="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索姓名、手机号或角色" aria-label="搜索账号" /></div>
        <div className="table-wrap"><table><thead><tr><th>账号</th><th>角色</th><th>手机号</th><th>状态</th><th>最近登录</th><th>学习统计</th><th>操作</th></tr></thead><tbody>{visibleUsers.length === 0 ? <tr><td colSpan={7} className="empty">暂无匹配账号</td></tr> : visibleUsers.map((user) => <tr key={user.id}><td>{user.displayName}</td><td>{roleLabel(user.role)}</td><td>{user.phone}</td><td><span className="status">{statusLabel(user.status)}</span></td><td>{formatDate(user.lastLoginAt)}</td><td>{user.role === "STUDENT" && user.status === "ACTIVE" ? <a className="table-icon-button" href={`/students/${encodeURIComponent(user.id)}/learning-stats?name=${encodeURIComponent(user.displayName)}`} title={`查看 ${user.displayName} 的学习统计`} aria-label={`查看 ${user.displayName} 的学习统计`}><BarChart3 size={17} /></a> : <span className="table-muted">-</span>}</td><td><button className="table-icon-button" type="button" title={user.status === "ACTIVE" ? "停用账号" : "启用账号"} aria-label={user.status === "ACTIVE" ? `停用 ${user.displayName}` : `启用 ${user.displayName}`} disabled={busyKey === `user-${user.id}` || user.id === context?.user.id} onClick={() => void toggleUserStatus(user)}>{user.status === "ACTIVE" ? <Power size={16} /> : <Check size={16} />}</button></td></tr>)}</tbody></table></div>
      </section> : null}

      <section className="panel homework-history" aria-labelledby="classrooms-title">
        <div className="panel-header"><h2 id="classrooms-title">班级列表</h2><span className="header-user">{classrooms.length} 个班级</span></div>
        <div className="table-wrap"><table><thead><tr><th>班级</th><th>状态</th><th>教师</th><th>学生</th>{isAdmin ? <th>操作</th> : null}</tr></thead><tbody>{classrooms.length === 0 ? <tr><td colSpan={isAdmin ? 5 : 4} className="empty">暂无班级</td></tr> : classrooms.map((classroom) => <tr key={classroom.id}><td>{classroom.name}</td><td><span className="status">{statusLabel(classroom.status)}</span></td><td>{classroom.teachers.map((teacher) => teacher.displayName).join("、") || "-"}</td><td>{classroom.students.length} 名</td>{isAdmin ? <td><button className="table-icon-button" type="button" title="编辑班级" aria-label={`编辑 ${classroom.name}`} onClick={() => editClassroom(classroom)}><Edit3 size={16} /></button></td> : null}</tr>)}</tbody></table></div>
      </section>
    </main>
  </ConsoleShell>;
}
