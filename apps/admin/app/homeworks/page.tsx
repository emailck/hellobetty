"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  CheckCircle2,
  CheckSquare,
  Clock3,
  FileAudio,
  LayoutDashboard,
  LogOut,
  Mic,
  Square,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";

type TemplateType =
  | "STANDARD"
  | "READ_ALOUD_PICTURE_BOOK"
  | "SENTENCE_READ_ALOUD"
  | "WORD_READ_ALOUD"
  | "WORD_IMAGE_MATCH"
  | "WORD_SCRAMBLE"
  | "WORD_FILL_BLANK";

type Grade = "A" | "B" | "C" | "D";
type ReviewStatus = "DONE" | "GRADED";

interface Student {
  id: string;
  displayName: string;
  phone: string;
}

interface Homework {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  repeatUnit: "DAY" | "WEEK";
  repeatInterval: number;
  occurrenceLimit: number;
  targetCount: number;
  occurrenceCount: number;
  templateType: TemplateType;
}

interface HomeworkItemDraft {
  id: string;
  promptText: string;
  referenceText: string;
  imageUrl: string;
  sampleAudioUrl: string;
  answerText: string;
  choicesText: string;
  imageName: string;
  audioName: string;
}

type SpeechAssessmentStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

interface SpeechAssessment {
  id: string;
  status: SpeechAssessmentStatus;
  provider: string | null;
  overallScore: number | null;
  accuracyScore: number | null;
  fluencyScore: number | null;
  completenessScore: number | null;
  prosodyScore: number | null;
  wordResults: Array<{
    word: string;
    accuracyScore: number | null;
    errorType: string | null;
    phonemes: Array<{ phoneme: string; accuracyScore: number | null }>;
  }> | null;
  completedAt: string | null;
}

interface RecordingSubmission {
  id: string;
  source: "picture-book" | "practice";
  studentName: string;
  homeworkTitle: string;
  templateType?: TemplateType;
  cardPosition?: number;
  itemPosition?: number;
  promptText?: string | null;
  answerText?: string | null;
  referenceText?: string | null;
  audioUrl: string;
  feedbackAudioUrl: string | null;
  grade: Grade | null;
  status: ReviewStatus;
  assessment: SpeechAssessment | null;
}

const TEMPLATE_OPTIONS: Array<{ type: TemplateType; label: string; description: string }> = [
  { type: "READ_ALOUD_PICTURE_BOOK", label: "跟读绘本", description: "逐页图片与示范音频" },
  { type: "SENTENCE_READ_ALOUD", label: "句子朗读", description: "逐句录音，教师评分" },
  { type: "WORD_READ_ALOUD", label: "单词朗读", description: "看图听音后逐词录音" },
  { type: "WORD_IMAGE_MATCH", label: "图片选词", description: "看图选择正确单词" },
  { type: "WORD_SCRAMBLE", label: "字母排序", description: "看图排列单词字母" },
  { type: "WORD_FILL_BLANK", label: "句子填空", description: "根据图片选择缺失单词" },
  { type: "STANDARD", label: "普通练习", description: "仅发布说明，不含题目" },
];

const RECORDING_TEMPLATES = new Set<TemplateType>([
  "READ_ALOUD_PICTURE_BOOK",
  "SENTENCE_READ_ALOUD",
  "WORD_READ_ALOUD",
]);

function templateLabel(type: TemplateType | undefined) {
  return TEMPLATE_OPTIONS.find((option) => option.type === type)?.label ?? "跟读绘本";
}

function createDraft(): HomeworkItemDraft {
  return {
    id: crypto.randomUUID(),
    promptText: "",
    referenceText: "",
    imageUrl: "",
    sampleAudioUrl: "",
    answerText: "",
    choicesText: "",
    imageName: "",
    audioName: "",
  };
}

function localDateTimeValue() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function parseChoices(raw: string) {
  return Array.from(new Set(raw.split(/[,，\n]/).map((choice) => choice.trim()).filter(Boolean)));
}

