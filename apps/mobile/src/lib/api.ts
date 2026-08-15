import type { CurrentUser, Session } from "../types";
import { fetch as expoFetch } from "expo/fetch";
import { File } from "expo-file-system";
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
  grade: string | null;
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
  grade: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  assessment: SpeechAssessment | null;
  status: "DONE" | "GRADED";
}

export type StaffReviewGrade = "SSS" | "SS" | "S" | "A" | "B";

export interface StaffHomeworkSubmissionConversation {
  occurrenceId: string;
  occurrenceStatus: string;
  scheduledAt: string;
  studentId: string;
  studentName: string;
  homeworkId: string;
  homeworkTitle: string;
  instructions: string | null;
  templateType: HomeworkTemplateType;
  homeworkStatus: string;
  classroomId: string | null;
  classroomName: string | null;
  latestSubmittedAt: string;
  submittedCount: number;
  reviewedCount: number;
  totalCount: number;
  reviewStatus: "IN_PROGRESS" | "PENDING_REVIEW" | "REVIEWED";
}

export type StaffHomeworkReviewMode = "PENDING" | "ALL";

export interface StaffHomeworkSubmissionGroup {
  homeworkId: string;
  title: string;
  classroomId: string | null;
  classroomName: string | null;
  templateType: HomeworkTemplateType | "STANDARD";
  status: "PUBLISHED" | "PAUSED" | "ARCHIVED" | string;
  publishedAt: string;
  assignedStudentCount: number;
  submittedOccurrenceCount: number;
  pendingReviewCount: number;
  reviewedOccurrenceCount: number;
  submittedQuestionCount: number;
  reviewedQuestionCount: number;
  latestSubmittedAt: string | null;
}

export interface StaffHomeworkSubmissionGroupListResponse {
  groups: StaffHomeworkSubmissionGroup[];
  pagination: { page: number; pageSize: number; total: number };
}

export interface StaffHomeworkSubmissionQuestion {
  sourceKind: "CARD" | "ITEM";
  questionId: string;
  submissionId: string | null;
  position: number;
  promptText: string | null;
  referenceText: string | null;
  imageUrl: string | null;
  sampleAudioUrl: string | null;
  answerText: string | null;
  choices: string[] | null;
  submissionType: "RECORDING" | "ANSWER" | null;
  audioUrl: string | null;
  submittedAnswerText: string | null;
  isCorrect: boolean | null;
  attemptNumber: number | null;
  submittedAt: string | null;
  feedbackAudioUrl: string | null;
  grade: string | null;
  reviewedAt: string | null;
  assessment: SpeechAssessment | null;
  reviewStatus: "UNSUBMITTED" | "PENDING_REVIEW" | "REVIEWED";
}

export interface StaffHomeworkSubmissionDetail extends StaffHomeworkSubmissionConversation {
  questions: StaffHomeworkSubmissionQuestion[];
}

export interface StaffHomeworkSubmissionListResponse {
  conversations: StaffHomeworkSubmissionConversation[];
  filters: {
    students: Array<{ id: string; displayName: string }>;
    homeworks: Array<{ id: string; title: string }>;
  };
  pagination: { page: number; pageSize: number; total: number };
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
  grade: string | null;
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

export interface HomeworkPublishSchedule {
  startsAt: string;
  unit: "DAY" | "WEEK";
  interval: number;
  occurrenceLimit: number;
}

export interface HomeworkPublishCard {
  imageUrl: string;
  sampleAudioUrl: string;
  referenceText: string;
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
  templateId: string | null;
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

export interface StaffPublishedHomeworkQuestion {
  sourceKind: "CARD" | "ITEM";
  id: string;
  position: number;
  promptText: string | null;
  referenceText: string | null;
  imageUrl: string | null;
  sampleAudioUrl: string | null;
  answerText: string | null;
  choices: string[] | null;
}

export interface StaffPublishedHomeworkDetailResponse {
  homework: StaffHomeworkSummary;
  recipients: Array<{ id: string; displayName: string; phone: string }>;
  questions: StaffPublishedHomeworkQuestion[];
}

export interface StaffHomeworkTemplateSummary {
  id: string;
  creatorId: string;
  creatorName: string;
  title: string;
  instructions: string | null;
  templateType: HomeworkTemplateType | "STANDARD";
  questionCount: number;
  createdAt: string;
  updatedAt: string;
  lastPublishedAt: string | null;
  publishedHomeworkCount: number;
}

export interface StaffHomeworkTemplateListResponse {
  templates: StaffHomeworkTemplateSummary[];
  pagination: { page: number; pageSize: number; total: number };
}

export interface StaffHomeworkTemplateDetailResponse {
  template: StaffHomeworkTemplateSummary;
  questions: StaffPublishedHomeworkQuestion[];
}

export type StaffHomeworkTemplateCreateInput =
  | {
      templateType: "READ_ALOUD_PICTURE_BOOK";
      title: string;
      instructions: string;
      cards: HomeworkPublishCard[];
    }
  | {
      templateType: Exclude<HomeworkTemplateType, "READ_ALOUD_PICTURE_BOOK">;
      title: string;
      instructions: string;
      items: HomeworkPublishItem[];
    };

export type StaffHomeworkCycleStudentStatus = "CHECKED_IN" | "IN_PROGRESS" | "NOT_STARTED";

export interface StaffHomeworkLatestCycleResponse {
  homework: StaffHomeworkSummary;
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
      occurrenceStatus: string;
      status: StaffHomeworkCycleStudentStatus;
      submittedCount: number;
      totalCount: number;
      lastSubmittedAt: string | null;
    }>;
  };
}

