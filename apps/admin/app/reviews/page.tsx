"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, FileAudio, Mic, RefreshCw, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { ConsoleShell } from "../_components/console-shell";

type Grade = "SSS" | "SS" | "S" | "A" | "B";
type StoredGrade = Grade | "C" | "D";
type ReviewStatus = "IN_PROGRESS" | "PENDING_REVIEW" | "REVIEWED";

interface SpeechAssessment {
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  overallScore: number | null;
  accuracyScore: number | null;
  fluencyScore: number | null;
}

interface SubmissionConversation {
  occurrenceId: string;
  studentId: string;
  studentName: string;
  homeworkId: string;
  homeworkTitle: string;
  instructions: string | null;
  templateType: string;
  classroomName: string | null;
  latestSubmittedAt: string;
  submittedCount: number;
  reviewedCount: number;
  totalCount: number;
  reviewStatus: ReviewStatus;
}

interface SubmissionQuestion {
  sourceKind: "CARD" | "ITEM";
  questionId: string;
  submissionId: string | null;
  position: number;
  promptText: string | null;
  referenceText: string | null;
  imageUrl: string | null;
  sampleAudioUrl: string | null;
  answerText: string | null;
  submissionType: "RECORDING" | "ANSWER" | null;
  audioUrl: string | null;
  submittedAnswerText: string | null;
  isCorrect: boolean | null;
  submittedAt: string | null;
  feedbackAudioUrl: string | null;
  grade: StoredGrade | null;
  reviewedAt: string | null;
  assessment: SpeechAssessment | null;
  reviewStatus: "UNSUBMITTED" | "PENDING_REVIEW" | "REVIEWED";
}

interface SubmissionDetail extends SubmissionConversation {
  questions: SubmissionQuestion[];
}

interface ListResponse {
  conversations: SubmissionConversation[];
  filters: {
    students: Array<{ id: string; displayName: string }>;
    homeworks: Array<{ id: string; title: string }>;
  };
  pagination: { page: number; pageSize: number; total: number };
}

const templateLabels: Record<string, string> = {
  READ_ALOUD_PICTURE_BOOK: "跟读绘本",
  SENTENCE_READ_ALOUD: "句子朗读",
  WORD_READ_ALOUD: "单词朗读",
  WORD_IMAGE_MATCH: "图片选词",
  WORD_SCRAMBLE: "字母排序",
  WORD_FILL_BLANK: "句子填空",
};

const GRADE_OPTIONS: Grade[] = ["SSS", "SS", "S", "A", "B"];

function normalizedGrade(grade: StoredGrade | null | undefined): Grade {
  return GRADE_OPTIONS.includes(grade as Grade) ? grade as Grade : "A";
}

function legacyGradeNote(grade: StoredGrade | null) {
  return grade === "C" || grade === "D" ? <span className="human-grade-note">历史等级 {grade}</span> : null;
}

function mediaUrl(url: string) {
  return `/api/admin/media/${url.replace(/^\/uploads\//, "")}`;
}

function statusLabel(status: ReviewStatus) {
  if (status === "REVIEWED") return "已批改";
  if (status === "PENDING_REVIEW") return "待批改";
  return "提交中";
}

function assessmentText(assessment: SpeechAssessment | null) {
  if (!assessment) return "暂无机器评测";
  if (assessment.status === "QUEUED") return "机器评测排队中";
  if (assessment.status === "PROCESSING") return "机器评测处理中";
  if (assessment.status === "FAILED") return "机器评测未完成";
  if (assessment.overallScore === null) return "机器评测已完成";
  return `机器评分 ${Math.round(assessment.overallScore)} · 准确 ${Math.round(assessment.accuracyScore ?? 0)} · 流利 ${Math.round(assessment.fluencyScore ?? 0)}`;
}