function validateItems(templateType: TemplateType, items: HomeworkItemDraft[]) {
  if (templateType === "STANDARD") return "";
  if (items.length === 0) return "请至少添加一道练习内容";
  if (templateType === "READ_ALOUD_PICTURE_BOOK" && items.some((item) => !item.referenceText.trim() || !item.imageUrl || !item.sampleAudioUrl)) {
    return "每一张绘本卡都需要英文原文、图片和对应的示范录音";
  }
  if (templateType === "SENTENCE_READ_ALOUD" && items.some((item) => !item.promptText.trim() || !item.sampleAudioUrl)) {
    return "每个句子都需要英文内容和示范录音";
  }
  if (templateType === "WORD_READ_ALOUD" && items.some((item) => !item.answerText.trim() || !item.imageUrl || !item.sampleAudioUrl)) {
    return "每个朗读单词都需要英文单词、图片和示范录音";
  }
  if (["WORD_IMAGE_MATCH", "WORD_SCRAMBLE", "WORD_FILL_BLANK"].includes(templateType)
    && items.some((item) => !item.answerText.trim() || !item.imageUrl)) {
    return "每道单词练习都需要英文答案和图片";
  }
  if (templateType === "WORD_FILL_BLANK" && items.some((item) => !item.promptText.includes("____"))) {
    return "每道句子填空都需要包含 ____ 作为空格";
  }
  if ((templateType === "WORD_IMAGE_MATCH" || templateType === "WORD_FILL_BLANK") && items.some((item) => {
    const choices = parseChoices(item.choicesText);
    const answer = item.answerText.trim().toLocaleLowerCase("en-US");
    return choices.length > 0 && !choices.some((choice) => choice.toLocaleLowerCase("en-US") === answer);
  })) {
    return "填写备选词时，需要包含该题的正确英文答案";
  }
  return "";
}

function buildPublishedItems(templateType: TemplateType, items: HomeworkItemDraft[]) {
  if (templateType === "STANDARD" || templateType === "READ_ALOUD_PICTURE_BOOK") return undefined;
  return items.map((item) => {
    const choices = parseChoices(item.choicesText);
    if (templateType === "SENTENCE_READ_ALOUD") {
      return { promptText: item.promptText.trim(), sampleAudioUrl: item.sampleAudioUrl };
    }
    if (templateType === "WORD_READ_ALOUD") {
      const word = item.answerText.trim();
      return { imageUrl: item.imageUrl, sampleAudioUrl: item.sampleAudioUrl, answerText: word };
    }
    if (templateType === "WORD_FILL_BLANK") {
      return {
        promptText: item.promptText.trim(),
        imageUrl: item.imageUrl,
        answerText: item.answerText.trim(),
        ...(choices.length ? { choices } : {}),
      };
    }
    return {
      imageUrl: item.imageUrl,
      answerText: item.answerText.trim(),
      ...(templateType === "WORD_IMAGE_MATCH" && choices.length ? { choices } : {}),
    };
  });
}

function assessmentMetric(label: string, score: number | null) {
  return score === null ? null : <span>{label} {Math.round(score)}</span>;
}

function AssessmentSummary({ assessment }: { assessment: SpeechAssessment | null }) {
  if (!assessment) return <span className="assessment-empty">无机器评测</span>;
  if (assessment.status === "QUEUED") return <span className="assessment-state assessment-pending">等待评测</span>;
  if (assessment.status === "PROCESSING") return <span className="assessment-state assessment-pending">评测中</span>;
  if (assessment.status === "FAILED") return <span className="assessment-state assessment-failed">暂不可用</span>;

  const metrics = [
    assessmentMetric("准", assessment.accuracyScore),
    assessmentMetric("流", assessment.fluencyScore),
    assessmentMetric("完", assessment.completenessScore),
    assessmentMetric("韵", assessment.prosodyScore),
  ].filter(Boolean);

  return <div className="assessment-summary">
    <strong>{assessment.overallScore === null ? "已完成" : `总分 ${Math.round(assessment.overallScore)}`}</strong>
    {metrics.length ? <div className="assessment-metrics">{metrics}</div> : null}
  </div>;
}

