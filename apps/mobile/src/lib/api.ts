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

export interface ReadingHomeworkSummary {
  id: string;
  title: string;
  scheduledAt: string;
  cardCount: number;
  submittedCardCount: number;
  reviewedCardCount: number;
  hasViewed: boolean;
}

export interface PracticeHomeworkSummary {
  id: string;
  title: string;
  instructions: string | null;
  templateType: Exclude<HomeworkTemplateType, "READ_ALOUD_PICTURE_BOOK">;
  status: string;
  scheduledAt: string;
  itemCount: number;
  completedItemCount: number;
  reviewedItemCount: number;
  hasViewed: boolean;
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

export interface LearningRecentDay {
  checkinDate: string;
  voiceSeconds: number;
  homeworkSeconds: number;
}

export interface StudentPointBalance {
  total: number;
  level: number;
  currentLevelPoints: number;
  nextLevelPoints: number;
}

export interface StudentPointEvent {
  id: string;
  type: "DAILY_CHECKIN" | "HOMEWORK_COMPLETED" | "STREAK_BONUS" | string;
  sourceId: string;
  classroomName?: string | null;
  points: number;
  occurredAt: string;
}

export interface StudentProfileFields {
  studentId: string;
  englishName: string | null;
  schoolName: string | null;
  gradeLevel: string | null;
  learningGoal: string | null;
  updatedAt: string;
}

export interface StudentProfileResponse {
  user: CurrentUser;
  profile: StudentProfileFields;
  points: StudentPointBalance;
  events: StudentPointEvent[];
}

export interface StudentHomeworkHistoryItem {
  id: string;
  title: string;
  templateType: HomeworkTemplateType;
  scheduledAt: string;
  homeworkStatus: "PUBLISHED" | "PAUSED" | "ARCHIVED";
  occurrenceStatus: "SCHEDULED" | "AVAILABLE" | "COMPLETED";
  totalCount: number;
  completedCount: number;
  reviewedCount: number;
}

export interface StudentHomeworkHistoryResponse {
  occurrences: StudentHomeworkHistoryItem[];
  pagination: { page: number; pageSize: number; total: number };
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
  status?: string;
}

export interface StaffContext {
  user: CurrentUser;
  speechAssessment: {
    configured: boolean;
    provider: string | null;
  };
}

export interface StaffClassroomMember {
  id: string;
  displayName: string;
  phone: string;
  role: "TEACHER" | "STUDENT";
  status: string;
}

export interface StaffClassroom {
  id: string;
  name: string;
  status: string;
  teachers: StaffClassroomMember[];
  students: StaffClassroomMember[];
  teacherCount: number;
  studentCount: number;
}

export interface StaffHomeworkSummary {
  id: string;
  publisherId: string;
  publisherName: string;
  classroomId: string | null;
  classroomName: string | null;
  classroomStatus: string | null;
  title: string;
  instructions: string | null;
  status: "PUBLISHED" | "PAUSED" | "ARCHIVED";
  templateType: HomeworkTemplateType | "STANDARD";
  startsAt: string;
  repeatUnit: "DAY" | "WEEK";
  repeatInterval: number;
  occurrenceLimit: number;
  publishedAt: string;
  targetCount: number;
  occurrenceCount: number;
  completedOccurrenceCount: number;
}

export interface StaffHomeworkHistoryResponse {
  homeworks: StaffHomeworkSummary[];
  pagination: { page: number; pageSize: number; total: number };
}

export interface MobileUploadFile {
  uri: string;
  type: string;
  name: string;
}

export function getReadingHomeworks(token: string) {
  return request<{ occurrences: ReadingHomeworkSummary[] }>("/api/student/reading-homeworks", {
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
  return request<{ summary: LearningStatsSummary; checkins: LearningCheckin[]; recentDays?: LearningRecentDay[] }>("/api/student/learning-stats", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getStudentProfile(token: string) {
  return request<StudentProfileResponse>("/api/student/profile", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function updateStudentProfile(token: string, input: {
  displayName: string;
  englishName: string | null;
  schoolName: string | null;
  gradeLevel: string | null;
  learningGoal: string | null;
}) {
  return request<StudentProfileResponse>("/api/student/profile", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export function getStudentHomeworkHistory(token: string, page = 1, pageSize = 50) {
  return request<StudentHomeworkHistoryResponse>(`/api/student/homework-history?page=${page}&pageSize=${pageSize}`, {
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
  purpose?: "FEEDBACK",
) {
  const formData = new FormData();
  if (purpose) formData.append("purpose", purpose);
  formData.append("file", file as Blob, "upload.bin");
  const response = await fetch(`${apiBaseUrl}/api/admin/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const body = (await response.json()) as { url?: string; kind?: string; purpose?: string; code?: string; message?: string };
  if (!response.ok || !body.url) {
    throw new ApiError(body.message ?? "素材上传失败", body.code ?? "REQUEST_FAILED");
  }
  return { url: body.url, kind: body.kind, purpose: body.purpose };
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

export function getStaffContext(token: string) {
  return request<StaffContext>("/api/admin/context", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getStaffClassrooms(token: string) {
  return request<{ classrooms: StaffClassroom[] }>("/api/admin/classrooms", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function createStaffClassroom(token: string, input: { name: string; teacherIds: string[]; studentIds: string[] }) {
  return request<{ classroom: StaffClassroom }>("/api/admin/classrooms", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export function updateStaffClassroom(
  token: string,
  classroomId: string,
  input: { name?: string; status?: "ACTIVE" | "ARCHIVED"; teacherIds?: string[]; studentIds?: string[] },
) {
  return request<{ classroom: StaffClassroom }>(`/api/admin/classrooms/${classroomId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export function getStaffHomeworkHistory(token: string, page = 1, pageSize = 20) {
  return request<StaffHomeworkHistoryResponse>(`/api/admin/homeworks?page=${page}&pageSize=${pageSize}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function updateStaffHomeworkStatus(
  token: string,
  homeworkId: string,
  status: "PUBLISHED" | "PAUSED" | "ARCHIVED",
) {
  return request<{ homework: StaffHomeworkSummary }>(`/api/admin/homeworks/${homeworkId}/status`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status }),
  });
}

export async function reviewReadingSubmission(
  token: string,
  submissionId: string,
  grade: "A" | "B" | "C" | "D",
  audio: Blob | { uri: string; type: string; name: string } | null,
) {
  const uploaded = audio ? await uploadStaffAsset(token, audio, "FEEDBACK") : null;
  if (uploaded && (uploaded.kind !== "audio" || uploaded.purpose !== "FEEDBACK")) throw new ApiError("点评必须通过私有音频通道上传", "AUDIO_REQUIRED");
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
  const uploaded = audio ? await uploadStaffAsset(token, audio, "FEEDBACK") : null;
  if (uploaded && (uploaded.kind !== "audio" || uploaded.purpose !== "FEEDBACK")) throw new ApiError("点评必须通过私有音频通道上传", "AUDIO_REQUIRED");
  return request<{ submission: TeacherPracticeRecordingSubmission }>(`/api/admin/practice-recording-submissions/${submissionId}/review`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ grade, feedbackAudioUrl: uploaded?.url }),
  });
}

async function getStaffUsersByRole(token: string, role: "TEACHER" | "STUDENT") {
  const pageSize = 100;
  let page = 1;
  let users: StaffStudent[] = [];
  let total: number | null = null;

  do {
    const body = await request<{ users: StaffStudent[]; pagination?: { total: number } }>(`/api/admin/users?page=${page}&pageSize=${pageSize}&role=${role}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    users = [...users, ...body.users];
    total = body.pagination?.total ?? users.length;
    page += 1;
  } while (users.length < total);

  return { users };
}

export function getStaffStudents(token: string) {
  return getStaffUsersByRole(token, "STUDENT");
}

export function getStaffTeachers(token: string) {
  return getStaffUsersByRole(token, "TEACHER");
}

export async function uploadHomeworkAsset(token: string, file: Blob | MobileUploadFile) {
  return uploadStaffAsset(token, file);
}

export function publishPictureBookHomework(token: string, input: {
  classroomId: string | null;
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
  classroomId: string | null;
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
