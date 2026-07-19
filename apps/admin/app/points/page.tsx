"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { ConsoleShell } from "../_components/console-shell";

interface StreakReward {
  days: number;
  points: number;
}

interface PointPolicy {
  classroomId: string;
  classroomName?: string | null;
  classroom?: { id: string; name: string } | null;
  dailyCheckinPoints: number;
  homeworkCompletionPoints: number;
  streakRewards: StreakReward[];
}

interface PointPoliciesResponse {
  policies?: PointPolicy[];
  pointPolicies?: PointPolicy[];
}

interface DraftReward {
  id: string;
  days: string;
  points: string;
}

interface PolicyDraft {
  dailyCheckinPoints: string;
  homeworkCompletionPoints: string;
  streakRewards: DraftReward[];
}

function policyName(policy: PointPolicy) {
  return policy.classroomName ?? policy.classroom?.name ?? "未命名班级";
}

function createRewardDraft(reward?: StreakReward): DraftReward {
  return {
    id: crypto.randomUUID(),
    days: reward ? String(reward.days) : "",
    points: reward ? String(reward.points) : "",
  };
}

function createPolicyDraft(policy: PointPolicy): PolicyDraft {
  return {
    dailyCheckinPoints: String(policy.dailyCheckinPoints),
    homeworkCompletionPoints: String(policy.homeworkCompletionPoints),
    streakRewards: [...(policy.streakRewards ?? [])]
      .sort((left, right) => left.days - right.days)
      .map(createRewardDraft),
  };
}

function readInteger(value: string) {
  if (!/^\d+$/.test(value.trim())) return null;
  return Number(value);
}

function validateDraft(draft: PolicyDraft) {
  const dailyCheckinPoints = readInteger(draft.dailyCheckinPoints);
  const homeworkCompletionPoints = readInteger(draft.homeworkCompletionPoints);
  if (dailyCheckinPoints === null || dailyCheckinPoints > 100) return "每日打卡积分必须是 0-100 的整数";
  if (homeworkCompletionPoints === null || homeworkCompletionPoints > 500) return "作业完成积分必须是 0-500 的整数";
  if (draft.streakRewards.length > 20) return "连续打卡里程碑最多 20 个";

  const daysSeen = new Set<number>();
  for (const [index, reward] of draft.streakRewards.entries()) {
    const days = readInteger(reward.days);
    const points = readInteger(reward.points);
    if (days === null || days < 2 || days > 365) return `第 ${index + 1} 个里程碑天数必须是 2-365 的整数`;
    if (points === null || points < 1 || points > 1000) return `第 ${index + 1} 个里程碑积分必须是 1-1000 的整数`;
    if (daysSeen.has(days)) return `连续 ${days} 天的里程碑不能重复`;
    daysSeen.add(days);
  }
  return "";
}

function buildPayload(draft: PolicyDraft) {
  return {
    dailyCheckinPoints: readInteger(draft.dailyCheckinPoints) ?? 0,
    homeworkCompletionPoints: readInteger(draft.homeworkCompletionPoints) ?? 0,
    streakRewards: draft.streakRewards
      .map((reward) => ({ days: readInteger(reward.days) ?? 0, points: readInteger(reward.points) ?? 0 }))
      .sort((left, right) => left.days - right.days),
  };
}