export default function HomeworkPage() {
  const router = useRouter();
  const [students, setStudents] = useState<Student[]>([]);
  const [homeworks, setHomeworks] = useState<Homework[]>([]);
  const [submissions, setSubmissions] = useState<RecordingSubmission[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [templateType, setTemplateType] = useState<TemplateType>("READ_ALOUD_PICTURE_BOOK");
  const [items, setItems] = useState<HomeworkItemDraft[]>([]);
  const [startsAt, setStartsAt] = useState(localDateTimeValue);
  const [unit, setUnit] = useState<"DAY" | "WEEK">("WEEK");
  const [interval, setInterval] = useState(1);
  const [occurrenceLimit, setOccurrenceLimit] = useState(4);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);
  const [reviewGradeById, setReviewGradeById] = useState<Record<string, Grade>>({});
  const [reviewAudioById, setReviewAudioById] = useState<Record<string, string>>({});
  const [uploadingReviewId, setUploadingReviewId] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<ReviewStatus>("DONE");
  const feedbackRecorderRef = useRef<MediaRecorder | null>(null);
  const feedbackStreamRef = useRef<MediaStream | null>(null);
  const [recordingReviewId, setRecordingReviewId] = useState<string | null>(null);

  const selectedCount = selectedIds.length;
  const totalOccurrences = selectedCount * occurrenceLimit;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleSubmissions = useMemo(
    () => submissions.filter((submission) => submission.status === reviewFilter),
    [reviewFilter, submissions],
  );

  const loadSubmissions = async () => {
    const [pictureSubmissionsResponse, practiceSubmissionsResponse] = await Promise.all([
      fetch("/api/admin/read-aloud-submissions"),
      fetch("/api/admin/practice-recording-submissions"),
    ]);
    if ([pictureSubmissionsResponse, practiceSubmissionsResponse].some((response) => response.status === 401 || response.status === 403)) {
      router.replace("/login");
      return;
    }
    const pictureSubmissionsBody = await pictureSubmissionsResponse.json();
    const practiceSubmissionsBody = await practiceSubmissionsResponse.json();
    if (!pictureSubmissionsResponse.ok) throw new Error(pictureSubmissionsBody.message ?? "无法加载绘本朗读提交");
    if (!practiceSubmissionsResponse.ok) throw new Error(practiceSubmissionsBody.message ?? "无法加载句子与单词朗读提交");
    setSubmissions([
      ...pictureSubmissionsBody.submissions.map((submission: Omit<RecordingSubmission, "source">) => ({
        ...submission,
        source: "picture-book" as const,
        templateType: "READ_ALOUD_PICTURE_BOOK" as const,
      })),
      ...practiceSubmissionsBody.submissions.map((submission: Omit<RecordingSubmission, "source">) => ({
        ...submission,
        source: "practice" as const,
      })),
    ]);
  };

  const loadData = async () => {
    const [studentsResponse, homeworksResponse] = await Promise.all([
      fetch("/api/admin/users?page=1&pageSize=100"),
      fetch("/api/admin/homeworks"),
    ]);
    if ([studentsResponse, homeworksResponse].some((response) => response.status === 401 || response.status === 403)) {
      router.replace("/login");
      return;
    }
    const studentsBody = await studentsResponse.json();
    const homeworksBody = await homeworksResponse.json();
    if (!studentsResponse.ok) throw new Error(studentsBody.message ?? "无法加载学生列表");
    if (!homeworksResponse.ok) throw new Error(homeworksBody.message ?? "无法加载作业列表");
    setStudents(studentsBody.users);
    setHomeworks(homeworksBody.homeworks);
    await loadSubmissions();
  };

  useEffect(() => {
    void loadData().catch((cause) => setError(cause instanceof Error ? cause.message : "网络连接失败"));
  }, []);

  const hasPendingAssessments = visibleSubmissions.some(({ assessment }) =>
    assessment?.status === "QUEUED" || assessment?.status === "PROCESSING");

  useEffect(() => {
    if (!hasPendingAssessments) return;
    let disposed = false;
    let pollTimer: number;
    const poll = () => {
      pollTimer = window.setTimeout(() => {
        void loadSubmissions().catch(() => undefined).finally(() => {
          if (!disposed) poll();
        });
      }, 4000);
    };
    poll();
    return () => {
      disposed = true;
      window.clearTimeout(pollTimer);
    };
  }, [hasPendingAssessments]);

  const toggleStudent = (studentId: string) => {
    setSelectedIds((current) => current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId]);
  };

  const toggleAll = () => {
    setSelectedIds(selectedIds.length === students.length ? [] : students.map((student) => student.id));
  };

  function selectTemplate(nextTemplate: TemplateType) {
    if (nextTemplate === templateType) return;
    setTemplateType(nextTemplate);
    setItems([]);
    setError("");
  }

  const updateItem = (itemId: string, patch: Partial<HomeworkItemDraft>) => {
    setItems((current) => current.map((item) => item.id === itemId ? { ...item, ...patch } : item));
  };

  const removeItem = (itemId: string) => setItems((current) => current.filter((item) => item.id !== itemId));

  function moveItem(itemId: string, direction: -1 | 1) {
    setItems((current) => {
      const index = current.findIndex((item) => item.id === itemId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
      const reordered = [...current];
      [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
      return reordered;
    });
  }

  async function uploadItemFile(itemId: string, file: File, field: "image" | "audio") {
    setError("");
    if (file.size > 20 * 1024 * 1024) {
      setError("单个文件不能超过 20 MB");
      return;
    }
    setUploadingItemId(itemId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/admin/uploads", { method: "POST", body: formData });
      if (response.status === 401 || response.status === 403) {
        router.replace("/login");
        return;
      }
      const body = await response.json();
      if (!response.ok || body.kind !== field) {
        throw new Error(field === "image" ? "请选择图片文件" : "请选择音频文件");
      }
      updateItem(itemId, field === "image"
        ? { imageUrl: body.url, imageName: file.name }
        : { sampleAudioUrl: body.url, audioName: file.name });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "上传失败，请稍后重试");
    } finally {
      setUploadingItemId(null);
    }
  }

  async function uploadReviewAudio(submissionId: string, file: File) {
    setError("");
    if (file.size > 20 * 1024 * 1024) {
      setError("单个文件不能超过 20 MB");
      return;
    }
    setUploadingReviewId(submissionId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/admin/uploads", { method: "POST", body: formData });
      if (response.status === 401 || response.status === 403) {
        router.replace("/login");
        return;
      }
      const body = await response.json();
      if (!response.ok || body.kind !== "audio") throw new Error("请选择音频文件");
      setReviewAudioById((current) => ({ ...current, [submissionId]: body.url }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "点评音频上传失败");
    } finally {
      setUploadingReviewId(null);
    }
  }

  async function startFeedbackRecording(submissionId: string) {
    if (recordingReviewId) return;
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      feedbackStreamRef.current = stream;
      feedbackRecorderRef.current = recorder;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        stream.getTracks().forEach((track) => track.stop());
        feedbackStreamRef.current = null;
        feedbackRecorderRef.current = null;
        setRecordingReviewId(null);
        const type = recorder.mimeType || "audio/webm";
        const recording = new File([new Blob(chunks, { type })], `teacher-feedback-${Date.now()}.webm`, { type });
        void uploadReviewAudio(submissionId, recording);
      });
      recorder.start();
      setRecordingReviewId(submissionId);
    } catch {
      setError("无法开始语音点评，请允许浏览器使用麦克风。");
    }
  }

  function stopFeedbackRecording() {
    feedbackRecorderRef.current?.stop();
  }

  useEffect(() => () => {
    feedbackRecorderRef.current?.stop();
    feedbackStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function reviewSubmission(submission: RecordingSubmission) {
    setError("");
    setReviewingId(submission.id);
    try {
      const reviewCollection = submission.source === "practice"
        ? "practice-recording-submissions"
        : "read-aloud-submissions";
      const response = await fetch(`/api/admin/${reviewCollection}/${submission.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grade: reviewGradeById[submission.id] ?? submission.grade ?? "A",
          feedbackAudioUrl: reviewAudioById[submission.id] || submission.feedbackAudioUrl || undefined,
        }),
      });
      if (response.status === 401 || response.status === 403) {
        router.replace("/login");
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "批改提交失败");
      setSubmissions((current) => current.map((item) => item.id === submission.id && item.source === submission.source
        ? { ...body.submission, source: submission.source }
        : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "批改提交失败");
    } finally {
      setReviewingId(null);
    }
  }

  const mediaUrl = (url: string) => `/api/admin/media/${url.replace(/^\/uploads\//, "")}`;

  async function publish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (selectedIds.length === 0) {
      setError("请至少选择一名学生");
      return;
    }
    const itemError = validateItems(templateType, items);
    if (itemError) {
      setError(itemError);
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/admin/homeworks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          instructions,
          templateType,
          cards: templateType === "READ_ALOUD_PICTURE_BOOK"
            ? items.map(({ imageUrl, sampleAudioUrl, referenceText }) => ({ imageUrl, sampleAudioUrl, referenceText: referenceText.trim() }))
            : undefined,
          items: buildPublishedItems(templateType, items),
          studentIds: selectedIds,
          schedule: {
            startsAt: new Date(startsAt).toISOString(),
            unit,
            interval,
            occurrenceLimit,
          },
        }),
      });
      if (response.status === 401 || response.status === 403) {
        router.replace("/login");
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "发布失败，请稍后再试");
      setNotice(`已发布给 ${body.homework.targetCount} 名学生，共生成 ${body.homework.occurrenceCount} 次练习。`);
      setTitle("");
      setInstructions("");
      setSelectedIds([]);
      setItems([]);
      setHomeworks((current) => [body.homework, ...current]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "网络连接失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const needsItems = templateType !== "STANDARD";

  return <div className="console">
    <aside className="sidebar">
      <div className="sidebar-brand">Hello Betty</div>
      <a className="nav-link" href="/dashboard"><LayoutDashboard size={17} />概览</a>
      <a className="nav-link" href="/dashboard#students"><Users size={17} />学生账号</a>
      <a className="nav-link active" href="/homeworks"><BookOpen size={17} />作业管理</a>
      <div className="sidebar-footer"><button className="logout" onClick={logout}><LogOut size={16} />退出登录</button></div>
    </aside>
    <main className="main">
      <header className="page-header"><div><p className="eyebrow">作业管理</p><h1>发布练习</h1></div><span className="header-user">发布后将按设定的周期触发</span></header>
      {error ? <p className="table-error page-message" role="alert">{error}</p> : null}
      {notice ? <p className="success-note" role="status">{notice}</p> : null}
      <form className="publish-layout" onSubmit={publish}>
        <section className="panel publish-panel">
          <div className="panel-header"><h2>作业内容</h2></div>
          <div className="form-body">
            <div className="field"><label htmlFor="homework-title">标题</label><input id="homework-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：Unit 1 朗读练习" minLength={2} maxLength={100} required /></div>
            <div className="field"><label htmlFor="homework-instructions">练习说明</label><textarea id="homework-instructions" value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="告诉学生需要完成什么" maxLength={2000} /></div>
            <div className="field">
              <label>作业模板</label>
              <div className="template-grid">
                {TEMPLATE_OPTIONS.map((option) => <button key={option.type} className={templateType === option.type ? "selected" : ""} type="button" onClick={() => selectTemplate(option.type)}><strong>{option.label}</strong><span>{option.description}</span></button>)}
              </div>
            </div>
            {needsItems ? <div className="item-builder">
              <div className="builder-heading"><span>{templateLabel(templateType)}内容</span><button className="text-button" type="button" onClick={() => setItems((current) => [...current, createDraft()])}>添加{templateType === "READ_ALOUD_PICTURE_BOOK" ? "一页" : "一题"}</button></div>
              {items.length === 0 ? <p className="builder-empty">按学生练习顺序添加内容，发布后顺序不可变。</p> : items.map((item, index) => <div className="item-draft" key={item.id}>
                <div className="item-draft-header">
                  <strong>{templateType === "READ_ALOUD_PICTURE_BOOK" ? `第 ${index + 1} 页` : `第 ${index + 1} 题`}</strong>
                  <div className="item-actions">
                    <button className="icon-text-button" type="button" title="上移" aria-label={`上移第 ${index + 1} 项`} disabled={index === 0} onClick={() => moveItem(item.id, -1)}><ArrowUp size={15} /></button>
                    <button className="icon-text-button" type="button" title="下移" aria-label={`下移第 ${index + 1} 项`} disabled={index === items.length - 1} onClick={() => moveItem(item.id, 1)}><ArrowDown size={15} /></button>
                    <button className="text-button danger-text-button" type="button" onClick={() => removeItem(item.id)}>删除</button>
                  </div>
                </div>
                {templateType === "READ_ALOUD_PICTURE_BOOK" ? <div className="field compact-field"><label htmlFor={`reference-${item.id}`}>英文原文</label><textarea id={`reference-${item.id}`} value={item.referenceText} onChange={(event) => updateItem(item.id, { referenceText: event.target.value })} placeholder="例如：This is my family." maxLength={500} required /></div> : null}
                {templateType === "SENTENCE_READ_ALOUD" || templateType === "WORD_FILL_BLANK" ? <div className="field compact-field"><label htmlFor={`prompt-${item.id}`}>{templateType === "SENTENCE_READ_ALOUD" ? "英文句子" : "填空句子"}</label><textarea id={`prompt-${item.id}`} value={item.promptText} onChange={(event) => updateItem(item.id, { promptText: event.target.value })} placeholder={templateType === "SENTENCE_READ_ALOUD" ? "例如：This is my family." : "例如：I have an ____."} maxLength={500} /></div> : null}
                {["WORD_READ_ALOUD", "WORD_IMAGE_MATCH", "WORD_SCRAMBLE", "WORD_FILL_BLANK"].includes(templateType) ? <div className="field compact-field"><label htmlFor={`answer-${item.id}`}>英文单词</label><input id={`answer-${item.id}`} value={item.answerText} onChange={(event) => updateItem(item.id, { answerText: event.target.value })} placeholder="例如：apple" maxLength={100} /></div> : null}
                {templateType === "WORD_IMAGE_MATCH" || templateType === "WORD_FILL_BLANK" ? <div className="field compact-field"><label htmlFor={`choices-${item.id}`}>备选词（可选）</label><textarea id={`choices-${item.id}`} value={item.choicesText} onChange={(event) => updateItem(item.id, { choicesText: event.target.value })} placeholder="逗号或换行分隔，例如：apple, orange, pear" maxLength={1000} /></div> : null}
                {templateType !== "SENTENCE_READ_ALOUD" ? <label className="upload-field">练习图片<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadItemFile(item.id, file, "image"); }} /><span>{item.imageName || "选择 JPG、PNG 或 WebP"}</span></label> : null}
                {RECORDING_TEMPLATES.has(templateType) ? <label className="upload-field">示范录音<input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/webm,audio/ogg" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadItemFile(item.id, file, "audio"); }} /><span>{item.audioName || "选择 MP3、WAV、M4A、WebM 或 OGG"}</span></label> : null}
                {uploadingItemId === item.id ? <small className="upload-progress">正在上传...</small> : null}
              </div>)}
            </div> : null}
            <div className="schedule-grid">
              <div className="field"><label htmlFor="starts-at">首次触发</label><input id="starts-at" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></div>
              <div className="field"><label htmlFor="unit">周期单位</label><select id="unit" value={unit} onChange={(event) => setUnit(event.target.value as "DAY" | "WEEK")}><option value="DAY">天</option><option value="WEEK">周</option></select></div>
              <div className="field"><label htmlFor="interval">每隔多少{unit === "DAY" ? "天" : "周"}</label><input id="interval" type="number" min={1} max={52} value={interval} onChange={(event) => setInterval(Number(event.target.value))} required /></div>
              <div className="field"><label htmlFor="limit">触发次数</label><input id="limit" type="number" min={1} max={365} value={occurrenceLimit} onChange={(event) => setOccurrenceLimit(Number(event.target.value))} required /></div>
            </div>
          </div>
        </section>
        <section className="panel publish-panel">
          <div className="panel-header"><h2>选择学生</h2><button className="text-button" type="button" onClick={toggleAll}>{selectedIds.length === students.length && students.length > 0 ? "取消全选" : "全选"}</button></div>
          <div className="recipient-summary"><CheckSquare size={17} />已选择 {selectedCount} 名学生，将生成 {totalOccurrences} 次练习</div>
          <div className="recipient-list">{students.length === 0 ? <p className="empty">暂无可选学生，请先完成学生注册。</p> : students.map((student) => <label className="recipient-row" key={student.id}><input type="checkbox" checked={selectedSet.has(student.id)} onChange={() => toggleStudent(student.id)} /><span><strong>{student.displayName}</strong><small>{student.phone}</small></span></label>)}</div>
        </section>
        <div className="publish-actions"><button className="primary-button publish-button" type="submit" disabled={isSubmitting || Boolean(uploadingItemId)}>{isSubmitting ? "正在发布..." : "发布作业"}</button></div>
      </form>
      <section className="panel homework-history" aria-labelledby="history-title">
        <div className="panel-header"><h2 id="history-title">已发布作业</h2><span className="header-user">最近 {homeworks.length} 条</span></div>
        <div className="table-wrap"><table><thead><tr><th>作业</th><th>模板</th><th>周期</th><th>学生</th><th>触发记录</th><th>首次触发</th></tr></thead><tbody>{homeworks.length === 0 ? <tr><td colSpan={6} className="empty">还没有发布作业</td></tr> : homeworks.map((homework) => <tr key={homework.id}><td>{homework.title}</td><td>{templateLabel(homework.templateType)}</td><td>每 {homework.repeatInterval} {homework.repeatUnit === "DAY" ? "天" : "周"}，共 {homework.occurrenceLimit} 次</td><td>{homework.targetCount} 名</td><td>{homework.occurrenceCount} 次</td><td>{new Date(homework.startsAt).toLocaleString("zh-CN")}</td></tr>)}</tbody></table></div>
      </section>
      <section className="panel homework-history" aria-labelledby="review-title">
        <div className="panel-header"><h2 id="review-title">朗读提交</h2><div className="review-toolbar"><span className="header-user">待批改 {submissions.filter((submission) => submission.status === "DONE").length} · 已批改 {submissions.filter((submission) => submission.status === "GRADED").length}</span><button className={`table-icon-button ${reviewFilter === "DONE" ? "active-icon-button" : ""}`} type="button" title="查看待批改录音" aria-label="查看待批改录音" onClick={() => setReviewFilter("DONE")}><Clock3 size={17} /></button><button className={`table-icon-button ${reviewFilter === "GRADED" ? "active-icon-button" : ""}`} type="button" title="查看已批改录音" aria-label="查看已批改录音" onClick={() => setReviewFilter("GRADED")}><CheckCircle2 size={17} /></button></div></div>
        <div className="table-wrap"><table className="review-table"><thead><tr><th>学生 / 作业</th><th>练习内容</th><th>学生录音</th><th>机器评测（参考）</th><th>人工等级</th><th>点评语音</th><th>状态</th><th>批改</th></tr></thead><tbody>{visibleSubmissions.length === 0 ? <tr><td colSpan={8} className="empty">{reviewFilter === "DONE" ? "暂时没有待批改的朗读录音" : "暂时没有已批改的朗读录音"}</td></tr> : visibleSubmissions.map((submission) => <tr key={`${submission.source}-${submission.id}`}><td><strong>{submission.studentName}</strong><br /><span className="table-muted">{submission.homeworkTitle}</span></td><td><span className="review-template">{templateLabel(submission.templateType)}</span><br /><strong>{submission.referenceText || submission.promptText || submission.answerText || (submission.cardPosition ? `第 ${submission.cardPosition} 页` : `第 ${submission.itemPosition ?? 1} 题`)}</strong></td><td><audio className="audio-control" controls preload="none" src={mediaUrl(submission.audioUrl)} /></td><td><AssessmentSummary assessment={submission.assessment} /></td><td><select className="grade-select" aria-label={`为 ${submission.studentName} 选择人工等级`} value={reviewGradeById[submission.id] ?? submission.grade ?? "A"} onChange={(event) => setReviewGradeById((current) => ({ ...current, [submission.id]: event.target.value as Grade }))}><option>A</option><option>B</option><option>C</option><option>D</option></select><span className="human-grade-note">人工终评</span></td><td><div className="review-audio-actions">{recordingReviewId === submission.id ? <button className="table-icon-button recording-icon-button" type="button" title="停止并上传语音点评" aria-label="停止并上传语音点评" onClick={stopFeedbackRecording}><Square size={15} /></button> : <button className="table-icon-button" type="button" title="录制语音点评" aria-label="录制语音点评" disabled={Boolean(recordingReviewId) || uploadingReviewId === submission.id} onClick={() => void startFeedbackRecording(submission.id)}><Mic size={16} /></button>}<label className="review-audio-upload" title="上传语音点评"><FileAudio size={17} /><input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/webm,audio/ogg" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadReviewAudio(submission.id, file); }} /></label>{reviewAudioById[submission.id] || submission.feedbackAudioUrl ? <span className="table-muted">已附语音</span> : null}</div></td><td><span className={submission.status === "GRADED" ? "status graded-status" : "status"}>{submission.status === "GRADED" ? "已批改" : "已做"}</span></td><td><button className="table-icon-button" type="button" title="提交人工批改" aria-label="提交人工批改" disabled={reviewingId === submission.id || uploadingReviewId === submission.id || recordingReviewId === submission.id} onClick={() => void reviewSubmission(submission)}>{reviewingId === submission.id ? "..." : <Check size={18} />}</button></td></tr>)}</tbody></table></div>
      </section>
    </main>
  </div>;
}
