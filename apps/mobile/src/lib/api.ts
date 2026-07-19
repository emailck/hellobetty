import type { CurrentUser, Session } from "../types";
import { Platform } from "react-native";

const localApiBaseUrl =
  Platform.OS === "android" ? "http://127.0.0.1:4100" : "http://localhost:4100";

export const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL ?? localApiBaseUrl;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = (await response.json()) as T & { code?: string; message?: string };
  if (!response.ok) {
    throw new ApiError(
      body.message ?? "服务暂时不可用，请稍后再试",
      body.code ?? "REQUEST_FAILED",
    );
  }
  return body;
}

export function register(input: {
  phone: string;
  displayName: string;
  password: string;
}) {
  return request<Session>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function login(phone: string, password: string) {
  return request<Session>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone, password }),
  });
}

export function getCurrentUser(token: string) {
  return request<{ user: CurrentUser }>("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface SpeechAssessmentPhonemeResult {
  phoneme: string;
  accuracyScore: number | null;
}

export interface SpeechAssessmentWordResult {
  word: string;
  accuracyScore: number | null;
  errorType: string | null;
  phonemes: SpeechAssessmentPhonemeResult[];
}

export interface SpeechAssessment {
  id: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  provider: string | null;
  overallScore: number | null;
  accuracyScore: number | null;
  fluencyScore: number | null;
  completenessScore: number | null;
  prosodyScore: number | null;
  wordResults: SpeechAssessmentWordResult[] | null;
  completedAt: string | null;
}

export interface ReadingCard {
  id: string;
  position: number;
  imageUrl: string;
  sampleAudioUrl: string;
  referenceText: string | null;
  submittedAudioUrl: string | null;
  submittedAt: string | null;
  feedbackAudioUrl: string | null;
  grade: string | null;
  reviewedAt: string | null;
  assessment: SpeechAssessment | null;
  status: "UNMADE" | "DONE" | "GRADED";
}

export interface ReadingOccurrence {
  id: string;
  title: string;
  instructions: string | null;
  status: string;
  cards: ReadingCard[];
}

export interface TeacherReadingSubmission {
  id: string;
  studentName: string;
  homeworkTitle: string;
  cardPosition?: number;
  itemPosition?: number;
  promptText?: string | null;
  referenceText?: string | null;
  templateType?: HomeworkTemplateType;
  audioUrl: string;
  feedbackAudioUrl: string | null;
  grade: "A" | "B" | "C" | "D" | null;
  assessment: SpeechAssessment | null;
  status: "DONE" | "GRADED";
}

export interface TeacherPracticeRecordingSubmission {
  id: string;
  studentId: string;
  studentName: string;
  homeworkId: string;
  homeworkTitle: string;
  occurrenceId: string;
  itemId: string;
  itemPosition: number;
  promptText: string | null;
  answerText: string | null;
  templateType: "SENTENCE_READ_ALOUD" | "WORD_READ_ALOUD";
  audioUrl: string;
  feedbackAudioUrl: string | null;
  grade: "A" | "B" | "C" | "D" | null;
  submittedAt: string;
  reviewedAt: string | null;
  assessment: SpeechAssessment | null;
  status: "DONE" | "GRADED";
}

export const homeworkTemplateTypes = [
  "READ_ALOUD_PICTURE_BOOK",
  "SENTENCE_READ_ALOUD",
  "WORD_READ_ALOUD",
  "WORD_IMAGE_MATCH",
  "WORD_SCRAMBLE",
  "WORD_FILL_BLANK",
] as const;

export type HomeworkTemplateType = (typeof homeworkTemplateTypes)[number];

export interface PracticeHomeworkSummary {
  id: string;
  title: string;
  instructions: string | null;
  templateType: Exclude<HomeworkTemplateType, "READ_ALOUD_PICTURE_BOOK">;
  status: string;
  scheduledAt: string;
  itemCount: number;
  completedItemCount: number;
}

export interface PracticeItem {
  id: string;
  position: number;
  promptText: string | null;
  imageUrl: string | null;
  sampleAudioUrl: string | null;
  answerText: string | null;
  choices: string[];
  letters: string[] | null;
  locked: boolean;
  submittedAudioUrl: string | null;
  submittedAnswerText: string | null;
  submittedAt: string | null;
  isCorrect: boolean | null;
  attemptNumber: number | null;
  feedbackAudioUrl: string | null;
  grade: "A" | "B" | "C" | "D" | null;
  reviewedAt: string | null;
  assessment: SpeechAssessment | null;
  status: "UNMADE" | "DONE" | "GRADED" | "CORRECT" | "INCORRECT";
}

export interface PracticeOccurrence {
  id: string;
  title: string;
  instructions: string | null;
  templateType: Exclude<HomeworkTemplateType, "READ_ALOUD_PICTURE_BOOK">;
  status: string;
  scheduledAt: string;
  items: PracticeItem[];
}

export interface HomeworkPublishItem {
  promptText?: string;
  imageUrl?: string;
  sampleAudioUrl?: string;
  answerText?: string;
  choices?: string[];
}

export interface LearningStatsSummary {
  checkinDays: number;
  currentStreak: number;
  voiceSeconds: number;
  homeworkSeconds: number;
}

export interface LearningCheckin {
  checkinDate: string;
  firstActivityAt: string;
  voiceSeconds: number;
  homeworkSeconds: number;
}

export interface HomeworkSessionResult {
  id: string;
  occurrenceId: string;
  startedAt: string;
  completedAt: string | null;
  creditedSeconds: number;
}

export interface StaffStudent {
  id: string;
  displayName: string;
  phone: string;
}

export interface MobileUploadFile {
  uri: string;
  type: string;
  name: string;
}

export function getReadingHomeworks(token: string) {
  return request<{ occurrences: Array<{ id: string; title: string; cardCount: number; submittedCardCount: number }> }>("/api/student/reading-homeworks", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getPracticeHomeworks(token: string) {
  return request<{ occurrences: PracticeHomeworkSummary[] }>("/api/student/practice-homeworks", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getPracticeOccurrence(token: string, occurrenceId: string) {
  return request<{ occurrence: PracticeOccurrence }>(`/api/student/practice-homeworks/${occurrenceId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getReadingOccurrence(token: string, occurrenceId: string) {
  return request<{ occurrence: ReadingOccurrence }>(`/api/student/reading-homeworks/${occurrenceId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function submitReadingAudio(
  token: string,
  occurrenceId: string,
  cardId: string,
  audio: Blob | { uri: string; type: string; name: string },
  durationSeconds?: number,
) {
  const formData = new FormData();
  if (durationSeconds) formData.append("durationSeconds", String(durationSeconds));
  formData.append("audio", audio as Blob, "reading.m4a");
  const response = await fetch(`${apiBaseUrl}/api/student/reading-homeworks/${occurrenceId}/cards/${cardId}/submissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const body = (await response.json()) as { occurrence?: ReadingOccurrence; code?: string; message?: string };
  if (!response.ok || !body.occurrence) {
    throw new ApiError(body.message ?? "录音提交失败，请稍后重试", body.code ?? "REQUEST_FAILED");
  }
  return body.occurrence;
}

export async function submitPracticeRecording(
  token: string,
  occurrenceId: string,
  itemId: string,
  audio: Blob | MobileUploadFile,
  durationSeconds?: number,
) {
  const formData = new FormData();
  if (durationSeconds) formData.append("durationSeconds", String(durationSeconds));
  formData.append("audio", audio as Blob, "practice.m4a");
  const response = await fetch(`${apiBaseUrl}/api/student/practice-homeworks/${occurrenceId}/items/${itemId}/recordings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const body = (await response.json()) as { occurrence?: PracticeOccurrence; code?: string; message?: string };
  if (!response.ok || !body.occurrence) {
    throw new ApiError(body.message ?? "录音提交失败，请稍后重试", body.code ?? "REQUEST_FAILED");
  }
  return body.occurrence;
}

export function getStudentLearningStats(token: string) {
  return request<{ summary: LearningStatsSummary; checkins: LearningCheckin[] }>("/api/student/learning-stats", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function startHomeworkSession(token: string, occurrenceId: string) {
  return request<{ session: HomeworkSessionResult }>("/api/student/homework-sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ occurrenceId }),
  });
}

export function completeHomeworkSession(token: string, sessionId: string, keepalive = false) {
  return request<{ session: HomeworkSessionResult }>(`/api/student/homework-sessions/${sessionId}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
    keepalive,
  });
}

export function submitPracticeAnswer(token: string, occurrenceId: string, itemId: string, answerText: string) {
  return request<{ occurrence: PracticeOccurrence; isCorrect: boolean }>(
    `/api/student/practice-homeworks/${occurrenceId}/items/${itemId}/answers`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ answerText }),
    },
  );
}

async function uploadStaffAsset(
  token: string,
  file: Blob | MobileUploadFile,
) {
  const formData = new FormData();
  formData.append("file", file as Blob, "upload.bin");
  const response = await fetch(`${apiBaseUrl}/api/admin/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const body = (await response.json()) as { url?: string; kind?: string; code?: string; message?: string };
  if (!response.ok || !body.url) {
    throw new ApiError(body.message ?? "素材上传失败", body.code ?? "REQUEST_FAILED");
  }
  return { url: body.url, kind: body.kind };
}

export function getTeacherReadingSubmissions(token: string) {
  return request<{ submissions: TeacherReadingSubmission[] }>("/api/admin/read-aloud-submissions", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getTeacherPracticeRecordingSubmissions(token: string) {
  return request<{ submissions: TeacherPracticeRecordingSubmission[] }>("/api/admin/practice-recording-submissions", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function reviewReadingSubmission(
  token: string,
  submissionId: string,
  grade: "A" | "B" | "C" | "D",
  audio: Blob | { uri: string; type: string; name: string } | null,
) {
  const uploaded = audio ? await uploadStaffAsset(token, audio) : null;
  if (uploaded && uploaded.kind !== "audio") throw new ApiError("点评必须使用音频文件", "AUDIO_REQUIRED");
  const feedbackAudioUrl = uploaded?.url;
  return request<{ submission: TeacherReadingSubmission }>(`/api/admin/read-aloud-submissions/${submissionId}/review`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ grade, feedbackAudioUrl }),
  });
}

export async function reviewPracticeRecordingSubmission(
  token: string,
  submissionId: string,
  grade: "A" | "B" | "C" | "D",
  audio: Blob | MobileUploadFile | null,
) {
  const uploaded = audio ? await uploadStaffAsset(token, audio) : null;
  if (uploaded && uploaded.kind !== "audio") throw new ApiError("点评必须使用音频文件", "AUDIO_REQUIRED");
  return request<{ submission: TeacherPracticeRecordingSubmission }>(`/api/admin/practice-recording-submissions/${submissionId}/review`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ grade, feedbackAudioUrl: uploaded?.url }),
  });
}

export function getStaffStudents(token: string) {
  return request<{ users: StaffStudent[] }>("/api/admin/users?page=1&pageSize=100", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function uploadHomeworkAsset(token: string, file: Blob | MobileUploadFile) {
  return uploadStaffAsset(token, file);
}

export function publishPictureBookHomework(token: string, input: {
  title: string;
  instructions: string;
  studentIds: string[];
  schedule: { startsAt: string; unit: "DAY" | "WEEK"; interval: number; occurrenceLimit: number };
  cards: Array<{ imageUrl: string; sampleAudioUrl: string; referenceText: string }>;
}) {
  return request<{ homework: { targetCount: number; occurrenceCount: number } }>("/api/admin/homeworks", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...input, templateType: "READ_ALOUD_PICTURE_BOOK" }),
  });
}


export function publishHomeworkTemplate(token: string, input: {
  templateType: Exclude<HomeworkTemplateType, "READ_ALOUD_PICTURE_BOOK">;
  title: string;
  instructions: string;
  studentIds: string[];
  schedule: { startsAt: string; unit: "DAY" | "WEEK"; interval: number; occurrenceLimit: number };
  items: HomeworkPublishItem[];
}) {
  return request<{ homework: { targetCount: number; occurrenceCount: number } }>("/api/admin/homeworks", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}