export default function PointsPage() {
  const router = useRouter();
  const [policies, setPolicies] = useState<PointPolicy[]>([]);
  const [selectedClassroomId, setSelectedClassroomId] = useState("");
  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const selectedPolicy = useMemo(
    () => policies.find((policy) => policy.classroomId === selectedClassroomId) ?? null,
    [policies, selectedClassroomId],
  );

  async function loadPolicies() {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/point-policies");
      if (response.status === 401 || response.status === 403) {
        router.replace("/login");
        return;
      }
      const body = await response.json() as PointPoliciesResponse & { message?: string };
      if (!response.ok) throw new Error(body.message ?? "无法加载积分规则");
      const nextPolicies = body.policies ?? body.pointPolicies ?? [];
      setPolicies(nextPolicies);
      const nextSelectedId = selectedClassroomId && nextPolicies.some((policy) => policy.classroomId === selectedClassroomId)
        ? selectedClassroomId
        : nextPolicies[0]?.classroomId ?? "";
      setSelectedClassroomId(nextSelectedId);
      const nextPolicy = nextPolicies.find((policy) => policy.classroomId === nextSelectedId);
      setDraft(nextPolicy ? createPolicyDraft(nextPolicy) : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "网络连接失败");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadPolicies();
  }, []);

  function selectClassroom(classroomId: string) {
    setSelectedClassroomId(classroomId);
    setNotice("");
    setError("");
    const nextPolicy = policies.find((policy) => policy.classroomId === classroomId);
    setDraft(nextPolicy ? createPolicyDraft(nextPolicy) : null);
  }

  function updateDraft(patch: Partial<PolicyDraft>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
  }

  function updateReward(rewardId: string, patch: Partial<DraftReward>) {
    setDraft((current) => current ? {
      ...current,
      streakRewards: current.streakRewards.map((reward) => reward.id === rewardId ? { ...reward, ...patch } : reward),
    } : current);
  }

  function addReward() {
    setDraft((current) => current && current.streakRewards.length < 20
      ? { ...current, streakRewards: [...current.streakRewards, createRewardDraft()] }
      : current);
  }

  function removeReward(rewardId: string) {
    setDraft((current) => current ? {
      ...current,
      streakRewards: current.streakRewards.filter((reward) => reward.id !== rewardId),
    } : current);
  }

  async function savePolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !selectedPolicy) return;
    setError("");
    setNotice("");
    const draftError = validateDraft(draft);
    if (draftError) {
      setError(draftError);
      return;
    }
    setIsSaving(true);
    try {
      const response = await fetch(`/api/admin/classrooms/${encodeURIComponent(selectedPolicy.classroomId)}/point-policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(draft)),
      });
      if (response.status === 401 || response.status === 403) {
        router.replace("/login");
        return;
      }
      const body = await response.json() as { policy?: PointPolicy; message?: string };
      if (!response.ok) throw new Error(body.message ?? "积分规则保存失败");
      const savedPolicy = body.policy ?? { ...selectedPolicy, ...buildPayload(draft) };
      setPolicies((current) => current.map((policy) => policy.classroomId === savedPolicy.classroomId ? savedPolicy : policy));
      setDraft(createPolicyDraft(savedPolicy));
      setNotice(`已保存 ${policyName(savedPolicy)} 的积分规则，仅影响未来奖励。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "积分规则保存失败");
    } finally {
      setIsSaving(false);
    }
  }

  return <ConsoleShell>
    <main className="main">
      <header className="page-header"><div><p className="eyebrow">学生激励</p><h1>积分规则</h1></div><span className="header-user">规则变更仅影响未来奖励</span></header>
      {error ? <p className="table-error page-message" role="alert">{error}</p> : null}
      {notice ? <p className="success-note" role="status">{notice}</p> : null}
      <section className="panel" aria-labelledby="points-title">
        <div className="panel-header"><h2 id="points-title">班级奖励配置</h2><span className="header-user">每日打卡、作业完成、连续打卡</span></div>
        {isLoading ? <div className="loading">正在加载积分规则...</div> : null}
        {!isLoading && policies.length === 0 ? <div className="empty">暂无可配置的启用班级积分规则</div> : null}
        {draft && selectedPolicy ? <form className="form-body points-form" onSubmit={savePolicy}>
          <div className="field"><label htmlFor="point-classroom">班级</label><select id="point-classroom" value={selectedClassroomId} onChange={(event) => selectClassroom(event.target.value)}>{policies.map((policy) => <option key={policy.classroomId} value={policy.classroomId}>{policyName(policy)}</option>)}</select><span className="field-hint">只显示当前账号可管理的启用班级。</span></div>
          <div className="schedule-grid">
            <div className="field"><label htmlFor="daily-points">每日首次学习打卡积分</label><input id="daily-points" type="number" min={0} max={100} step={1} value={draft.dailyCheckinPoints} onChange={(event) => updateDraft({ dailyCheckinPoints: event.target.value })} required /></div>
            <div className="field"><label htmlFor="homework-points">首次完成作业积分</label><input id="homework-points" type="number" min={0} max={500} step={1} value={draft.homeworkCompletionPoints} onChange={(event) => updateDraft({ homeworkCompletionPoints: event.target.value })} required /></div>
          </div>
          <div className="streak-heading"><div><strong>连续打卡里程碑</strong><span>达到指定连续天数时奖励一次；最多 20 个，天数不可重复。</span></div><button className="table-icon-button" type="button" title="添加里程碑" aria-label="添加连续打卡里程碑" disabled={draft.streakRewards.length >= 20} onClick={addReward}><Plus size={16} /></button></div>
          <div className="streak-list">{draft.streakRewards.length === 0 ? <p className="builder-empty">暂未设置连续打卡奖励。</p> : draft.streakRewards.map((reward, index) => <div className="streak-row" key={reward.id}>
            <span className="table-muted">#{index + 1}</span>
            <label><span>连续天数</span><input type="number" min={2} max={365} step={1} value={reward.days} onChange={(event) => updateReward(reward.id, { days: event.target.value })} required /></label>
            <label><span>奖励积分</span><input type="number" min={1} max={1000} step={1} value={reward.points} onChange={(event) => updateReward(reward.id, { points: event.target.value })} required /></label>
            <button className="table-icon-button" type="button" title="删除里程碑" aria-label={`删除第 ${index + 1} 个里程碑`} onClick={() => removeReward(reward.id)}><Trash2 size={16} /></button>
          </div>)}</div>
          <p className="form-note points-note">学生已获得的积分为追加记录，保存后不会重算历史奖励。</p>
          <div className="publish-actions"><button className="primary-button publish-button" type="submit" disabled={isSaving}><Save size={16} />{isSaving ? "正在保存..." : "保存规则"}</button></div>
        </form> : null}
      </section>
    </main>
  </ConsoleShell>;
}