export default function ReviewsPage() {
  const router = useRouter();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [conversations, setConversations] = useState<SubmissionConversation[]>([]);
  const [options, setOptions] = useState<ListResponse["filters"]>({ students: [], homeworks: [] });
  const [filters, setFilters] = useState({ studentId: "", homeworkId: "", submittedFrom: "", submittedTo: "" });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [grades, setGrades] = useState<Record<string, Grade>>({});
  const [feedbackUrls, setFeedbackUrls] = useState<Record<string, string>>({});
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function requireBody(response: Response, fallback: string) {
    const body = await response.json();
    if (response.status === 401 || response.status === 403) {
      router.replace("/login");
      throw new Error("请重新登录");
    }
    if (!response.ok) throw new Error(body.message ?? fallback);
    return body;
  }

  async function loadList(nextPage = 1) {
    setIsLoading(true);
    setError("");
    try {
      const search = new URLSearchParams({ page: String(nextPage), pageSize: "20" });
      if (filters.studentId) search.set("studentId", filters.studentId);
      if (filters.homeworkId) search.set("homeworkId", filters.homeworkId);
      if (filters.submittedFrom) search.set("submittedFrom", new Date(filters.submittedFrom).toISOString());
      if (filters.submittedTo) search.set("submittedTo", new Date(filters.submittedTo).toISOString());
      const body = await requireBody(await fetch(`/api/admin/homework-submissions?${search}`), "无法加载学生作业") as ListResponse;
      setConversations(body.conversations);
      setOptions(body.filters);
      setPage(body.pagination.page);
      setTotal(body.pagination.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法加载学生作业");
    } finally {
      setIsLoading(false);
    }
  }

  async function openConversation(occurrenceId: string) {
    setError("");
    try {
      const body = await requireBody(await fetch(`/api/admin/homework-submissions/${encodeURIComponent(occurrenceId)}`), "无法加载作业详情") as { conversation: SubmissionDetail };
      setDetail(body.conversation);
      setGrades(Object.fromEntries(body.conversation.questions.filter((question) => question.submissionId).map((question) => [question.submissionId!, normalizedGrade(question.grade)])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法加载作业详情");
    }
  }

  useEffect(() => {
    void loadList(1);
    return () => streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function uploadFeedback(submissionId: string, file: File) {
    setBusyId(submissionId);
    setError("");
    try {
      const formData = new FormData();
      formData.append("purpose", "FEEDBACK");
      formData.append("file", file);
      const body = await requireBody(await fetch("/api/admin/uploads", { method: "POST", body: formData }), "点评音频上传失败") as { url: string; kind: string; purpose: string };
      if (body.kind !== "audio" || body.purpose !== "FEEDBACK") throw new Error("点评音频需要通过私有通道上传");
      setFeedbackUrls((current) => ({ ...current, [submissionId]: body.url }));
      setNotice("点评音频已上传");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "点评音频上传失败");
    } finally {
      setBusyId(null);
    }
  }

  async function startRecording(submissionId: string) {
    if (recordingId) return;
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
      recorder.addEventListener("stop", () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecordingId(null);
        if (chunks.length) {
          const type = recorder.mimeType || "audio/webm";
          void uploadFeedback(submissionId, new File([new Blob(chunks, { type })], `teacher-feedback-${Date.now()}.webm`, { type }));
        }
      });
      recorder.start();
      setRecordingId(submissionId);
    } catch {
      setError("无法开始语音点评，请允许浏览器使用麦克风");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function review(question: SubmissionQuestion) {
    if (!detail || !question.submissionId) return;
    setBusyId(question.submissionId);
    setError("");
    setNotice("");
    try {
      const path = [detail.occurrenceId, question.sourceKind, question.submissionId].map(encodeURIComponent).join("/");
      const response = await fetch(`/api/admin/homework-submissions/${path}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade: grades[question.submissionId] ?? normalizedGrade(question.grade), feedbackAudioUrl: feedbackUrls[question.submissionId] || undefined }),
      });
      const body = await requireBody(response, "批改提交失败") as { conversation: SubmissionDetail };
      setDetail(body.conversation);
      setNotice(`第 ${question.position} 题已批改`);
      await loadList(page);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "批改提交失败");
    } finally {
      setBusyId(null);
    }
  }

  if (detail) {
    return <ConsoleShell><main className="main">
      <button className="back-link review-back" type="button" onClick={() => setDetail(null)}><ArrowLeft size={16} />返回批改列表</button>
      <header className="page-header review-detail-header"><div><p className="eyebrow">{detail.studentName} · {templateLabels[detail.templateType] ?? detail.templateType}</p><h1>{detail.homeworkTitle}</h1></div><div className="review-progress-summary"><strong>{detail.reviewedCount}/{detail.submittedCount}</strong><span>已批改 · 共 {detail.totalCount} 题</span></div></header>
      <div className="review-conversation-meta"><strong>{detail.classroomName ?? "未限定班级"}</strong><span>最近提交 {new Date(detail.latestSubmittedAt).toLocaleString("zh-CN")}</span>{detail.instructions ? <p>{detail.instructions}</p> : null}</div>
      {error ? <p className="form-error page-message">{error}</p> : null}{notice ? <p className="success-note">{notice}</p> : null}
      <div className="review-question-list">{detail.questions.map((question) => {
        const prompt = question.referenceText ?? question.promptText ?? question.answerText ?? `第 ${question.position} 题`;
        return <article className="review-question-row" key={`${question.sourceKind}-${question.questionId}`}>
          <div className="review-question-index">{question.position}</div>
          <div className="review-question-content">
            <div className="review-question-heading"><div><span className="review-template">{question.submissionType === "ANSWER" ? "客观题" : "朗读题"}</span><h2>{prompt}</h2></div><span className={`status ${question.reviewStatus === "REVIEWED" ? "graded-status" : ""}`}>{question.reviewStatus === "REVIEWED" ? "已批改" : question.reviewStatus === "PENDING_REVIEW" ? "待批改" : "未提交"}</span></div>
            {question.imageUrl ? <img className="review-question-image" src={mediaUrl(question.imageUrl)} alt="" /> : null}
            {question.submittedAnswerText ? <p className="review-answer">学生答案：<strong>{question.submittedAnswerText}</strong><span className={question.isCorrect ? "answer-correct" : "answer-wrong"}>{question.isCorrect ? "自动判题正确" : "自动判题错误"}</span></p> : null}
            <div className="review-media-row">{question.sampleAudioUrl ? <audio className="audio-control" controls preload="none" src={mediaUrl(question.sampleAudioUrl)} /> : null}{question.audioUrl ? <audio className="audio-control" controls preload="none" src={mediaUrl(question.audioUrl)} /> : null}<span className="table-muted">{assessmentText(question.assessment)}</span></div>
            <div className="review-question-actions"><span className="table-muted">{question.submittedAt ? `提交于 ${new Date(question.submittedAt).toLocaleString("zh-CN")}` : "尚未提交"}</span>{question.submissionId ? <><div><select className="grade-select" aria-label={`第 ${question.position} 题人工等级`} value={grades[question.submissionId] ?? normalizedGrade(question.grade)} onChange={(event) => setGrades((current) => ({ ...current, [question.submissionId!]: event.target.value as Grade }))}>{GRADE_OPTIONS.map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select>{legacyGradeNote(question.grade)}</div>{recordingId === question.submissionId ? <button className="table-icon-button recording-icon-button" type="button" title="停止语音点评" onClick={stopRecording}><Square size={15} /></button> : <button className="table-icon-button" type="button" title="录制语音点评" disabled={Boolean(recordingId) || busyId === question.submissionId} onClick={() => void startRecording(question.submissionId!)}><Mic size={16} /></button>}<label className="review-audio-upload" title="上传语音点评"><FileAudio size={17} /><input type="file" accept="audio/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFeedback(question.submissionId!, file); }} /></label><button className="table-icon-button" type="button" title="提交人工批改" disabled={busyId === question.submissionId || recordingId === question.submissionId} onClick={() => void review(question)}>{busyId === question.submissionId ? "..." : <Check size={18} />}</button></> : null}</div>
          </div>
        </article>;
      })}</div>
    </main></ConsoleShell>;
  }

  return <ConsoleShell><main className="main">
    <header className="page-header"><div><p className="eyebrow">教师工作台</p><h1>作业批改</h1></div><button className="table-icon-button" type="button" title="刷新批改列表" onClick={() => void loadList(page)}><RefreshCw size={17} /></button></header>
    {error ? <p className="form-error page-message">{error}</p> : null}
    <form className="review-filters" onSubmit={(event) => { event.preventDefault(); void loadList(1); }}>
      <label>学生<select value={filters.studentId} onChange={(event) => setFilters((current) => ({ ...current, studentId: event.target.value }))}><option value="">全部学生</option>{options.students.map((student) => <option key={student.id} value={student.id}>{student.displayName}</option>)}</select></label>
      <label>作业<select value={filters.homeworkId} onChange={(event) => setFilters((current) => ({ ...current, homeworkId: event.target.value }))}><option value="">全部作业</option>{options.homeworks.map((homework) => <option key={homework.id} value={homework.id}>{homework.title}</option>)}</select></label>
      <label>开始时间<input type="datetime-local" value={filters.submittedFrom} onChange={(event) => setFilters((current) => ({ ...current, submittedFrom: event.target.value }))} /></label>
      <label>结束时间<input type="datetime-local" value={filters.submittedTo} onChange={(event) => setFilters((current) => ({ ...current, submittedTo: event.target.value }))} /></label>
      <button className="primary-button review-filter-submit" type="submit">筛选</button>
    </form>
    <div className="review-list-heading"><strong>学生作业</strong><span>共 {total} 份</span></div>
    <section className="review-card-list">{isLoading ? <p className="loading">正在加载...</p> : conversations.length === 0 ? <p className="empty">没有符合条件的学生作业</p> : conversations.map((conversation) => <button className="review-conversation-card" type="button" key={conversation.occurrenceId} onClick={() => void openConversation(conversation.occurrenceId)}>
      <div className="review-card-main"><div><strong>{conversation.studentName}</strong><span>{conversation.homeworkTitle}</span></div><div className="review-card-status"><strong>{conversation.reviewedCount}/{conversation.submittedCount}</strong><span>{statusLabel(conversation.reviewStatus)}</span></div></div>
      <div className="review-card-footer"><span>{conversation.classroomName ?? "未限定班级"} · {templateLabels[conversation.templateType] ?? conversation.templateType} · 已提交 {conversation.submittedCount}/{conversation.totalCount}</span><time>{new Date(conversation.latestSubmittedAt).toLocaleString("zh-CN")}</time></div>
    </button>)}</section>
    {total > 20 ? <div className="review-pagination"><button type="button" disabled={page <= 1} onClick={() => void loadList(page - 1)}>上一页</button><span>第 {page} / {Math.ceil(total / 20)} 页</span><button type="button" disabled={page >= Math.ceil(total / 20)} onClick={() => void loadList(page + 1)}>下一页</button></div> : null}
  </main></ConsoleShell>;
}