export interface MobileUploadFile {
  uri: string;
  type: string;
  name: string;
}

function isMobileUploadFile(file: Blob | MobileUploadFile): file is MobileUploadFile {
  return "uri" in file && typeof file.uri === "string";
}

async function appendUploadFile(
  formData: FormData,
  fieldName: string,
  file: Blob | MobileUploadFile,
  fallbackName: string,
) {
  if (!isMobileUploadFile(file)) {
    formData.append(fieldName, file, fallbackName);
    return;
  }

  if (Platform.OS === "web") {
    const response = await fetch(file.uri);
    const blob = await response.blob();
    formData.append(fieldName, blob, file.name);
    return;
  }

  formData.append(fieldName, new File(file.uri), file.name);
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
  await appendUploadFile(formData, "audio", audio, "reading.m4a");
  const response = await expoFetch(`${apiBaseUrl}/api/student/reading-homeworks/${occurrenceId}/cards/${cardId}/submissions`, {
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
  await appendUploadFile(formData, "audio", audio, "practice.m4a");
  const response = await expoFetch(`${apiBaseUrl}/api/student/practice-homeworks/${occurrenceId}/items/${itemId}/recordings`, {
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
  await appendUploadFile(formData, "file", file, "upload.bin");
  const response = await expoFetch(`${apiBaseUrl}/api/admin/uploads`, {
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

export function getStaffHomeworkSubmissionGroups(
  token: string,
  filters: {
    page?: number;
    pageSize?: number;
    reviewMode?: StaffHomeworkReviewMode;
    studentSearch?: string;
  } = {},
) {
  const search = new URLSearchParams();
  search.set("page", String(filters.page ?? 1));
  search.set("pageSize", String(filters.pageSize ?? 50));
  search.set("reviewMode", filters.reviewMode ?? "PENDING");
  if (filters.studentSearch) search.set("studentSearch", filters.studentSearch);
  return request<StaffHomeworkSubmissionGroupListResponse>(
    `/api/admin/homework-submission-groups?${search.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

export function getStaffHomeworkSubmissionConversations(
  token: string,
  filters: {
    studentId?: string;
    homeworkId?: string;
    submittedFrom?: string;
    submittedTo?: string;
    reviewMode?: StaffHomeworkReviewMode;
    studentSearch?: string;
    page?: number;
    pageSize?: number;
  } = {},
) {
  const search = new URLSearchParams();
  search.set("page", String(filters.page ?? 1));
  search.set("pageSize", String(filters.pageSize ?? 50));
  if (filters.studentId) search.set("studentId", filters.studentId);
  if (filters.homeworkId) search.set("homeworkId", filters.homeworkId);
  if (filters.submittedFrom) search.set("submittedFrom", filters.submittedFrom);
  if (filters.submittedTo) search.set("submittedTo", filters.submittedTo);
  if (filters.reviewMode) search.set("reviewMode", filters.reviewMode);
  if (filters.studentSearch) search.set("studentSearch", filters.studentSearch);
  return request<StaffHomeworkSubmissionListResponse>(`/api/admin/homework-submissions?${search.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getStaffHomeworkSubmissionDetail(token: string, occurrenceId: string) {
  return request<{ conversation: StaffHomeworkSubmissionDetail }>(
    `/api/admin/homework-submissions/${encodeURIComponent(occurrenceId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

export async function reviewStaffHomeworkSubmission(
  token: string,
  input: {
    occurrenceId: string;
    sourceKind: "CARD" | "ITEM";
    submissionId: string;
    grade: StaffReviewGrade;
    audio: Blob | MobileUploadFile | null;
  },
) {
  const uploaded = input.audio ? await uploadStaffAsset(token, input.audio, "FEEDBACK") : null;
  if (uploaded && (uploaded.kind !== "audio" || uploaded.purpose !== "FEEDBACK")) {
    throw new ApiError("点评必须通过私有音频通道上传", "AUDIO_REQUIRED");
  }
  const path = [input.occurrenceId, input.sourceKind, input.submissionId]
    .map(encodeURIComponent)
    .join("/");
  return request<{ conversation: StaffHomeworkSubmissionDetail }>(
    `/api/admin/homework-submissions/${path}/review`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ grade: input.grade, feedbackAudioUrl: uploaded?.url }),
    },
  );
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

export function getStaffClassroomStudentCandidates(token: string) {
  return request<{ students: StaffStudent[] }>("/api/admin/classroom-student-candidates", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function createStaffClassroom(token: string, input: { name: string; teacherIds?: string[]; studentIds: string[] }) {
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

export function getStaffHomeworkHistory(
  token: string,
  page = 1,
  pageSize = 20,
  filters: { search?: string; status?: string; classroomId?: string } = {},
) {
  const search = new URLSearchParams();
  search.set("page", String(page));
  search.set("pageSize", String(pageSize));
  if (filters.search) search.set("search", filters.search);
  if (filters.status) search.set("status", filters.status);
  if (filters.classroomId) search.set("classroomId", filters.classroomId);
  return request<StaffHomeworkHistoryResponse>(`/api/admin/homeworks?${search.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getStaffHomeworkTemplates(
  token: string,
  page = 1,
  pageSize = 50,
  filters: { search?: string; templateType?: HomeworkTemplateType | "STANDARD" } = {},
) {
  const search = new URLSearchParams();
  search.set("page", String(page));
  search.set("pageSize", String(pageSize));
  if (filters.search) search.set("search", filters.search);
  if (filters.templateType) search.set("templateType", filters.templateType);
  return request<StaffHomeworkTemplateListResponse>(
    `/api/admin/homework-templates?${search.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

export function getStaffHomeworkTemplateDetail(token: string, templateId: string) {
  return request<StaffHomeworkTemplateDetailResponse>(
    `/api/admin/homework-templates/${encodeURIComponent(templateId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

export function createStaffHomeworkTemplate(token: string, input: StaffHomeworkTemplateCreateInput) {
  return request<StaffHomeworkTemplateDetailResponse>("/api/admin/homework-templates", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export function deleteStaffHomeworkTemplate(token: string, templateId: string) {
  return request<{ ok: boolean }>(
    `/api/admin/homework-templates/${encodeURIComponent(templateId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export function getStaffPublishedHomeworkDetail(token: string, homeworkId: string) {
  return request<StaffPublishedHomeworkDetailResponse>(
    `/api/admin/homeworks/${encodeURIComponent(homeworkId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

export function getStaffHomeworkLatestCycle(token: string, homeworkId: string) {
  return request<StaffHomeworkLatestCycleResponse>(
    `/api/admin/homeworks/${encodeURIComponent(homeworkId)}/latest-cycle`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
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
  grade: StaffReviewGrade,
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
  grade: StaffReviewGrade,
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
  templateId?: string;
  title: string;
  instructions: string;
  studentIds: string[];
  schedule: HomeworkPublishSchedule;
  cards: HomeworkPublishCard[];
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
  templateId?: string;
  title: string;
  instructions: string;
  studentIds: string[];
  schedule: HomeworkPublishSchedule;
  items: HomeworkPublishItem[];
}) {
  return request<{ homework: { targetCount: number; occurrenceCount: number } }>("/api/admin/homeworks", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export function publishHomeworkFromTemplate(token: string, input: {
  classroomId: string | null;
  templateId: string;
  studentIds: string[];
  schedule: HomeworkPublishSchedule;
}) {
  return request<{ homework: { targetCount: number; occurrenceCount: number } }>("/api/admin/homeworks", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}
