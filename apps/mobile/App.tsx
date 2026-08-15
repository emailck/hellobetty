import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";
import { useAuth } from "./src/hooks/use-auth";
import {
  apiBaseUrl,
  ApiError,
  completeHomeworkSession,
  createStaffClassroom,
  createStaffHomeworkTemplate,
  deleteStaffHomeworkTemplate,
  getPracticeHomeworks,
  getPracticeOccurrence,
  getStaffHomeworkTemplateDetail,
  getStudentHomeworkHistory,
  getStudentLearningStats,
  getStudentProfile,
  getReadingHomeworks,
  getReadingOccurrence,
  getStaffClassrooms,
  getStaffClassroomStudentCandidates,
  getStaffContext,
  getStaffHomeworkHistory,
  getStaffHomeworkLatestCycle,
  getStaffHomeworkSubmissionGroups,
  getStaffHomeworkTemplates,
  getStaffPublishedHomeworkDetail,
  getStaffHomeworkSubmissionConversations,
  getStaffHomeworkSubmissionDetail,
  getStaffStudents,
  getStaffTeachers,
  homeworkTemplateTypes,
  publishHomeworkTemplate,
  publishHomeworkFromTemplate,
  publishPictureBookHomework,
  type HomeworkTemplateType,
  type HomeworkPublishCard,
  type HomeworkPublishItem,
  type PracticeHomeworkSummary,
  type PracticeItem,
  type PracticeOccurrence,
  type LearningCheckin,
  type LearningRecentDay,
  type LearningStatsSummary,
  type ReadingCard,
  type ReadingHomeworkSummary,
  type ReadingOccurrence,
  type SpeechAssessment,
  type StaffClassroom,
  type StaffContext,
  type StaffHomeworkLatestCycleResponse,
  type StaffHomeworkSummary,
  type StaffHomeworkSubmissionGroup,
  type StaffHomeworkTemplateDetailResponse,
  type StaffHomeworkTemplateSummary,
  type StaffPublishedHomeworkDetailResponse,
  type StaffPublishedHomeworkQuestion,
  type StaffHomeworkSubmissionConversation,
  type StaffHomeworkSubmissionDetail,
  type StaffHomeworkSubmissionQuestion,
  type StaffReviewGrade,
  type StaffStudent,
  type StudentHomeworkHistoryItem,
  type StudentPointEvent,
  type StudentProfileResponse,
  reviewStaffHomeworkSubmission,
  submitPracticeAnswer,
  submitPracticeRecording,
  submitReadingAudio,
  startHomeworkSession,
  updateStudentProfile,
  updateStaffClassroom,
  updateStaffHomeworkStatus,
  uploadHomeworkAsset,
} from "./src/lib/api";
import {
  clearHomeworkDraft,
  loadHomeworkDraft,
  persistHomeworkDraftAsset,
  removeHomeworkDraftAsset,
  saveHomeworkDraft,
  type HomeworkDraftItem,
} from "./src/lib/publish-draft";
import { colors, styles } from "./src/styles";
import type { CurrentUser } from "./src/types";

type AuthMode = "login" | "register";
type StudentView = "home" | "profile" | "reading" | "practice";
type ProfileTab = "PROFILE" | "LEARNING" | "HISTORY";
type HomeworkListStatus = "UNVIEWED" | "INCOMPLETE" | "COMPLETED" | "REVIEWED";
type HomeworkSortMode = "DATE" | "STATUS";
type StudentHomeworkListItem = {
  id: string;
  title: string;
  scheduledAt: string;
  kind: "READING" | "PRACTICE";
  status: HomeworkListStatus;
  summary: string;
  completedCount: number;
  totalCount: number;
  requiresReview: boolean;
};
type NextHomeworkDestination = {
  id: string;
  title: string;
  scheduledAt: string;
  kind: "READING" | "PRACTICE";
  templateType: HomeworkTemplateType;
  completedCount: number;
  totalCount: number;
};

const templateLabels: Record<HomeworkTemplateType, string> = {
  READ_ALOUD_PICTURE_BOOK: "绘本跟读",
  SENTENCE_READ_ALOUD: "句子跟读",
  WORD_READ_ALOUD: "单词跟读",
  WORD_IMAGE_MATCH: "看图选词",
  WORD_SCRAMBLE: "字母排序",
  WORD_FILL_BLANK: "看图填空",
};

const recordingTemplates: HomeworkTemplateType[] = ["SENTENCE_READ_ALOUD", "WORD_READ_ALOUD"];
const homeworkStatusMeta = {
  UNVIEWED: { label: "未查看", icon: "eye-off-outline" as const, color: colors.faint },
  INCOMPLETE: { label: "未完成", icon: "hourglass-outline" as const, color: "#a86412" },
  COMPLETED: { label: "已完成", icon: "checkmark-circle-outline" as const, color: "#28789e" },
  REVIEWED: { label: "老师已批改", icon: "ribbon-outline" as const, color: "#2e7d4f" },
};
const homeworkStatusOrder: Record<HomeworkListStatus, number> = {
  UNVIEWED: 0,
  INCOMPLETE: 1,
  COMPLETED: 2,
  REVIEWED: 3,
};
const assessmentPollIntervalMs = 4000;
const assessmentObservationWindowMs = 5 * 60 * 1000;
const webSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
};

type StaffRole = "TEACHER" | "ADMIN";

function isPendingAssessment(assessment: SpeechAssessment | null) {
  return assessment?.status === "QUEUED" || assessment?.status === "PROCESSING";
}

function AssessmentSummary({ assessment, compact = false, providerConfigured = true, showPendingStatus = true }: { assessment: SpeechAssessment | null; compact?: boolean; providerConfigured?: boolean; showPendingStatus?: boolean }) {
  if (!assessment || (!showPendingStatus && isPendingAssessment(assessment))) return null;

  let headline = "";
  if (!providerConfigured && isPendingAssessment(assessment)) headline = "语音评估提供方尚未配置";
  else if (assessment.status === "QUEUED") headline = "云端发音评分已排队";
  else if (assessment.status === "PROCESSING") headline = "云端正在分析发音";
  else if (assessment.status === "FAILED") headline = "云端评分暂未完成，可稍后查看或重新录音";
  else headline = assessment.overallScore === null ? "云端发音评分已完成" : `云端发音评分 · ${Math.round(assessment.overallScore)} 分`;

  const metrics = assessment.status === "COMPLETED" ? [
    ["准确", assessment.accuracyScore],
    ["流利", assessment.fluencyScore],
    ["完整", assessment.completenessScore],
    ["韵律", assessment.prosodyScore],
  ].filter((metric): metric is [string, number] => metric[1] !== null) : [];

  return <View style={compact ? styles.assessmentCompact : styles.assessmentSummary}>
    <Text style={styles.assessmentTitle}>{headline}</Text>
    {!compact && metrics.length ? <Text style={styles.assessmentMetrics}>{metrics.map(([label, score]) => `${label} ${Math.round(score)}`).join(" · ")}</Text> : null}
  </View>;
}

function pendingAssessmentObservationKeys(assessments: Array<SpeechAssessment | null>) {
  return assessments
    .filter((assessment): assessment is SpeechAssessment => isPendingAssessment(assessment))
    .map((assessment) => `${assessment.id}:${assessment.status}`);
}

function isActiveStatus(status: string) {
  return status.toUpperCase() === "ACTIVE";
}

function getHomeworkListStatus(input: { hasViewed: boolean; completedCount: number; totalCount: number; reviewedCount: number; requiresReview: boolean }): HomeworkListStatus {
  const complete = input.totalCount > 0 && input.completedCount >= input.totalCount;
  if (complete && input.requiresReview && input.reviewedCount >= input.totalCount) return "REVIEWED";
  if (complete) return "COMPLETED";
  if (!input.hasViewed && input.completedCount === 0) return "UNVIEWED";
  return "INCOMPLETE";
}

function HomeworkStatusIndicator({ status, completedCount, totalCount }: { status: HomeworkListStatus; completedCount: number; totalCount: number }) {
  const meta = homeworkStatusMeta[status];
  return <View accessible accessibilityLabel={`作业状态：${meta.label}，已完成 ${completedCount}/${totalCount}`} style={styles.homeworkStatusSummary}>
    <Text style={styles.homeworkStatusProgress}>{completedCount}/{totalCount}</Text>
    <View style={styles.homeworkStatus}>
      <Ionicons name={meta.icon} color={meta.color} size={16} />
      <Text style={[styles.homeworkStatusText, { color: meta.color }]}>{meta.label}</Text>
    </View>
  </View>;
}

function homeworkListAction(status: HomeworkListStatus, requiresReview: boolean) {
  if (status === "UNVIEWED") return "点击查看作业";
  if (status === "INCOMPLETE") return "继续练习";
  if (status === "REVIEWED") return "查看老师点评或重新练习";
  return requiresReview ? "已完成，等待老师批改" : "已完成，可继续巩固";
}

function homeworkDispatchDate(scheduledAt: string) {
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) return scheduledAt;
  const shanghaiDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${shanghaiDate.getUTCMonth() + 1}月${shanghaiDate.getUTCDate()}日`;
}

function buildStudentHomeworkList(
  readingHomeworks: ReadingHomeworkSummary[],
  practiceHomeworks: PracticeHomeworkSummary[],
  sortMode: HomeworkSortMode,
): StudentHomeworkListItem[] {
  const items: StudentHomeworkListItem[] = [
    ...readingHomeworks.map((homework) => ({
      id: homework.id,
      title: homework.title,
      scheduledAt: homework.scheduledAt,
      kind: "READING" as const,
      status: getHomeworkListStatus({ hasViewed: homework.hasViewed, completedCount: homework.submittedCardCount, totalCount: homework.cardCount, reviewedCount: homework.reviewedCardCount, requiresReview: true }),
      summary: "跟读绘本",
      completedCount: homework.submittedCardCount,
      totalCount: homework.cardCount,
      requiresReview: true,
    })),
    ...practiceHomeworks.map((homework) => {
      const requiresReview = true;
      return {
        id: homework.id,
        title: homework.title,
        scheduledAt: homework.scheduledAt,
        kind: "PRACTICE" as const,
        status: getHomeworkListStatus({ hasViewed: homework.hasViewed, completedCount: homework.completedItemCount, totalCount: homework.itemCount, reviewedCount: homework.reviewedItemCount, requiresReview }),
        summary: templateLabels[homework.templateType],
        completedCount: homework.completedItemCount,
        totalCount: homework.itemCount,
        requiresReview,
      };
    }),
  ];
  return items.sort((left, right) => {
    if (sortMode === "STATUS") {
      const statusDifference = homeworkStatusOrder[left.status] - homeworkStatusOrder[right.status];
      if (statusDifference !== 0) return statusDifference;
    }
    return right.scheduledAt.localeCompare(left.scheduledAt) || right.id.localeCompare(left.id);
  });
}

function isNextHomeworkComplete(homework: NextHomeworkDestination) {
  return homework.totalCount > 0 && homework.completedCount >= homework.totalCount;
}

async function findNextIncompleteHomework(token: string, currentOccurrenceId: string): Promise<NextHomeworkDestination | null> {
  const [reading, practice] = await Promise.all([getReadingHomeworks(token), getPracticeHomeworks(token)]);
  const all: NextHomeworkDestination[] = [
    ...reading.occurrences.map((homework) => ({
      id: homework.id,
      title: homework.title,
      scheduledAt: homework.scheduledAt,
      kind: "READING" as const,
      templateType: "READ_ALOUD_PICTURE_BOOK" as const,
      completedCount: homework.submittedCardCount,
      totalCount: homework.cardCount,
    })),
    ...practice.occurrences.map((homework) => ({
      id: homework.id,
      title: homework.title,
      scheduledAt: homework.scheduledAt,
      kind: "PRACTICE" as const,
      templateType: homework.templateType,
      completedCount: homework.completedItemCount,
      totalCount: homework.itemCount,
    })),
  ].sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt) || left.id.localeCompare(right.id));
  const currentIndex = all.findIndex((homework) => homework.id === currentOccurrenceId);
  if (currentIndex < 0) return null;
  return all.slice(currentIndex + 1).find((homework) => !isNextHomeworkComplete(homework)) ?? null;
}

function NextHomeworkCard({ homework, onOpen }: { homework: NextHomeworkDestination; onOpen: () => void }) {
  return <Pressable accessibilityLabel="打开下一个作业" style={({ pressed }) => [styles.nextHomeworkCard, pressed && styles.pressedState]} onPress={onOpen}>
    <View style={styles.nextHomeworkText}><Text style={styles.previewTitle}>下一个作业 · {homework.title}</Text><Text style={styles.previewText}>{templateLabels[homework.templateType]} · {homework.completedCount}/{homework.totalCount} 已完成</Text><Text style={styles.previewTag}>{homework.scheduledAt.slice(0, 10)}</Text></View>
    <Ionicons name="chevron-forward" color={colors.muted} size={20} />
  </Pressable>;
}

function useBoundedAssessmentRefresh(pendingKeys: string[], refresh: () => Promise<void>) {
  const refreshRef = useRef(refresh);
  const observedSinceRef = useRef(new Map<string, number>());
  const keysKey = Array.from(new Set(pendingKeys)).sort().join("|");

  useEffect(() => {
    refreshRef.current = refresh;
  });

  useEffect(() => {
    const keys = keysKey ? keysKey.split("|") : [];
    const now = Date.now();
    const observedSince = observedSinceRef.current;
    const activeKeys = new Set(keys);
    for (const key of Array.from(observedSince.keys())) {
      if (!activeKeys.has(key)) observedSince.delete(key);
    }
    for (const key of keys) {
      if (!observedSince.has(key)) observedSince.set(key, now);
    }
    if (keys.length === 0) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const current = Date.now();
      const stillObservable = keys.some((key) => current - (observedSince.get(key) ?? current) < assessmentObservationWindowMs);
      if (!stillObservable || disposed) return;
      timer = setTimeout(() => {
        void refreshRef.current()
          .catch(() => undefined)
          .finally(() => {
            if (!disposed) schedule();
          });
      }, assessmentPollIntervalMs);
    };
    schedule();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [keysKey]);
}

function useHomeworkSession(token: string, occurrenceId: string) {
  useEffect(() => {
    let desiredActive = AppState.currentState === "active";
    let sessionId: string | null = null;
    let keepalive = false;
    let reconciling = false;
    let queued = false;

    const reconcile = async () => {
      if (reconciling) {
        queued = true;
        return;
      }
      reconciling = true;
      do {
        queued = false;
        if (desiredActive && !sessionId) {
          try {
            const body = await startHomeworkSession(token, occurrenceId);
            sessionId = body.session.id;
          } catch {
            break;
          }
        } else if (!desiredActive && sessionId) {
          const completingId = sessionId;
          sessionId = null;
          await completeHomeworkSession(token, completingId, keepalive).catch(() => undefined);
        }
      } while (queued || (desiredActive ? !sessionId : Boolean(sessionId)));
      reconciling = false;
    };

    void reconcile();
    const subscription = AppState.addEventListener("change", (nextState) => {
      desiredActive = nextState === "active";
      keepalive = !desiredActive;
      void reconcile();
    });
    const beforeUnload = () => {
      desiredActive = false;
      keepalive = true;
      void reconcile();
    };
    const supportsBeforeUnload = Platform.OS === "web" && typeof window?.addEventListener === "function";
    if (supportsBeforeUnload) window.addEventListener("beforeunload", beforeUnload);

    return () => {
      desiredActive = false;
      keepalive = true;
      void reconcile();
      subscription.remove();
      if (supportsBeforeUnload) window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [occurrenceId, token]);
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secure = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secure?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={secure ? styles.passwordRow : undefined}>
        <TextInput
          style={[styles.input, secure && styles.passwordInput]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.faint}
          secureTextEntry={secure && !visible}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={label === "手机号" ? "phone-pad" : "default"}
          textContentType={secure ? "password" : undefined}
        />
        {secure ? (
          <Pressable style={styles.textAction} onPress={() => setVisible(!visible)}>
            <Text style={styles.textActionLabel}>{visible ? "隐藏" : "显示"}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function AuthScreen({
  onLogin,
  onRegister,
}: {
  onLogin: (phone: string, password: string) => Promise<void>;
  onRegister: (input: {
    phone: string;
    displayName: string;
    password: string;
  }) => Promise<void>;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [phone, setPhone] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    setError("");
    if (!phone.trim() || !password) {
      setError("请填写手机号和密码");
      return;
    }
    if (mode === "register" && displayName.trim().length < 2) {
      setError("请填写至少两个字符的姓名或昵称");
      return;
    }
    if (password.length < 8) {
      setError("密码至少需要 8 位");
      return;
    }
    setIsSubmitting(true);
    try {
      if (mode === "login") await onLogin(phone, password);
      else await onRegister({ phone, displayName, password });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "网络连接失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.select({ ios: "padding", default: undefined })}
    >
      <ScrollView contentContainerStyle={[styles.content, styles.authContent]} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>Hello Betty · 英语练习</Text>
        <Text style={styles.title}>{mode === "login" ? "欢迎回来" : "开始你的练习"}</Text>
        <Text style={styles.subtitle}>
          {mode === "login" ? "登录后继续完成今天的英语练习。" : "先创建学习账号，之后老师会为你安排练习。"}
        </Text>
        <View style={styles.modeSwitch}>
          {(["login", "register"] as const).map((item) => (
            <Pressable
              key={item}
              style={[styles.modeButton, mode === item && styles.modeButtonActive]}
              onPress={() => { setMode(item); setError(""); }}
            >
              <Text style={[styles.modeText, mode === item && styles.modeTextActive]}>
                {item === "login" ? "登录" : "注册"}
              </Text>
            </Pressable>
          ))}
        </View>
        {mode === "register" ? <Field label="姓名或昵称" value={displayName} onChangeText={setDisplayName} placeholder="例如：Betty" /> : null}
        <Field label="手机号" value={phone} onChangeText={setPhone} placeholder="请输入手机号" />
        <Field label="密码" value={password} onChangeText={setPassword} placeholder="至少 8 位" secure />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.note}>注册即表示已获得家长或监护人的同意。</Text>
        <Pressable style={[styles.primaryButton, isSubmitting && styles.primaryButtonDisabled]} disabled={isSubmitting} onPress={submit}>
          {isSubmitting ? <ActivityIndicator color={colors.text} /> : <Text style={styles.primaryButtonText}>{mode === "login" ? "登录并继续" : "创建账号"}</Text>}
        </Pressable>
        <Text style={styles.footer}>账号与练习进度仅用于支持你的英语学习。</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function StudentHome({
  displayName,
  token,
  onProfile,
  onOpenReading,
  onOpenPractice,
}: {
  displayName: string;
  token: string;
  onProfile: () => void;
  onOpenReading: (occurrenceId: string) => void;
  onOpenPractice: (occurrenceId: string) => void;
}) {
  const [homeworks, setHomeworks] = useState<ReadingHomeworkSummary[]>([]);
  const [practiceHomeworks, setPracticeHomeworks] = useState<PracticeHomeworkSummary[]>([]);
  const [sortMode, setSortMode] = useState<HomeworkSortMode>("DATE");
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void Promise.all([getReadingHomeworks(token), getPracticeHomeworks(token)])
      .then(([reading, practice]) => {
        setHomeworks(reading.occurrences);
        setPracticeHomeworks(practice.occurrences);
      })
      .catch((cause) => setMessage(cause instanceof ApiError ? cause.message : "无法加载作业列表"))
      .finally(() => setIsLoading(false));
  }, [token]);

  const homeworkItems = buildStudentHomeworkList(homeworks, practiceHomeworks, sortMode);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <Text style={styles.topBrand}>Hello Betty</Text>
        <Pressable accessibilityLabel="打开我的" style={styles.avatar} onPress={onProfile}>
          <Text style={styles.avatarText}>{displayName.slice(0, 1)}</Text>
        </Pressable>
      </View>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>嗨，{displayName}</Text>
        <Text style={styles.heroTitle}>今天，先从一句英语开始。</Text>
        <Text style={styles.heroText}>跟着绘本听一听、说一说，完成今天的英语练习。</Text>
      </View>
      <View style={styles.homeworkSectionHeader}>
        <Text style={[styles.sectionTitle, styles.homeworkSectionTitle]}>我的作业</Text>
        <View style={styles.homeworkSortControl}>
          {(["DATE", "STATUS"] as const).map((mode) => <Pressable
            key={mode}
            accessibilityLabel={mode === "DATE" ? "按日期排序" : "按状态排序"}
            accessibilityState={{ selected: sortMode === mode }}
            style={[styles.homeworkSortOption, sortMode === mode && styles.homeworkSortOptionActive]}
            onPress={() => setSortMode(mode)}
          >
            <Ionicons name={mode === "DATE" ? "calendar-outline" : "list-outline"} color={sortMode === mode ? colors.text : colors.muted} size={14} />
            <Text style={[styles.homeworkSortText, sortMode === mode && styles.homeworkSortTextActive]}>{mode === "DATE" ? "日期" : "状态"}</Text>
          </Pressable>)}
        </View>
      </View>
      <View>
        {isLoading ? <ActivityIndicator color={colors.text} /> : null}
        {!isLoading && homeworkItems.length === 0 ? <Text style={styles.emptyHomework}>最近 5 天没有作业。</Text> : null}
        {homeworkItems.map((homework) => <Pressable key={homework.id} style={({ pressed }) => [styles.previewRow, pressed && styles.pressedState]} onPress={() => homework.kind === "READING" ? onOpenReading(homework.id) : onOpenPractice(homework.id)}>
          <View style={styles.previewHeader}><Text style={[styles.previewTitle, styles.previewTitleInRow]}>{homework.title}</Text><HomeworkStatusIndicator status={homework.status} completedCount={homework.completedCount} totalCount={homework.totalCount} /></View>
          <Text style={styles.previewText}>{homework.summary}</Text>
          <View style={styles.homeworkFooter}><Text style={styles.homeworkAction}>{homeworkListAction(homework.status, homework.requiresReview)}</Text><Text style={styles.homeworkDispatchDate}>{homeworkDispatchDate(homework.scheduledAt)}</Text></View>
        </Pressable>)}
        {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
      </View>
    </ScrollView>
  );
}

function ReadingChat({ token, occurrenceId, onBack, onOpenReading, onOpenPractice }: { token: string; occurrenceId: string; onBack: () => void; onOpenReading: (occurrenceId: string) => void; onOpenPractice: (occurrenceId: string) => void }) {
  useHomeworkSession(token, occurrenceId);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const [occurrence, setOccurrence] = useState<ReadingOccurrence | null>(null);
  const [selectedCard, setSelectedCard] = useState<ReadingCard | null>(null);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordedDurationSeconds, setRecordedDurationSeconds] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [nextHomework, setNextHomework] = useState<NextHomeworkDestination | null>(null);

  const applyOccurrence = (next: ReadingOccurrence) => {
    setOccurrence(next);
    setSelectedCard((current) => current ? next.cards.find((card) => card.id === current.id) ?? null : null);
  };

  const load = async () => {
    try {
      const body = await getReadingOccurrence(token, occurrenceId);
      applyOccurrence(body.occurrence);
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "无法加载绘本作业");
    }
  };

  useEffect(() => { void load(); return () => playerRef.current?.remove(); }, [occurrenceId, token]);
  useEffect(() => {
    let active = true;
    setNextHomework(null);
    void findNextIncompleteHomework(token, occurrenceId)
      .then((homework) => {
        if (active) setNextHomework(homework);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [occurrenceId, token]);

  useBoundedAssessmentRefresh(pendingAssessmentObservationKeys(occurrence?.cards.map((card) => card.assessment) ?? []), async () => {
    const body = await getReadingOccurrence(token, occurrenceId);
    applyOccurrence(body.occurrence);
  });

  const playableUrl = (url: string) => `${apiBaseUrl}${url}`;
  const play = (url: string) => {
    playerRef.current?.remove();
    const player = createAudioPlayer({
      uri: playableUrl(url),
      headers: { Authorization: `Bearer ${token}` },
    });
    playerRef.current = player;
    player.play();
  };

  const startRecording = async () => {
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setMessage("请允许麦克风权限后再开始跟读。");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecordedUri(null);
      setRecordedDurationSeconds(null);
      setMessage("正在录音，请清晰地跟读。");
    } catch {
      setMessage("录音无法开始，请稍后重试。");
    }
  };

  const stopRecording = async () => {
    const durationSeconds = Math.max(1, Math.round(recorderState.durationMillis / 1000));
    await recorder.stop();
    setRecordedUri(recorder.uri ?? null);
    setRecordedDurationSeconds(recorder.uri ? durationSeconds : null);
    setMessage(recorder.uri ? "录音完成，可以试听或提交。" : "没有获得录音文件，请再试一次。");
  };

  const submit = async () => {
    if (!selectedCard || !recordedUri) {
      setMessage("请先录制自己的跟读。");
      return;
    }
    setIsSubmitting(true);
    try {
      let audio: Blob | { uri: string; type: string; name: string };
      if (Platform.OS === "web") {
        audio = await (await fetch(recordedUri)).blob();
      } else {
        audio = { uri: recordedUri, type: "audio/mp4", name: "reading.m4a" };
      }
      const next = await submitReadingAudio(token, occurrenceId, selectedCard.id, audio, recordedDurationSeconds ?? undefined);
      applyOccurrence(next);
      setRecordedUri(null);
      setRecordedDurationSeconds(null);
      const complete = next.cards.every((card) => card.submittedAudioUrl);
      let upcomingHomework = nextHomework;
      if (complete) {
        try {
          upcomingHomework = await findNextIncompleteHomework(token, occurrenceId);
          setNextHomework(upcomingHomework);
        } catch {
          // The recording is already submitted; keep the prefetched destination when refresh fails.
        }
      }
      setMessage(complete
        ? upcomingHomework ? "提交成功。可以继续下一个作业。" : "提交成功。这份作业已完成。"
        : "提交成功。可以继续下一个练习，完成的卡片也可以重新录音。");
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "提交失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!occurrence) return <SafeAreaView style={[styles.screen, styles.loadingScreen]}><ActivityIndicator color={colors.text} /></SafeAreaView>;
  const nextCard = occurrence.cards.find((card) => !card.submittedAudioUrl) ?? null;
  const visibleCards = occurrence.cards.filter((card) => card.submittedAudioUrl || card.id === nextCard?.id);
  const modalNextCard = selectedCard ? occurrence.cards.find((card) => card.position > selectedCard.position && !card.submittedAudioUrl) ?? null : null;
  const openNextHomework = () => {
    if (!nextHomework) return;
    if (nextHomework.kind === "READING") onOpenReading(nextHomework.id);
    else onOpenPractice(nextHomework.id);
  };

  return <View style={styles.screen}>
    <View style={styles.readingHeader}><Pressable accessibilityLabel="返回作业列表" style={styles.headerIconButton} onPress={onBack}><Ionicons name="chevron-back" color={colors.text} size={23} /></Pressable><Text style={styles.readingTitle}>{occurrence.title}</Text><View style={{ width: 32 }} /></View>
    <ScrollView contentContainerStyle={styles.chatContent}>
      {occurrence.instructions ? <View style={styles.chatTeacher}><Text style={styles.chatTeacherText}>{occurrence.instructions}</Text></View> : null}
        {visibleCards.map((card) => <View key={card.id} style={styles.chatMessage}><Text style={styles.chatLabel}>第 {card.position} 页 · {card.status === "UNMADE" ? "未作" : card.status === "DONE" ? "已做，等待老师批改" : `老师已批改 · ${card.grade} 级`}</Text><Pressable style={({ pressed }) => [styles.readingCard, pressed && styles.pressedState]} onPress={() => { setSelectedCard(card); setRecordedUri(null); setRecordedDurationSeconds(null); setMessage(""); }}><Image style={styles.cardThumbnail} resizeMode="contain" source={{ uri: playableUrl(card.imageUrl) }} /><Text style={styles.readingCardText}>{card.status === "UNMADE" ? "点击打开绘本卡片" : card.status === "DONE" ? "点击听自己的录音或重新录音" : "点击听点评、自己的录音或重新录音"}</Text><AssessmentSummary assessment={card.assessment} compact showPendingStatus={false} /></Pressable></View>)}
      {!nextCard ? <View style={styles.completedBanner}><Text style={styles.completedText}>这份绘本已完成。点击任意卡片可以重新录音。</Text></View> : null}
      {!nextCard && nextHomework ? <NextHomeworkCard homework={nextHomework} onOpen={openNextHomework} /> : null}
      {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
    </ScrollView>
    <Modal visible={selectedCard !== null} transparent animationType="fade" onRequestClose={() => setSelectedCard(null)}>
      <SafeAreaView style={styles.modalSafeArea}><View style={styles.modalBackdrop}><View style={styles.readingModal}>
        {selectedCard ? <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}><View style={styles.modalTopRow}><Text style={styles.modalPage}>第 {selectedCard.position} 页</Text><Pressable accessibilityLabel="关闭卡片" style={({ pressed }) => [styles.headerIconButton, pressed && styles.pressedState]} onPress={() => setSelectedCard(null)}><Ionicons name="close" color={colors.text} size={22} /></Pressable></View><Image style={styles.cardImage} resizeMode="contain" source={{ uri: playableUrl(selectedCard.imageUrl) }} />{selectedCard.referenceText ? <Text style={styles.practiceModalPrompt}>{selectedCard.referenceText}</Text> : null}<View style={[styles.statusPill, selectedCard.status === "GRADED" ? styles.statusGraded : selectedCard.status === "DONE" ? styles.statusDone : styles.statusUnmade]}><Text style={styles.statusPillText}>{selectedCard.status === "UNMADE" ? "未作" : selectedCard.status === "DONE" ? "已做，等待老师批改" : `老师已批改 · ${selectedCard.grade} 级`}</Text></View><AssessmentSummary assessment={selectedCard.assessment} showPendingStatus={false} /><View style={styles.modalControls}><Pressable accessibilityLabel="听老师示范录音" style={({ pressed }) => [styles.iconButton, pressed && styles.pressedState]} onPress={() => play(selectedCard.sampleAudioUrl)}><Ionicons name="headset-outline" color={colors.text} size={21} /></Pressable>{selectedCard.submittedAudioUrl ? <Pressable accessibilityLabel="听我的录音" style={({ pressed }) => [styles.iconButton, pressed && styles.pressedState]} onPress={() => play(selectedCard.submittedAudioUrl!)}><Ionicons name="volume-high-outline" color={colors.text} size={21} /></Pressable> : null}{selectedCard.feedbackAudioUrl ? <Pressable accessibilityLabel="听老师点评语音" style={({ pressed }) => [styles.iconButton, pressed && styles.pressedState]} onPress={() => play(selectedCard.feedbackAudioUrl!)}><Ionicons name="chatbubble-ellipses-outline" color={colors.text} size={21} /></Pressable> : null}{recorderState.isRecording ? <Pressable accessibilityLabel="停止录音" style={({ pressed }) => [styles.iconButtonRecord, pressed && styles.pressedState]} onPress={stopRecording}><Ionicons name="stop" color={colors.text} size={19} /></Pressable> : <Pressable accessibilityLabel={selectedCard.submittedAudioUrl ? "重新录音" : "开始录音"} style={({ pressed }) => [styles.iconButtonRecord, pressed && styles.pressedState]} onPress={startRecording}><Ionicons name="mic-outline" color={colors.text} size={23} /></Pressable>}{recordedUri ? <Pressable accessibilityLabel="提交跟读录音" style={({ pressed }) => [styles.iconButtonSubmit, isSubmitting && styles.primaryButtonDisabled, pressed && styles.pressedState]} disabled={isSubmitting} onPress={submit}>{isSubmitting ? <ActivityIndicator color={colors.text} /> : <Ionicons name="send" color={colors.text} size={20} />}</Pressable> : null}</View>{modalNextCard ? <Pressable accessibilityLabel="打开下一个练习" style={({ pressed }) => [styles.nextActionButton, pressed && styles.pressedState]} onPress={() => { setSelectedCard(modalNextCard); setRecordedUri(null); setRecordedDurationSeconds(null); setMessage(""); }}><Text style={styles.primaryButtonText}>下一个练习</Text></Pressable> : null}{!modalNextCard && nextHomework ? <Pressable accessibilityLabel="打开下一个作业" style={({ pressed }) => [styles.nextActionButton, pressed && styles.pressedState]} onPress={openNextHomework}><Text style={styles.primaryButtonText}>下一个作业</Text></Pressable> : null}{recorderState.isRecording ? <Text style={styles.recordingHint}>正在录音 {Math.ceil(recorderState.durationMillis / 1000)} 秒</Text> : null}{message ? <Text style={styles.readingMessage}>{message}</Text> : null}</ScrollView> : null}
      </View></View></SafeAreaView>
    </Modal>
  </View>;
}

function PracticeWorkspace({ token, occurrenceId, onBack, onOpenReading, onOpenPractice }: { token: string; occurrenceId: string; onBack: () => void; onOpenReading: (occurrenceId: string) => void; onOpenPractice: (occurrenceId: string) => void }) {
  useHomeworkSession(token, occurrenceId);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const [occurrence, setOccurrence] = useState<PracticeOccurrence | null>(null);
  const [selectedItem, setSelectedItem] = useState<PracticeItem | null>(null);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordedDurationSeconds, setRecordedDurationSeconds] = useState<number | null>(null);
  const [answer, setAnswer] = useState("");
  const [scramblePool, setScramblePool] = useState<Array<{ id: string; letter: string }>>([]);
  const [scrambleAnswer, setScrambleAnswer] = useState<Array<{ id: string; letter: string }>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [nextHomework, setNextHomework] = useState<NextHomeworkDestination | null>(null);

  const applyOccurrence = (next: PracticeOccurrence) => {
    setOccurrence(next);
    setSelectedItem((current) => current ? next.items.find((item) => item.id === current.id) ?? null : null);
  };

  useEffect(() => {
    void getPracticeOccurrence(token, occurrenceId)
      .then((body) => applyOccurrence(body.occurrence))
      .catch((cause) => setMessage(cause instanceof ApiError ? cause.message : "无法加载练习"));
    return () => playerRef.current?.remove();
  }, [occurrenceId, token]);
  useEffect(() => {
    let active = true;
    setNextHomework(null);
    void findNextIncompleteHomework(token, occurrenceId)
      .then((homework) => {
        if (active) setNextHomework(homework);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [occurrenceId, token]);

  useBoundedAssessmentRefresh(pendingAssessmentObservationKeys(occurrence?.items.map((item) => item.assessment) ?? []), async () => {
    const body = await getPracticeOccurrence(token, occurrenceId);
    applyOccurrence(body.occurrence);
  });

  useEffect(() => {
    if (occurrence?.templateType !== "WORD_SCRAMBLE") return;
    const item = occurrence.items.find((entry) => entry.isCorrect !== true && !entry.locked);
    if (item) resetScramble(item);
  }, [occurrence]);

  const play = (url: string) => {
    playerRef.current?.remove();
    const player = createAudioPlayer({
      uri: url.startsWith("http") ? url : `${apiBaseUrl}${url}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    playerRef.current = player;
    player.play();
  };

  const startRecording = async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) return setMessage("请允许麦克风权限后再开始跟读。");
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecordedUri(null);
      setRecordedDurationSeconds(null);
      setMessage("正在录音，请清晰地读出内容。");
    } catch {
      setMessage("录音无法开始，请稍后重试。");
    }
  };

  const stopRecording = async () => {
    const durationSeconds = Math.max(1, Math.round(recorderState.durationMillis / 1000));
    await recorder.stop();
    setRecordedUri(recorder.uri ?? null);
    setRecordedDurationSeconds(recorder.uri ? durationSeconds : null);
    setMessage(recorder.uri ? "录音完成，可以试听或提交。" : "没有获得录音文件，请再试一次。");
  };

  const submitRecording = async () => {
    if (!selectedItem || !recordedUri) return setMessage("请先录制自己的跟读。");
    setIsSubmitting(true);
    try {
      const audio = Platform.OS === "web"
        ? await (await fetch(recordedUri)).blob()
        : { uri: recordedUri, type: "audio/mp4", name: "practice.m4a" };
      const next = await submitPracticeRecording(token, occurrenceId, selectedItem.id, audio, recordedDurationSeconds ?? undefined);
      applyOccurrence(next);
      setRecordedUri(null);
      setRecordedDurationSeconds(null);
      const complete = next.items.every((item) => recordingTemplates.includes(next.templateType) ? Boolean(item.submittedAudioUrl) : item.isCorrect === true);
      let upcomingHomework = nextHomework;
      if (complete) {
        try {
          upcomingHomework = await findNextIncompleteHomework(token, occurrenceId);
          setNextHomework(upcomingHomework);
        } catch {
          // The recording is already submitted; keep the prefetched destination when refresh fails.
        }
      }
      setMessage(complete
        ? upcomingHomework ? "录音已提交。可以继续下一个作业。" : "录音已提交。这份作业已完成。"
        : "录音已提交。可以继续下一个练习。");
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "提交失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetScramble = (item: PracticeItem) => {
    const letters = (item.letters ?? []).map((letter, index) => ({ id: `${index}-${letter}`, letter }));
    setScramblePool(letters);
    setScrambleAnswer([]);
    setAnswer("");
  };

  const submitAnswer = async (item: PracticeItem, value = answer) => {
    if (!value.trim()) return setMessage("请先完成答案。");
    setIsSubmitting(true);
    try {
      const body = await submitPracticeAnswer(token, occurrenceId, item.id, value);
      applyOccurrence(body.occurrence);
      const correct = body.isCorrect;
      if (correct && body.occurrence.items.every((entry) => entry.isCorrect === true)) {
        void findNextIncompleteHomework(token, occurrenceId).then(setNextHomework).catch(() => undefined);
      }
      setMessage(correct ? "回答正确，继续下一题。" : "还差一点，再试一次。");
      setAnswer("");
      setScrambleAnswer([]);
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "答案提交失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!occurrence) return <SafeAreaView style={[styles.screen, styles.loadingScreen]}>{message ? <Text style={styles.readingMessage}>{message}</Text> : <ActivityIndicator color={colors.text} />}</SafeAreaView>;

  const isRecordingTemplate = recordingTemplates.includes(occurrence.templateType);
  const currentItem = occurrence.items.find((item) => isRecordingTemplate ? !item.submittedAudioUrl : item.isCorrect !== true) ?? null;
  const visibleItems = isRecordingTemplate
    ? occurrence.items.filter((item) => item.submittedAudioUrl || item.id === currentItem?.id)
    : currentItem ? [currentItem] : [];
  const modalNextItem = selectedItem ? occurrence.items.find((item) => item.position > selectedItem.position && !item.submittedAudioUrl && !item.locked) ?? null : null;
  const openNextHomework = () => {
    if (!nextHomework) return;
    if (nextHomework.kind === "READING") onOpenReading(nextHomework.id);
    else onOpenPractice(nextHomework.id);
  };

  return <View style={styles.screen}>
    <View style={styles.readingHeader}><Pressable accessibilityLabel="返回作业列表" style={styles.headerIconButton} onPress={onBack}><Ionicons name="chevron-back" color={colors.text} size={23} /></Pressable><View style={styles.practiceHeaderText}><Text style={styles.readingTitle}>{occurrence.title}</Text><Text style={styles.practiceTemplateLabel}>{templateLabels[occurrence.templateType]}</Text></View><View style={{ width: 32 }} /></View>
    <ScrollView contentContainerStyle={styles.chatContent}>
      {occurrence.instructions ? <View style={styles.chatTeacher}><Text style={styles.chatTeacherText}>{occurrence.instructions}</Text></View> : null}
      {visibleItems.map((item) => isRecordingTemplate ? <View key={item.id} style={styles.chatMessage}>
        <Text style={styles.chatLabel}>第 {item.position} 项 · {item.status === "UNMADE" ? "未作" : item.status === "DONE" ? "等待老师批改" : `老师已批改 · ${item.grade} 级`}</Text>
        <Pressable style={({ pressed }) => [styles.practiceCard, pressed && styles.pressedState]} onPress={() => { setSelectedItem(item); setRecordedUri(null); setRecordedDurationSeconds(null); setMessage(""); }}>
          {item.imageUrl ? <Image style={styles.practiceImage} resizeMode="contain" source={{ uri: item.imageUrl.startsWith("http") ? item.imageUrl : `${apiBaseUrl}${item.imageUrl}` }} /> : null}
          <Text style={styles.practicePrompt}>{item.promptText ?? item.answerText}</Text>
          <Text style={styles.previewTag}>{item.submittedAudioUrl ? "可试听或重新录音" : "点击开始跟读"}</Text>
          <AssessmentSummary assessment={item.assessment} compact showPendingStatus={false} />
        </Pressable>
      </View> : <View key={item.id} style={styles.objectiveCard}>
        <Text style={styles.chatLabel}>第 {item.position} / {occurrence.items.length} 题</Text>
        {item.imageUrl ? <Image style={styles.objectiveImage} resizeMode="contain" source={{ uri: item.imageUrl.startsWith("http") ? item.imageUrl : `${apiBaseUrl}${item.imageUrl}` }} /> : null}
        {occurrence.templateType === "WORD_FILL_BLANK" ? <Text style={styles.objectivePrompt}>{item.promptText}</Text> : <Text style={styles.objectivePrompt}>{occurrence.templateType === "WORD_SCRAMBLE" ? "按顺序拼出图片中的单词" : "选择图片对应的英文单词"}</Text>}
        {occurrence.templateType === "WORD_SCRAMBLE" ? <>
          <View style={styles.scrambleAnswer}>{scrambleAnswer.map((token) => <Pressable key={token.id} style={styles.letterTileActive} onPress={() => { setScrambleAnswer((current) => current.filter((entry) => entry.id !== token.id)); setScramblePool((current) => [...current, token]); }}><Text style={styles.letterTileText}>{token.letter}</Text></Pressable>)}</View>
          <View style={styles.scramblePool}>{scramblePool.length === 0 && scrambleAnswer.length === 0 ? <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressedState]} onPress={() => resetScramble(item)}><Text style={styles.secondaryButtonText}>开始拼词</Text></Pressable> : scramblePool.map((token) => <Pressable key={token.id} style={({ pressed }) => [styles.letterTile, pressed && styles.pressedState]} onPress={() => { setScramblePool((current) => current.filter((entry) => entry.id !== token.id)); setScrambleAnswer((current) => [...current, token]); }}><Text style={styles.letterTileText}>{token.letter}</Text></Pressable>)}</View>
          {scrambleAnswer.length ? <Pressable style={({ pressed }) => [styles.primaryButton, isSubmitting && styles.primaryButtonDisabled, pressed && styles.pressedState]} disabled={isSubmitting} onPress={() => void submitAnswer(item, scrambleAnswer.map((token) => token.letter).join(""))}><Text style={styles.primaryButtonText}>提交答案</Text></Pressable> : null}
        </> : <View style={styles.choiceList}>{item.choices.map((choice) => <Pressable key={choice} style={({ pressed }) => [styles.choiceButton, answer === choice && styles.choiceButtonActive, pressed && styles.pressedState]} onPress={() => setAnswer(choice)}><Text style={styles.choiceText}>{choice}</Text></Pressable>)}<Pressable style={({ pressed }) => [styles.primaryButton, (!answer || isSubmitting) && styles.primaryButtonDisabled, pressed && styles.pressedState]} disabled={!answer || isSubmitting} onPress={() => void submitAnswer(item)}><Text style={styles.primaryButtonText}>确认答案</Text></Pressable></View>}
      </View>)}
      {!currentItem ? <View style={styles.completedBanner}><Text style={styles.completedText}>这份练习已完成。跟读题仍可以打开已完成项目重新录音。</Text></View> : null}
      {!currentItem && nextHomework ? <NextHomeworkCard homework={nextHomework} onOpen={openNextHomework} /> : null}
      {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
    </ScrollView>
    <Modal visible={selectedItem !== null} transparent animationType="fade" onRequestClose={() => setSelectedItem(null)}><SafeAreaView style={styles.modalSafeArea}><View style={styles.modalBackdrop}><View style={styles.readingModal}>{selectedItem ? <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}><View style={styles.modalTopRow}><Text style={styles.modalPage}>第 {selectedItem.position} 项</Text><Pressable accessibilityLabel="关闭练习" style={({ pressed }) => [styles.headerIconButton, pressed && styles.pressedState]} onPress={() => setSelectedItem(null)}><Ionicons name="close" color={colors.text} size={22} /></Pressable></View>{selectedItem.imageUrl ? <Image style={styles.cardImage} resizeMode="contain" source={{ uri: selectedItem.imageUrl.startsWith("http") ? selectedItem.imageUrl : `${apiBaseUrl}${selectedItem.imageUrl}` }} /> : null}<Text style={styles.practiceModalPrompt}>{selectedItem.promptText ?? selectedItem.answerText}</Text><View style={[styles.statusPill, selectedItem.status === "GRADED" ? styles.statusGraded : selectedItem.status === "DONE" ? styles.statusDone : styles.statusUnmade]}><Text style={styles.statusPillText}>{selectedItem.status === "UNMADE" ? "未作" : selectedItem.status === "DONE" ? "等待老师批改" : `老师已批改 · ${selectedItem.grade} 级`}</Text></View><AssessmentSummary assessment={selectedItem.assessment} showPendingStatus={false} /><View style={styles.modalControls}>{selectedItem.sampleAudioUrl ? <Pressable accessibilityLabel="听示范录音" style={({ pressed }) => [styles.iconButton, pressed && styles.pressedState]} onPress={() => play(selectedItem.sampleAudioUrl!)}><Ionicons name="headset-outline" color={colors.text} size={21} /></Pressable> : null}{selectedItem.submittedAudioUrl ? <Pressable accessibilityLabel="听我的录音" style={({ pressed }) => [styles.iconButton, pressed && styles.pressedState]} onPress={() => play(selectedItem.submittedAudioUrl!)}><Ionicons name="volume-high-outline" color={colors.text} size={21} /></Pressable> : null}{selectedItem.feedbackAudioUrl ? <Pressable accessibilityLabel="听老师点评" style={({ pressed }) => [styles.iconButton, pressed && styles.pressedState]} onPress={() => play(selectedItem.feedbackAudioUrl!)}><Ionicons name="chatbubble-ellipses-outline" color={colors.text} size={21} /></Pressable> : null}{recorderState.isRecording ? <Pressable accessibilityLabel="停止录音" style={({ pressed }) => [styles.iconButtonRecord, pressed && styles.pressedState]} onPress={stopRecording}><Ionicons name="stop" color={colors.text} size={19} /></Pressable> : <Pressable accessibilityLabel={selectedItem.submittedAudioUrl ? "重新录音" : "开始录音"} style={({ pressed }) => [styles.iconButtonRecord, pressed && styles.pressedState]} onPress={startRecording}><Ionicons name="mic-outline" color={colors.text} size={23} /></Pressable>}{recordedUri ? <Pressable accessibilityLabel="提交录音" style={({ pressed }) => [styles.iconButtonSubmit, isSubmitting && styles.primaryButtonDisabled, pressed && styles.pressedState]} disabled={isSubmitting} onPress={submitRecording}>{isSubmitting ? <ActivityIndicator color={colors.text} /> : <Ionicons name="send" color={colors.text} size={20} />}</Pressable> : null}</View>{modalNextItem ? <Pressable accessibilityLabel="打开下一个练习" style={({ pressed }) => [styles.nextActionButton, pressed && styles.pressedState]} onPress={() => { setSelectedItem(modalNextItem); setRecordedUri(null); setRecordedDurationSeconds(null); setMessage(""); }}><Text style={styles.primaryButtonText}>下一个练习</Text></Pressable> : null}{!modalNextItem && nextHomework ? <Pressable accessibilityLabel="打开下一个作业" style={({ pressed }) => [styles.nextActionButton, pressed && styles.pressedState]} onPress={openNextHomework}><Text style={styles.primaryButtonText}>下一个作业</Text></Pressable> : null}{recorderState.isRecording ? <Text style={styles.recordingHint}>正在录音 {Math.ceil(recorderState.durationMillis / 1000)} 秒</Text> : recordedUri ? <Text style={styles.recordingHint}>录音完成，可以提交。</Text> : null}{message ? <Text style={styles.readingMessage}>{message}</Text> : null}</ScrollView> : null}</View></View></SafeAreaView></Modal>
  </View>;
}

const staffHomeworkStatusMeta = {
  PUBLISHED: { label: "进行中", icon: "radio-button-on-outline" as const },
  PAUSED: { label: "已暂停", icon: "pause-circle-outline" as const },
  ARCHIVED: { label: "已结束", icon: "stop-circle-outline" as const },
};

function staffTemplateLabel(templateType: StaffHomeworkSummary["templateType"]) {
  return templateType === "STANDARD" ? "标准作业" : templateLabels[templateType];
}

function staffAssetUrl(url: string | null) {
  if (!url) return "";
  return url.startsWith("http") ? url : `${apiBaseUrl}${url}`;
}

function staffDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const shanghai = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${shanghai.getUTCFullYear()}/${pad(shanghai.getUTCMonth() + 1)}/${pad(shanghai.getUTCDate())} ${pad(shanghai.getUTCHours())}:${pad(shanghai.getUTCMinutes())}`;
}

function shanghaiInputFromDate(date = new Date()) {
  const shanghai = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${shanghai.getUTCFullYear()}-${pad(shanghai.getUTCMonth() + 1)}-${pad(shanghai.getUTCDate())} ${pad(shanghai.getUTCHours())}:${pad(shanghai.getUTCMinutes())}`;
}

function parseShanghaiDateTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value.trim())) return null;
  const date = new Date(`${value.trim().replace(" ", "T")}:00+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const staffCycleStatusMeta = {
  CHECKED_IN: { label: "已打卡", icon: "checkmark-circle-outline" as const, color: "#2e7d4f" },
  IN_PROGRESS: { label: "进行中", icon: "time-outline" as const, color: "#775c16" },
  NOT_STARTED: { label: "未开始", icon: "remove-circle-outline" as const, color: colors.muted },
};

function StaffHomeworkQuestionPreview({
  question,
  onPlay,
}: {
  question: StaffPublishedHomeworkQuestion;
  onPlay: (url: string) => void;
}) {
  return <View style={styles.publishedPreviewQuestion}>
    <View style={styles.publishedQuestionHeader}>
      <Text style={styles.chatLabel}>第 {question.position} {question.sourceKind === "CARD" ? "页" : "题"}</Text>
      {question.sampleAudioUrl ? <Pressable accessibilityLabel={`试听第 ${question.position} 项示范录音`} style={({ pressed }) => [styles.smallOutlineIconButton, pressed && styles.pressedState]} onPress={() => onPlay(question.sampleAudioUrl!)}><Ionicons name="play-outline" color={colors.text} size={19} /></Pressable> : null}
    </View>
    {question.imageUrl ? <Image style={styles.publishedPreviewImage} resizeMode="contain" source={{ uri: staffAssetUrl(question.imageUrl) }} /> : null}
    {question.referenceText || question.promptText ? <Text style={styles.practicePrompt}>{question.referenceText ?? question.promptText}</Text> : null}
    {question.answerText ? <Text style={styles.publishedAnswer}>答案：{question.answerText}</Text> : null}
    {question.choices?.length ? <Text style={styles.previewText}>选项：{question.choices.join(" · ")}</Text> : null}
  </View>;
}

function TeacherPublishedHomeworkPreview({
  token,
  homework,
  onBack,
  onOpenCycle,
  onReuseTemplate,
  onLogout,
}: {
  token: string;
  homework: StaffHomeworkSummary;
  onBack: () => void;
  onOpenCycle: () => void;
  onReuseTemplate: (templateId: string) => void;
  onLogout: () => void;
}) {
  const [data, setData] = useState<StaffPublishedHomeworkDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);

  useEffect(() => {
    void getStaffPublishedHomeworkDetail(token, homework.id)
      .then((detail) => {
        setData(detail);
        setMessage("");
      })
      .catch((cause) => setMessage(cause instanceof ApiError ? cause.message : "无法加载作业预览"))
      .finally(() => setIsLoading(false));
  }, [homework.id, token]);

  useEffect(() => () => playerRef.current?.remove(), []);

  const play = (url: string) => {
    playerRef.current?.remove();
    const player = createAudioPlayer(staffAssetUrl(url));
    playerRef.current = player;
    player.play();
  };

  const detail = data?.homework;
  const status = detail
    ? staffHomeworkStatusMeta[detail.status as keyof typeof staffHomeworkStatusMeta]
    : null;
  const canReuse = Boolean(detail?.templateId && detail.templateType !== "STANDARD" && data?.questions.length);

  return <View style={styles.screen}>
    <View style={styles.readingHeader}>
      <Pressable accessibilityLabel="返回历史发布作业" style={styles.headerIconButton} onPress={onBack}><Ionicons name="chevron-back" color={colors.text} size={23} /></Pressable>
      <Text numberOfLines={1} style={styles.readingTitle}>作业预览</Text>
      <View style={styles.teacherHeaderActions}><Pressable accessibilityLabel="查看最近周期学生情况" style={styles.headerIconButton} onPress={onOpenCycle}><Ionicons name="list-outline" color={colors.text} size={21} /></Pressable><Pressable accessibilityLabel="退出登录" style={styles.headerIconButton} onPress={onLogout}><Ionicons name="log-out-outline" color={colors.text} size={21} /></Pressable></View>
    </View>
    <ScrollView contentContainerStyle={styles.publishedPreviewContent}>
      {isLoading ? <ActivityIndicator color={colors.text} /> : null}
      {detail ? <>
        <View style={styles.publishedPreviewHeading}>
          <View style={styles.previewTitleInRow}><Text style={styles.title}>{detail.title}</Text><Text style={styles.previewText}>{detail.classroomName ?? "未限定班级"} · {staffTemplateLabel(detail.templateType)}</Text></View>
          {status ? <View style={styles.staffStatusLabel}><Ionicons name={status.icon} color={colors.muted} size={16} /><Text style={styles.historyStatus}>{status.label}</Text></View> : null}
        </View>
        {detail.instructions ? <View style={styles.chatTeacher}><Text style={styles.chatTeacherText}>{detail.instructions}</Text></View> : null}
        <View style={styles.publishedPreviewMeta}>
          <Text style={styles.previewText}>每 {detail.repeatInterval} {detail.repeatUnit === "DAY" ? "天" : "周"} · 共 {detail.occurrenceLimit} 次</Text>
          <Text style={styles.previewText}>首次触发 {staffDateLabel(detail.startsAt)}</Text>
          <Text style={styles.previewText}>发布于 {staffDateLabel(detail.publishedAt)}</Text>
        </View>
        <View style={styles.previewActionRow}>
          <Pressable accessibilityLabel="查看最近周期学生情况" style={({ pressed }) => [styles.secondaryCommandButton, pressed && styles.pressedState]} onPress={onOpenCycle}><Text style={styles.secondaryButtonText}>最近周期</Text></Pressable>
          <Pressable accessibilityLabel="再次布置这个作业模板" disabled={!canReuse} style={({ pressed }) => [styles.primaryCommandButton, !canReuse && styles.primaryButtonDisabled, pressed && styles.pressedState]} onPress={() => canReuse && detail.templateId ? onReuseTemplate(detail.templateId) : setMessage("这个历史作业没有可复用的作业内容。")}><Ionicons name="send-outline" color={colors.text} size={19} /><Text style={styles.primaryButtonText}>再次布置</Text></Pressable>
        </View>
        <View style={styles.publishedRecipientSection}>
          <Text style={styles.sectionTitle}>学生 · {data.recipients.length} 人</Text>
          {data.recipients.map((student) => <View key={student.id} style={styles.publishedRecipientRow}><Text style={styles.previewTitle}>{student.displayName}</Text><Text style={styles.previewText}>{student.phone}</Text></View>)}
        </View>
        <View style={styles.publishedQuestionList}>
          <Text style={styles.sectionTitle}>作业内容 · {data.questions.length} 项</Text>
          {data.questions.map((question) => <StaffHomeworkQuestionPreview key={`${question.sourceKind}-${question.id}`} question={question} onPlay={play} />)}
        </View>
      </> : null}
      {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
    </ScrollView>
  </View>;
}

function TeacherTemplateAssignmentWorkspace({
  token,
  role,
  templateId,
  onBack,
  onLogout,
}: {
  token: string;
  role: StaffRole;
  templateId: string;
  onBack: () => void;
  onLogout: () => void;
}) {
  const [detail, setDetail] = useState<StaffHomeworkTemplateDetailResponse | null>(null);
  const [students, setStudents] = useState<StaffStudent[]>([]);
  const [classrooms, setClassrooms] = useState<StaffClassroom[]>([]);
  const [selectedClassroomId, setSelectedClassroomId] = useState<string | null>(null);
  const [publishMode, setPublishMode] = useState<"CLASSROOM" | "UNSCOPED">(role === "ADMIN" ? "UNSCOPED" : "CLASSROOM");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [unit, setUnit] = useState<"DAY" | "WEEK">("WEEK");
  const [interval, setInterval] = useState("1");
  const [occurrenceLimit, setOccurrenceLimit] = useState("4");
  const [startsAt, setStartsAt] = useState(shanghaiInputFromDate());
  const [isLoading, setIsLoading] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [message, setMessage] = useState("");
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);

  useEffect(() => {
    if (role !== "ADMIN") setPublishMode("CLASSROOM");
  }, [role]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setIsLoading(true);
      try {
        const [templateBody, classroomBody] = await Promise.all([
          getStaffHomeworkTemplateDetail(token, templateId),
          getStaffClassrooms(token),
        ]);
        if (!mounted) return;
        const activeClassrooms = classroomBody.classrooms.filter((classroom) => isActiveStatus(classroom.status));
        setDetail(templateBody);
        setClassrooms(activeClassrooms);
        if (role === "ADMIN") {
          const studentBody = await getStaffStudents(token);
          if (!mounted) return;
          setStudents(studentBody.users.filter((student) => !student.status || isActiveStatus(student.status)));
        } else if (activeClassrooms.length === 1) {
          setSelectedClassroomId(activeClassrooms[0].id);
        } else if (activeClassrooms.length === 0) {
          setMessage("当前没有可发布作业的活跃班级。");
        }
      } catch (cause) {
        if (mounted) setMessage(cause instanceof ApiError ? cause.message : "无法加载作业模板");
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    void load();
    return () => { mounted = false; };
  }, [role, templateId, token]);

  useEffect(() => () => playerRef.current?.remove(), []);

  const selectedClassroom = selectedClassroomId ? classrooms.find((classroom) => classroom.id === selectedClassroomId) ?? null : null;
  const availableStudents = publishMode === "UNSCOPED"
    ? students
    : selectedClassroom?.students.filter((student) => isActiveStatus(student.status)) ?? [];
  const availableStudentIds = new Set(availableStudents.map((student) => student.id));

  useEffect(() => {
    setSelectedIds((current) => current.filter((studentId) => availableStudentIds.has(studentId)));
  }, [Array.from(availableStudentIds).sort().join("|")]);

  const play = (url: string) => {
    playerRef.current?.remove();
    const player = createAudioPlayer(staffAssetUrl(url));
    playerRef.current = player;
    player.play();
  };
  const toggleStudent = (studentId: string) => setSelectedIds((current) => current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId]);

  async function publishSelectedTemplate() {
    setMessage("");
    const every = Number(interval);
    const times = Number(occurrenceLimit);
    const classroomId = publishMode === "CLASSROOM" ? selectedClassroomId : null;
    if (publishMode === "CLASSROOM" && !classroomId) return setMessage("请先选择一个活跃班级。");
    if (role !== "ADMIN" && !classroomId) return setMessage("老师发布作业需要选择一个已分配的活跃班级。");
    if (selectedIds.length === 0) return setMessage("请至少选择一名学生。");
    if (selectedIds.some((studentId) => !availableStudentIds.has(studentId))) return setMessage("请只选择当前班级中的活跃学生。");
    if (!Number.isInteger(every) || every < 1 || !Number.isInteger(times) || times < 1) return setMessage("周期和触发次数必须是大于 0 的整数。");
    const startsAtIso = parseShanghaiDateTime(startsAt);
    if (!startsAtIso) return setMessage("首次开始时间格式应为 YYYY-MM-DD HH:mm。");
    Alert.alert("确认布置作业", `模板：${detail?.template.title ?? "作业模板"}\n班级：${selectedClassroom?.name ?? "全部授权学生"}\n人数：${selectedIds.length} 人\n首次时间：${startsAt}\n周期：每 ${every} ${unit === "DAY" ? "天" : "周"}，共 ${times} 次`, [
      { text: "继续编辑", style: "cancel" },
      { text: "确认发布", onPress: () => void doPublishSelectedTemplate(classroomId, every, times, startsAtIso) },
    ]);
  }

  async function doPublishSelectedTemplate(classroomId: string | null, every: number, times: number, startsAtIso: string) {
    setIsPublishing(true);
    try {
      const result = await publishHomeworkFromTemplate(token, {
        classroomId,
        templateId,
        studentIds: selectedIds,
        schedule: { startsAt: startsAtIso, unit, interval: every, occurrenceLimit: times },
      });
      setSelectedIds([]);
      setMessage(`已发布给 ${result.homework.targetCount} 名学生，共生成 ${result.homework.occurrenceCount} 次练习。`);
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "作业发布失败，请稍后重试。");
    } finally {
      setIsPublishing(false);
    }
  }

  return <View style={styles.screen}>
    <View style={styles.readingHeader}>
      <Pressable accessibilityLabel="返回" style={styles.headerIconButton} onPress={onBack}><Ionicons name="chevron-back" color={colors.text} size={23} /></Pressable>
      <Text numberOfLines={1} style={styles.readingTitle}>布置作业模板</Text>
      <View style={styles.teacherHeaderActions}><Pressable accessibilityLabel="退出登录" style={styles.headerIconButton} onPress={onLogout}><Ionicons name="log-out-outline" color={colors.text} size={21} /></Pressable></View>
    </View>
    <ScrollView contentContainerStyle={styles.teacherPublishContent}>
      {isLoading ? <ActivityIndicator color={colors.text} /> : null}
      {detail ? <>
        <View style={styles.teacherFormSection}>
          <Text style={styles.sectionTitle}>{detail.template.title}</Text>
          <Text style={styles.previewText}>{staffTemplateLabel(detail.template.templateType)} · {detail.template.questionCount} 项 · 创建于 {staffDateLabel(detail.template.createdAt)}</Text>
          {detail.template.instructions ? <Text style={styles.chatTeacherText}>{detail.template.instructions}</Text> : null}
        </View>
        <View style={styles.publishedQuestionList}>
          {detail.questions.map((question) => <StaffHomeworkQuestionPreview key={`${question.sourceKind}-${question.id}`} question={question} onPlay={play} />)}
        </View>
      </> : null}
      <View style={styles.teacherFormSection}><Text style={styles.sectionTitle}>发布范围</Text>{role === "ADMIN" ? <View style={styles.mobileSegment}><Pressable style={[styles.mobileSegmentOption, publishMode === "UNSCOPED" && styles.mobileSegmentActive]} onPress={() => { setPublishMode("UNSCOPED"); setSelectedClassroomId(null); }}><Text style={styles.modeText}>全部授权学生</Text></Pressable><Pressable style={[styles.mobileSegmentOption, publishMode === "CLASSROOM" && styles.mobileSegmentActive]} onPress={() => setPublishMode("CLASSROOM")}><Text style={styles.modeText}>按班级</Text></Pressable></View> : <Text style={styles.previewText}>老师需要先选择一个已分配的活跃班级。</Text>}{publishMode === "CLASSROOM" ? <View style={styles.templateGrid}>{classrooms.length === 0 ? <Text style={styles.emptyHomework}>暂无可发布的活跃班级。</Text> : classrooms.map((classroom) => <Pressable key={classroom.id} style={[styles.templateOption, selectedClassroomId === classroom.id && styles.templateOptionActive]} onPress={() => setSelectedClassroomId(classroom.id)}><Text style={[styles.templateOptionText, selectedClassroomId === classroom.id && styles.templateOptionTextActive]}>{classroom.name}</Text></Pressable>)}</View> : <Text style={styles.previewText}>管理员将从现有授权学生列表中选择收件人。</Text>}</View>
      <View style={styles.teacherFormSection}><Text style={styles.sectionTitle}>发布设置</Text><View style={styles.field}><Text style={styles.label}>首次开始时间</Text><TextInput style={styles.input} value={startsAt} onChangeText={setStartsAt} placeholder="YYYY-MM-DD HH:mm" placeholderTextColor={colors.faint} autoCorrect={false} /></View><View style={styles.mobileSegment}><Pressable style={[styles.mobileSegmentOption, unit === "DAY" && styles.mobileSegmentActive]} onPress={() => setUnit("DAY")}><Text style={styles.modeText}>按天</Text></Pressable><Pressable style={[styles.mobileSegmentOption, unit === "WEEK" && styles.mobileSegmentActive]} onPress={() => setUnit("WEEK")}><Text style={styles.modeText}>按周</Text></Pressable></View><View style={styles.mobileNumberRow}><TextInput style={styles.mobileNumberInput} value={interval} onChangeText={setInterval} keyboardType="number-pad" /><Text style={styles.previewText}>每隔 {unit === "DAY" ? "天" : "周"}</Text><TextInput style={styles.mobileNumberInput} value={occurrenceLimit} onChangeText={setOccurrenceLimit} keyboardType="number-pad" /><Text style={styles.previewText}>次</Text></View></View>
      <View style={styles.teacherFormSection}><Text style={styles.sectionTitle}>选择学生</Text>{availableStudents.length === 0 ? <Text style={styles.emptyHomework}>{publishMode === "CLASSROOM" ? "请选择含有活跃学生的班级。" : "暂无可选择的授权学生。"}</Text> : availableStudents.map((student) => <Pressable key={student.id} style={[styles.mobileStudentRow, selectedIds.includes(student.id) && styles.mobileStudentRowActive]} onPress={() => toggleStudent(student.id)}><View><Text style={styles.previewTitle}>{student.displayName}</Text><Text style={styles.previewText}>{student.phone}</Text></View>{selectedIds.includes(student.id) ? <Ionicons name="checkmark-circle" color={colors.text} size={21} /> : <Ionicons name="ellipse-outline" color={colors.faint} size={21} />}</Pressable>)}</View>
      <Pressable accessibilityLabel="发布作业" style={({ pressed }) => [styles.mobilePublishButton, (isPublishing || isLoading) && styles.primaryButtonDisabled, pressed && styles.pressedState]} disabled={isPublishing || isLoading} onPress={() => void publishSelectedTemplate()}>{isPublishing ? <ActivityIndicator color={colors.text} /> : <Ionicons name="send" color={colors.text} size={22} />}</Pressable>
      {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
    </ScrollView>
  </View>;
}

function TeacherHomeworkLatestCycle({
  token,
  homework,
  onBack,
  onLogout,
}: {
  token: string;
  homework: StaffHomeworkSummary;
  onBack: () => void;
  onLogout: () => void;
}) {
  const [data, setData] = useState<StaffHomeworkLatestCycleResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = async () => {
    setIsLoading(true);
    try {
      setData(await getStaffHomeworkLatestCycle(token, homework.id));
      setMessage("");
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "无法加载最近周期作业情况");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void load(); }, [token, homework.id]);

  return <View style={styles.screen}>
    <View style={styles.readingHeader}>
      <Pressable accessibilityLabel="返回历史发布作业" style={styles.headerIconButton} onPress={onBack}><Ionicons name="chevron-back" color={colors.text} size={23} /></Pressable>
      <Text numberOfLines={1} style={styles.readingTitle}>最近周期作业情况</Text>
      <View style={styles.teacherHeaderActions}><Pressable accessibilityLabel="刷新最近周期" style={styles.headerIconButton} onPress={() => void load()}><Ionicons name="refresh-outline" color={colors.text} size={21} /></Pressable><Pressable accessibilityLabel="退出登录" style={styles.headerIconButton} onPress={onLogout}><Ionicons name="log-out-outline" color={colors.text} size={21} /></Pressable></View>
    </View>
    <ScrollView contentContainerStyle={styles.staffPageContent}>
      <View style={styles.staffPageSummary}><View style={styles.previewTitleInRow}><Text style={styles.sectionTitle}>{homework.title}</Text><Text style={styles.previewText}>{homework.classroomName ?? "未限定班级"}</Text></View>{data?.cycle ? <Text style={styles.historyStatus}>第 {data.cycle.sequenceNumber} 期</Text> : null}</View>
      {isLoading ? <ActivityIndicator color={colors.text} /> : null}
      {!isLoading && data?.cycle ? <>
        <Text style={styles.previewTag}>周期开始 {staffDateLabel(data.cycle.scheduledAt)} · 全部题目完成才计为打卡</Text>
        <View style={styles.staffCycleOverview}>
          <View style={styles.staffCycleMetric}><Text style={styles.staffCycleMetricValue}>{data.cycle.checkedInCount}/{data.cycle.studentCount}</Text><Text style={styles.staffCycleMetricLabel}>已打卡</Text></View>
          <View style={[styles.staffCycleMetric, styles.staffCycleMetricDivider]}><Text style={styles.staffCycleMetricValue}>{data.cycle.inProgressCount}</Text><Text style={styles.staffCycleMetricLabel}>进行中</Text></View>
          <View style={[styles.staffCycleMetric, styles.staffCycleMetricDivider]}><Text style={styles.staffCycleMetricValue}>{data.cycle.notStartedCount}</Text><Text style={styles.staffCycleMetricLabel}>未开始</Text></View>
        </View>
        <View style={styles.staffReviewCardList}>{data.cycle.students.map((student) => {
          const status = staffCycleStatusMeta[student.status];
          return <View key={student.occurrenceId} style={styles.previewRow}>
            <View style={styles.previewHeader}><Text style={[styles.previewTitle, styles.previewTitleInRow]}>{student.studentName}</Text><View style={styles.homeworkStatus}><Ionicons name={status.icon} color={status.color} size={16} /><Text style={[styles.homeworkStatusText, { color: status.color }]}>{status.label}</Text></View></View>
            <View style={styles.homeworkFooter}><Text style={styles.homeworkAction}>题目进度 {student.submittedCount}/{student.totalCount}</Text><Text style={styles.homeworkDispatchDate}>{student.lastSubmittedAt ? staffDateLabel(student.lastSubmittedAt) : "尚无提交"}</Text></View>
          </View>;
        })}</View>
      </> : null}
      {!isLoading && data && !data.cycle ? <Text style={styles.emptyHomework}>首个周期尚未开始，暂时没有学生作业情况。</Text> : null}
      {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
    </ScrollView>
  </View>;
}

function TeacherPublishChoiceWorkspace({
  onNew,
  onLibrary,
  onBack,
  onLogout,
}: {
  onNew: () => void;
  onLibrary: () => void;
  onBack: () => void;
  onLogout: () => void;
}) {
  return <View style={styles.screen}>
    <View style={styles.readingHeader}>
      <Pressable accessibilityLabel="返回老师工作台" style={styles.headerIconButton} onPress={onBack}><Ionicons name="chevron-back" color={colors.text} size={23} /></Pressable>
      <Text style={styles.readingTitle}>发布作业</Text>
      <View style={styles.teacherHeaderActions}><Pressable accessibilityLabel="退出登录" style={styles.headerIconButton} onPress={onLogout}><Ionicons name="log-out-outline" color={colors.text} size={21} /></Pressable></View>
    </View>
    <ScrollView contentContainerStyle={styles.staffPageContent}>
      <View style={styles.staffPageSummary}><Text style={styles.sectionTitle}>选择发布方式</Text><Text style={styles.previewText}>内容与实例分开管理</Text></View>
      <Pressable accessibilityLabel="从作业库选择模板发布" style={({ pressed }) => [styles.staffHistoryCard, pressed && styles.pressedState]} onPress={onLibrary}>
        <View style={styles.staffHistoryTitleRow}><View style={styles.staffClassroomIcon}><Ionicons name="library-outline" color={colors.text} size={22} /></View><View style={styles.checkinDetails}><Text style={styles.previewTitle}>从作业库选择</Text><Text style={styles.previewText}>复用几天前做好的内容，只重新选择班级、学生和周期。</Text></View><Ionicons name="chevron-forward" color={colors.muted} size={20} /></View>
      </Pressable>
      <Pressable accessibilityLabel="新建作业并发布" style={({ pressed }) => [styles.staffHistoryCard, pressed && styles.pressedState]} onPress={onNew}>
        <View style={styles.staffHistoryTitleRow}><View style={styles.staffClassroomIcon}><Ionicons name="create-outline" color={colors.text} size={22} /></View><View style={styles.checkinDetails}><Text style={styles.previewTitle}>新建作业</Text><Text style={styles.previewText}>先编辑本次内容并本地保存草稿，发布成功后自动进入作业库。</Text></View><Ionicons name="chevron-forward" color={colors.muted} size={20} /></View>
      </Pressable>
    </ScrollView>
  </View>;
}

function TeacherHomeworkLibraryWorkspace({
  token,
  userId,
  role,
  onBack,
  onOpenMenu,
  onUseTemplate,
  onLogout,
}: {
  token: string;
  userId: string;
  role: StaffRole;
  onBack: () => void;
  onOpenMenu?: () => void;
  onUseTemplate: (templateId: string) => void;
  onLogout: () => void;
}) {
  const [templates, setTemplates] = useState<StaffHomeworkTemplateSummary[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<StaffHomeworkTemplateSummary | null>(null);
  const [detail, setDetail] = useState<StaffHomeworkTemplateDetailResponse | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<HomeworkTemplateType | "STANDARD" | "">("");
  const [message, setMessage] = useState("");
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);

  const load = async (nextPage = 1) => {
    if (nextPage === 1) setIsLoading(true);
    else setIsLoadingMore(true);
    try {
      const body = await getStaffHomeworkTemplates(token, nextPage, 20, { search: search || undefined, templateType: typeFilter || undefined });
      setTemplates((current) => nextPage === 1
        ? body.templates
        : [...current, ...body.templates.filter((template) => !current.some((item) => item.id === template.id))]);
      setPage(body.pagination.page);
      setTotal(body.pagination.total);
      setMessage("");
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "无法加载作业库");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => { void load(); }, [token, search, typeFilter]);
  useEffect(() => () => playerRef.current?.remove(), []);
  useEffect(() => {
    if (!selectedTemplate) {
      setDetail(null);
      return;
    }
    let active = true;
    const templateId = selectedTemplate.id;
    setDetail(null);
    setIsDetailLoading(true);
    void getStaffHomeworkTemplateDetail(token, templateId)
      .then((body) => {
        if (!active || body.template.id !== templateId) return;
        setDetail(body);
        setMessage("");
      })
      .catch((cause) => {
        if (active) setMessage(cause instanceof ApiError ? cause.message : "无法加载模板预览");
      })
      .finally(() => {
        if (active) setIsDetailLoading(false);
      });
    return () => { active = false; };
  }, [selectedTemplate?.id, token]);

  const play = (url: string) => {
    playerRef.current?.remove();
    const player = createAudioPlayer(staffAssetUrl(url));
    playerRef.current = player;
    player.play();
  };

  const deleteTemplate = async (template: StaffHomeworkTemplateSummary) => {
    setDeletingId(template.id);
    try {
      await deleteStaffHomeworkTemplate(token, template.id);
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      setTotal((current) => Math.max(0, current - 1));
      if (selectedTemplate?.id === template.id) setSelectedTemplate(null);
      setMessage(`已删除“${template.title}”。`);
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "删除模板失败");
    } finally {
      setDeletingId(null);
    }
  };

  const confirmDelete = (template: StaffHomeworkTemplateSummary) => {
    Alert.alert("删除作业模板", `确定删除“${template.title}”吗？已发布的历史作业不会被删除。`, [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => void deleteTemplate(template) },
    ]);
  };

  if (isCreating) {
    return <TeacherPublishWorkspace token={token} userId={`${userId}:library`} role={role} createOnly onBack={() => { setIsCreating(false); void load(1); }} onCompleted={() => { setIsCreating(false); void load(1); }} onLogout={onLogout} />;
  }

  if (selectedTemplate) {
    const preview = detail?.template ?? selectedTemplate;
    const hasCurrentDetail = detail?.template.id === selectedTemplate.id;
    const canUseTemplate = hasCurrentDetail && preview.templateType !== "STANDARD" && preview.questionCount > 0;
    const canDeleteTemplate = hasCurrentDetail && (role === "ADMIN" || preview.creatorId === userId);
    return <View style={styles.screen}>
      <View style={styles.readingHeader}>
        <Pressable accessibilityLabel="返回作业库列表" style={styles.headerIconButton} onPress={() => setSelectedTemplate(null)}><Ionicons name="chevron-back" color={colors.text} size={23} /></Pressable>
        <Text numberOfLines={1} style={styles.readingTitle}>模板预览</Text>
        <View style={styles.teacherHeaderActions}>{canDeleteTemplate ? <Pressable accessibilityLabel={`删除模板 ${preview.title}`} disabled={deletingId === preview.id} style={styles.headerIconButton} onPress={() => confirmDelete(preview)}><Ionicons name="trash-outline" color={colors.text} size={21} /></Pressable> : null}<Pressable accessibilityLabel="退出登录" style={styles.headerIconButton} onPress={onLogout}><Ionicons name="log-out-outline" color={colors.text} size={21} /></Pressable></View>
      </View>
      <ScrollView contentContainerStyle={styles.publishedPreviewContent}>
        {isDetailLoading ? <ActivityIndicator color={colors.text} /> : null}
        <View style={styles.publishedPreviewHeading}>
          <View style={styles.previewTitleInRow}><Text style={styles.title}>{preview.title}</Text><Text style={styles.previewText}>{staffTemplateLabel(preview.templateType)} · {preview.questionCount} 项</Text></View>
        </View>
        {preview.instructions ? <View style={styles.chatTeacher}><Text style={styles.chatTeacherText}>{preview.instructions}</Text></View> : null}
        <View style={styles.previewActionRow}>
          <Pressable accessibilityLabel="使用这个模板发布作业" disabled={!canUseTemplate} style={({ pressed }) => [styles.primaryCommandButton, !canUseTemplate && styles.primaryButtonDisabled, pressed && styles.pressedState]} onPress={() => canUseTemplate ? onUseTemplate(preview.id) : setMessage("这个历史模板没有可再次布置的作业内容。")}><Ionicons name="send-outline" color={colors.text} size={19} /><Text style={styles.primaryButtonText}>使用此模板</Text></Pressable>
          {canDeleteTemplate ? <Pressable accessibilityLabel="删除这个作业模板" disabled={deletingId === preview.id} style={({ pressed }) => [styles.secondaryCommandButton, deletingId === preview.id && styles.primaryButtonDisabled, pressed && styles.pressedState]} onPress={() => confirmDelete(preview)}><Text style={styles.secondaryButtonText}>删除</Text></Pressable> : null}
        </View>
        <View style={styles.publishedQuestionList}>
          <Text style={styles.sectionTitle}>作业内容 · {detail?.questions.length ?? preview.questionCount} 项</Text>
          {detail?.questions.map((question) => <StaffHomeworkQuestionPreview key={`${question.sourceKind}-${question.id}`} question={question} onPlay={play} />)}
        </View>
        {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
      </ScrollView>
    </View>;
  }

  return <View style={styles.screen}>
    <View style={styles.readingHeader}>
      <Pressable accessibilityLabel={onOpenMenu ? "打开功能菜单" : "返回发布方式"} style={styles.headerIconButton} onPress={onOpenMenu ?? onBack}><Ionicons name={onOpenMenu ? "menu-outline" : "chevron-back"} color={colors.text} size={23} /></Pressable>
      <Text style={styles.readingTitle}>作业库</Text>
      <View style={styles.teacherHeaderActions}><Pressable accessibilityLabel="新增作业模板" style={styles.headerIconButton} onPress={() => setIsCreating(true)}><Ionicons name="add-circle-outline" color={colors.text} size={22} /></Pressable><Pressable accessibilityLabel="刷新作业库" style={styles.headerIconButton} onPress={() => void load(1)}><Ionicons name="refresh-outline" color={colors.text} size={21} /></Pressable><Pressable accessibilityLabel="退出登录" style={styles.headerIconButton} onPress={onLogout}><Ionicons name="log-out-outline" color={colors.text} size={21} /></Pressable></View>
    </View>
    <ScrollView contentContainerStyle={styles.staffPageContent}>
      <View style={styles.staffPageSummary}><Text style={styles.sectionTitle}>可复用作业模板</Text><Text style={styles.previewText}>共 {total} 份</Text></View>
      <View style={styles.staffSearchRow}><View style={styles.staffSearchField}><Ionicons name="search-outline" color={colors.faint} size={19} /><TextInput style={styles.staffAutocompleteInput} value={searchInput} onChangeText={setSearchInput} placeholder="搜索模板名称" placeholderTextColor={colors.faint} returnKeyType="search" onSubmitEditing={() => setSearch(searchInput.trim())} />{search ? <Pressable style={styles.staffAutocompleteClear} onPress={() => { setSearchInput(""); setSearch(""); }}><Ionicons name="close-circle" color={colors.faint} size={20} /></Pressable> : null}</View><Pressable style={styles.searchSubmitButton} onPress={() => setSearch(searchInput.trim())}><Text style={styles.secondaryButtonText}>搜索</Text></Pressable></View>
      <View style={styles.templateGrid}>{(["", ...homeworkTemplateTypes] as const).map((type) => <Pressable key={type || "ALL"} style={[styles.templateOption, typeFilter === type && styles.templateOptionActive]} onPress={() => setTypeFilter(type)}><Text style={[styles.templateOptionText, typeFilter === type && styles.templateOptionTextActive]}>{type ? templateLabels[type] : "全部类型"}</Text></Pressable>)}</View>
      {isLoading ? <ActivityIndicator color={colors.text} /> : null}
      {!isLoading && templates.length === 0 ? <Text style={styles.emptyHomework}>作业库还没有模板，点击右上角新增。</Text> : null}
      {templates.map((template) => <Pressable key={template.id} accessibilityLabel={`预览作业模板 ${template.title}`} style={({ pressed }) => [styles.staffHistoryCard, pressed && styles.pressedState]} onPress={() => setSelectedTemplate(template)}>
        <View style={styles.staffHistoryTitleRow}><View style={styles.checkinDetails}><Text style={styles.previewTitle}>{template.title}</Text><Text style={styles.previewText}>{staffTemplateLabel(template.templateType)} · {template.questionCount} 项</Text></View>{role === "ADMIN" || template.creatorId === userId ? <Pressable accessibilityLabel={`删除作业模板 ${template.title}`} disabled={deletingId === template.id} style={({ pressed }) => [styles.smallOutlineIconButton, deletingId === template.id && styles.primaryButtonDisabled, pressed && styles.pressedState]} onPress={(event) => { event.stopPropagation(); confirmDelete(template); }}><Ionicons name="trash-outline" color={colors.text} size={18} /></Pressable> : <Ionicons name="chevron-forward" color={colors.muted} size={20} />}</View>
        <Text style={styles.previewTag}>创建人 {template.creatorName} · 使用 {template.publishedHomeworkCount} 次 · 最近使用 {template.lastPublishedAt ? staffDateLabel(template.lastPublishedAt) : "暂无"}</Text>
      </Pressable>)}
      {templates.length < total ? <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressedState]} disabled={isLoadingMore} onPress={() => void load(page + 1)}>{isLoadingMore ? <ActivityIndicator color={colors.text} /> : <Text style={styles.secondaryButtonText}>加载更多</Text>}</Pressable> : null}
      {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
    </ScrollView>
  </View>;
}

function TeacherHomeworkHistory({ token, onOpenMenu, onReuseTemplate, onLogout }: { token: string; onOpenMenu: () => void; onReuseTemplate: (templateId: string) => void; onLogout: () => void }) {
  const [homeworks, setHomeworks] = useState<StaffHomeworkSummary[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<StaffHomeworkSummary | null>(null);
  const [selectedHomework, setSelectedHomework] = useState<StaffHomeworkSummary | null>(null);
  const [previewHomework, setPreviewHomework] = useState<StaffHomeworkSummary | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "PUBLISHED" | "PAUSED" | "ARCHIVED">("");
  const [classrooms, setClassrooms] = useState<StaffClassroom[]>([]);
  const [classroomId, setClassroomId] = useState("");
  const [message, setMessage] = useState("");

  const load = async (nextPage = 1) => {
    if (nextPage === 1) setIsLoading(true);
    else setIsLoadingMore(true);
    try {
      const body = await getStaffHomeworkHistory(token, nextPage, 20, { search: search || undefined, status: statusFilter || undefined, classroomId: classroomId || undefined });
      setHomeworks((current) => nextPage === 1
        ? body.homeworks
        : [...current, ...body.homeworks.filter((homework) => !current.some((item) => item.id === homework.id))]);
      setPage(body.pagination.page);
      setTotal(body.pagination.total);
      setMessage("");
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "无法加载发布历史");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => { void load(); }, [token, search, statusFilter, classroomId]);
  useEffect(() => {
    void getStaffClassrooms(token)
      .then((body) => setClassrooms(body.classrooms))
      .catch(() => setClassrooms([]));
  }, [token]);

  const updateStatus = async (homework: StaffHomeworkSummary, status: "PUBLISHED" | "PAUSED" | "ARCHIVED") => {
    setUpdatingId(homework.id);
    try {
      const body = await updateStaffHomeworkStatus(token, homework.id, status);
      setHomeworks((current) => current.map((item) => item.id === homework.id ? body.homework : item));
      const resultLabel = status === "PUBLISHED" ? "已恢复" : status === "PAUSED" ? "已暂停" : "已结束";
      setMessage(`作业“${homework.title}”${resultLabel}。`);
      setArchiveTarget(null);
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "作业状态更新失败");
    } finally {
      setUpdatingId(null);
    }
  };

  if (selectedHomework) {
    return <TeacherHomeworkLatestCycle token={token} homework={selectedHomework} onBack={() => setSelectedHomework(null)} onLogout={onLogout} />;
  }
  if (previewHomework) {
    return <TeacherPublishedHomeworkPreview token={token} homework={previewHomework} onBack={() => setPreviewHomework(null)} onOpenCycle={() => { setPreviewHomework(null); setSelectedHomework(previewHomework); }} onReuseTemplate={onReuseTemplate} onLogout={onLogout} />;
  }

  return <View style={styles.screen}>
    <View style={styles.readingHeader}>
      <Pressable accessibilityLabel="打开功能菜单" style={styles.headerIconButton} onPress={onOpenMenu}><Ionicons name="menu-outline" color={colors.text} size={23} /></Pressable>
      <Text style={styles.readingTitle}>已发布作业</Text>
      <View style={styles.teacherHeaderActions}><Pressable accessibilityLabel="刷新发布历史" style={styles.headerIconButton} onPress={() => void load(1)}><Ionicons name="refresh-outline" color={colors.text} size={21} /></Pressable><Pressable accessibilityLabel="退出登录" style={styles.headerIconButton} onPress={onLogout}><Ionicons name="log-out-outline" color={colors.text} size={21} /></Pressable></View>
    </View>
    <ScrollView contentContainerStyle={styles.staffPageContent}>
      <View style={styles.staffPageSummary}><Text style={styles.sectionTitle}>已发布作业</Text><Text style={styles.previewText}>共 {total} 份</Text></View>
      <View style={styles.staffSearchRow}><View style={styles.staffSearchField}><Ionicons name="search-outline" color={colors.faint} size={19} /><TextInput style={styles.staffAutocompleteInput} value={searchInput} onChangeText={setSearchInput} placeholder="搜索作业名称" placeholderTextColor={colors.faint} returnKeyType="search" onSubmitEditing={() => setSearch(searchInput.trim())} />{search ? <Pressable style={styles.staffAutocompleteClear} onPress={() => { setSearchInput(""); setSearch(""); }}><Ionicons name="close-circle" color={colors.faint} size={20} /></Pressable> : null}</View><Pressable style={styles.searchSubmitButton} onPress={() => setSearch(searchInput.trim())}><Text style={styles.secondaryButtonText}>搜索</Text></Pressable></View>
      <View style={styles.templateGrid}>{(["", "PUBLISHED", "PAUSED", "ARCHIVED"] as const).map((status) => <Pressable key={status || "ALL"} style={[styles.templateOption, statusFilter === status && styles.templateOptionActive]} onPress={() => setStatusFilter(status)}><Text style={[styles.templateOptionText, statusFilter === status && styles.templateOptionTextActive]}>{status ? staffHomeworkStatusMeta[status].label : "全部状态"}</Text></Pressable>)}</View>
      <View style={styles.templateGrid}><Pressable style={[styles.templateOption, !classroomId && styles.templateOptionActive]} onPress={() => setClassroomId("")}><Text style={[styles.templateOptionText, !classroomId && styles.templateOptionTextActive]}>全部班级</Text></Pressable>{classrooms.map((classroom) => <Pressable key={classroom.id} style={[styles.templateOption, classroomId === classroom.id && styles.templateOptionActive]} onPress={() => setClassroomId(classroom.id)}><Text style={[styles.templateOptionText, classroomId === classroom.id && styles.templateOptionTextActive]}>{classroom.name}</Text></Pressable>)}</View>
      {isLoading ? <ActivityIndicator color={colors.text} /> : null}
      {!isLoading && homeworks.length === 0 ? <Text style={styles.emptyHomework}>还没有发布过作业。</Text> : null}
      {homeworks.map((homework) => {
        const status = staffHomeworkStatusMeta[homework.status];
        return <Pressable key={homework.id} accessibilityLabel={`预览历史作业 ${homework.title}`} style={({ pressed }) => [styles.staffHistoryCard, pressed && styles.pressedState]} onPress={() => setPreviewHomework(homework)}>
          <View style={styles.staffHistoryTitleRow}><View style={styles.checkinDetails}><Text style={styles.previewTitle}>{homework.title}</Text><Text style={styles.previewText}>{homework.classroomName ?? "未限定班级"} · {staffTemplateLabel(homework.templateType)}</Text></View><View style={styles.staffStatusLabel}><Ionicons name={status.icon} color={colors.muted} size={16} /><Text style={styles.historyStatus}>{status.label}</Text></View></View>
          <Text style={styles.previewTag}>每 {homework.repeatInterval} {homework.repeatUnit === "DAY" ? "天" : "周"} · 共 {homework.occurrenceLimit} 次 · {homework.targetCount} 名学生</Text>
          <View style={styles.staffProgressRow}><Text style={styles.staffProgressText}>{homework.completedOccurrenceCount}/{homework.occurrenceCount}</Text><Text style={styles.previewText}>已完成实例</Text></View>
          <View style={styles.staffHistoryFooter}><Text style={styles.homeworkDispatchDate}>{staffDateLabel(homework.publishedAt)}</Text><View style={styles.staffInlineActions}>{homework.templateId && homework.templateType !== "STANDARD" ? <Pressable accessibilityLabel={`再次布置 ${homework.title}`} style={({ pressed }) => [styles.smallOutlineIconButton, pressed && styles.pressedState]} onPress={(event) => { event.stopPropagation(); onReuseTemplate(homework.templateId!); }}><Ionicons name="send-outline" color={colors.text} size={18} /></Pressable> : null}<Pressable accessibilityLabel={`查看 ${homework.title} 最近周期作业情况`} style={({ pressed }) => [styles.smallOutlineIconButton, pressed && styles.pressedState]} onPress={(event) => { event.stopPropagation(); setSelectedHomework(homework); }}><Ionicons name="list-outline" color={colors.text} size={19} /></Pressable>{homework.status === "PUBLISHED" ? <Pressable accessibilityLabel={`暂停 ${homework.title}`} disabled={updatingId === homework.id} style={({ pressed }) => [styles.smallOutlineIconButton, pressed && styles.pressedState]} onPress={(event) => { event.stopPropagation(); void updateStatus(homework, "PAUSED"); }}><Ionicons name="pause" color={colors.text} size={18} /></Pressable> : null}{homework.status === "PAUSED" ? <Pressable accessibilityLabel={`恢复 ${homework.title}`} disabled={updatingId === homework.id} style={({ pressed }) => [styles.smallOutlineIconButton, pressed && styles.pressedState]} onPress={(event) => { event.stopPropagation(); void updateStatus(homework, "PUBLISHED"); }}><Ionicons name="play" color={colors.text} size={18} /></Pressable> : null}{homework.status !== "ARCHIVED" ? <Pressable accessibilityLabel={`结束 ${homework.title}`} disabled={updatingId === homework.id} style={({ pressed }) => [styles.smallOutlineIconButton, pressed && styles.pressedState]} onPress={(event) => { event.stopPropagation(); setArchiveTarget(homework); }}><Ionicons name="stop-circle-outline" color={colors.text} size={19} /></Pressable> : null}</View></View>
        </Pressable>;
      })}
      {homeworks.length < total ? <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressedState]} disabled={isLoadingMore} onPress={() => void load(page + 1)}>{isLoadingMore ? <ActivityIndicator color={colors.text} /> : <Text style={styles.secondaryButtonText}>加载更多</Text>}</Pressable> : null}
      {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
    </ScrollView>
    <Modal visible={archiveTarget !== null} transparent animationType="fade" onRequestClose={() => setArchiveTarget(null)}><SafeAreaView style={styles.modalSafeArea}><View style={styles.modalBackdrop}><View style={styles.confirmModal}><Text style={styles.sectionTitle}>结束作业</Text><Text style={styles.chatTeacherText}>结束后不能恢复，学生下次登录将在作业历史中看到“已封存”，也不能继续提交“{archiveTarget?.title}”。</Text><View style={styles.confirmActions}><Pressable style={styles.secondaryCommandButton} onPress={() => setArchiveTarget(null)}><Text style={styles.secondaryButtonText}>取消</Text></Pressable><Pressable style={styles.primaryCommandButton} disabled={!archiveTarget || updatingId === archiveTarget.id} onPress={() => archiveTarget && void updateStatus(archiveTarget, "ARCHIVED")}><Ionicons name="stop-circle-outline" color={colors.text} size={19} /><Text style={styles.primaryButtonText}>确认结束</Text></Pressable></View></View></View></SafeAreaView></Modal>
  </View>;
}

function TeacherClassroomWorkspace({ token, role, onOpenMenu, onLogout }: { token: string; role: StaffRole; onOpenMenu: () => void; onLogout: () => void }) {
  const [classrooms, setClassrooms] = useState<StaffClassroom[]>([]);
  const [teachers, setTeachers] = useState<StaffStudent[]>([]);
  const [students, setStudents] = useState<StaffStudent[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [teacherIds, setTeacherIds] = useState<string[]>([]);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState("");
  const [editorVisible, setEditorVisible] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<StaffClassroom | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = async () => {
    setIsLoading(true);
    try {
      const [classroomBody, candidateBody] = await Promise.all([getStaffClassrooms(token), getStaffClassroomStudentCandidates(token)]);
      setClassrooms(classroomBody.classrooms);
      setStudents(candidateBody.students.filter((user) => !user.status || isActiveStatus(user.status)));
      if (role === "ADMIN") {
        const teacherBody = await getStaffTeachers(token);
        setTeachers(teacherBody.users.filter((user) => !user.status || isActiveStatus(user.status)));
      }
      setMessage("");
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "无法加载班级");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void load(); }, [role, token]);

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setTeacherIds([]);
    setStudentIds([]);
    setStudentSearch("");
    setEditorVisible(true);
  };

  const openEdit = (classroom: StaffClassroom) => {
    setEditingId(classroom.id);
    setName(classroom.name);
    setTeacherIds(classroom.teachers.filter((member) => isActiveStatus(member.status)).map((member) => member.id));
    setStudentIds(classroom.students.filter((member) => isActiveStatus(member.status)).map((member) => member.id));
    setStudentSearch("");
    setEditorVisible(true);
  };

  const toggleId = (id: string, ids: string[], setIds: (next: string[]) => void) => {
    setIds(ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  };

  const save = async () => {
    if (!name.trim()) {
      setMessage("请输入班级名称。");
      return;
    }
    setIsSaving(true);
    try {
      const successMessage = editingId ? "班级信息已保存。" : "班级已创建。";
      if (editingId) await updateStaffClassroom(token, editingId, role === "ADMIN" ? { name: name.trim(), teacherIds, studentIds } : { name: name.trim(), studentIds });
      else await createStaffClassroom(token, role === "ADMIN" ? { name: name.trim(), teacherIds, studentIds } : { name: name.trim(), studentIds });
      setEditorVisible(false);
      await load();
      setMessage(successMessage);
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "班级保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  const updateStatus = async (classroom: StaffClassroom, status: "ACTIVE" | "ARCHIVED") => {
    setUpdatingId(classroom.id);
    try {
      const body = await updateStaffClassroom(token, classroom.id, { status });
      setClassrooms((current) => current.map((item) => item.id === classroom.id ? body.classroom : item));
      setMessage(status === "ACTIVE" ? "班级已恢复。" : "班级已归档。");
      setArchiveTarget(null);
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "班级状态更新失败");
    } finally {
      setUpdatingId(null);
    }
  };

  const visibleStudents = students.filter((student) => matchesFilterQuery(`${student.displayName} ${student.phone}`, studentSearch));
  const visibleStudentIds = visibleStudents.map((student) => student.id);

  return <View style={styles.screen}>
    <View style={styles.readingHeader}>
      <Pressable accessibilityLabel="打开功能菜单" style={styles.headerIconButton} onPress={onOpenMenu}><Ionicons name="menu-outline" color={colors.text} size={23} /></Pressable>
      <Text style={styles.readingTitle}>班级管理</Text>
      <View style={styles.teacherHeaderActions}><Pressable accessibilityLabel="新建班级" style={styles.headerIconButton} onPress={openCreate}><Ionicons name="add" color={colors.text} size={23} /></Pressable><Pressable accessibilityLabel="刷新班级" style={styles.headerIconButton} onPress={() => void load()}><Ionicons name="refresh-outline" color={colors.text} size={21} /></Pressable><Pressable accessibilityLabel="退出登录" style={styles.headerIconButton} onPress={onLogout}><Ionicons name="log-out-outline" color={colors.text} size={21} /></Pressable></View>
    </View>
    <ScrollView contentContainerStyle={styles.staffPageContent}>
      <View style={styles.staffPageSummary}><Text style={styles.sectionTitle}>{role === "ADMIN" ? "全部班级" : "我的班级"}</Text><Text style={styles.previewText}>共 {classrooms.length} 个</Text></View>
      {isLoading ? <ActivityIndicator color={colors.text} /> : null}
      {!isLoading && classrooms.length === 0 ? <Text style={styles.emptyHomework}>当前没有班级。</Text> : null}
      {classrooms.map((classroom) => {
        const expanded = expandedId === classroom.id;
        const active = isActiveStatus(classroom.status);
        return <View key={classroom.id} style={styles.staffClassroomCard}>
          <Pressable style={({ pressed }) => [styles.staffClassroomHeader, pressed && styles.pressedState]} onPress={() => setExpandedId(expanded ? null : classroom.id)}><View style={styles.staffClassroomIcon}><Ionicons name="people" color={colors.text} size={20} /></View><View style={styles.checkinDetails}><View style={styles.historyTitleRow}><Text style={[styles.previewTitle, styles.historyTitleText]}>{classroom.name}</Text><Text style={styles.historyStatus}>{active ? "使用中" : "已归档"}</Text></View><Text style={styles.previewText}>{classroom.teacherCount} 名老师 · {classroom.studentCount} 名学生</Text></View><Ionicons name={expanded ? "chevron-up" : "chevron-down"} color={colors.muted} size={20} /></Pressable>
          {expanded ? <View style={styles.staffMemberDetails}><Text style={styles.label}>老师</Text><Text style={styles.previewText}>{classroom.teachers.length ? classroom.teachers.map((member) => member.displayName).join("、") : "未分配"}</Text><Text style={styles.label}>学生</Text><Text style={styles.previewText}>{classroom.students.length ? classroom.students.map((member) => member.displayName).join("、") : "未分配"}</Text></View> : null}
          {(role === "ADMIN" || active) ? <View style={styles.staffClassroomActions}>{active ? <Pressable accessibilityLabel={`编辑 ${classroom.name}`} style={({ pressed }) => [styles.smallOutlineIconButton, pressed && styles.pressedState]} onPress={() => openEdit(classroom)}><Ionicons name="pencil-outline" color={colors.text} size={18} /></Pressable> : null}{role === "ADMIN" ? active ? <Pressable accessibilityLabel={`归档 ${classroom.name}`} disabled={updatingId === classroom.id} style={({ pressed }) => [styles.smallOutlineIconButton, pressed && styles.pressedState]} onPress={() => setArchiveTarget(classroom)}><Ionicons name="archive-outline" color={colors.text} size={18} /></Pressable> : <Pressable accessibilityLabel={`恢复 ${classroom.name}`} disabled={updatingId === classroom.id} style={({ pressed }) => [styles.smallOutlineIconButton, pressed && styles.pressedState]} onPress={() => void updateStatus(classroom, "ACTIVE")}><Ionicons name="refresh-outline" color={colors.text} size={18} /></Pressable> : null}</View> : null}
        </View>;
      })}
      {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
    </ScrollView>
    <Modal visible={editorVisible} transparent animationType="slide" onRequestClose={() => setEditorVisible(false)}><SafeAreaView style={styles.modalSafeArea}><View style={styles.modalBackdrop}><View style={[styles.readingModal, styles.staffEditorModal]}><View style={styles.modalTopRow}><Text style={styles.sectionTitle}>{editingId ? "编辑班级" : "新建班级"}</Text><Pressable accessibilityLabel="关闭班级编辑" style={styles.headerIconButton} onPress={() => setEditorVisible(false)}><Ionicons name="close" color={colors.text} size={22} /></Pressable></View><ScrollView style={styles.modalScroll} contentContainerStyle={styles.staffEditorContent} keyboardShouldPersistTaps="handled"><View style={styles.field}><Text style={styles.label}>班级名称</Text><TextInput style={styles.input} value={name} onChangeText={setName} placeholder="输入班级名称" placeholderTextColor={colors.faint} maxLength={80} /></View>{role === "ADMIN" ? <><Text style={styles.sectionTitle}>老师</Text>{teachers.length ? teachers.map((teacher) => <Pressable key={teacher.id} style={[styles.mobileStudentRow, teacherIds.includes(teacher.id) && styles.mobileStudentRowActive]} onPress={() => toggleId(teacher.id, teacherIds, setTeacherIds)}><View><Text style={styles.previewTitle}>{teacher.displayName}</Text><Text style={styles.previewText}>{teacher.phone}</Text></View><Ionicons name={teacherIds.includes(teacher.id) ? "checkmark-circle" : "ellipse-outline"} color={teacherIds.includes(teacher.id) ? colors.text : colors.faint} size={21} /></Pressable>) : <Text style={styles.emptyHomework}>没有可分配的老师。</Text>}</> : <Text style={styles.previewText}>老师身份固定为当前账号，只编辑学生名单。</Text>}<Text style={styles.sectionTitle}>学生</Text><TextInput style={styles.input} value={studentSearch} onChangeText={setStudentSearch} placeholder="搜索学生姓名或手机号" placeholderTextColor={colors.faint} /><View style={styles.previewActionRow}><Pressable style={styles.secondaryCommandButton} onPress={() => setStudentIds(Array.from(new Set([...studentIds, ...visibleStudentIds])))}><Text style={styles.secondaryButtonText}>全选当前</Text></Pressable><Pressable style={styles.secondaryCommandButton} onPress={() => setStudentIds((current) => current.filter((id) => !visibleStudentIds.includes(id)))}><Text style={styles.secondaryButtonText}>清空当前</Text></Pressable></View><Text style={styles.previewTag}>移除学生只影响未来发布的作业，已发布作业不会被删除。</Text>{visibleStudents.length ? visibleStudents.map((student) => <Pressable key={student.id} style={[styles.mobileStudentRow, studentIds.includes(student.id) && styles.mobileStudentRowActive]} onPress={() => toggleId(student.id, studentIds, setStudentIds)}><View><Text style={styles.previewTitle}>{student.displayName}</Text><Text style={styles.previewText}>{student.phone}</Text></View><Ionicons name={studentIds.includes(student.id) ? "checkmark-circle" : "ellipse-outline"} color={studentIds.includes(student.id) ? colors.text : colors.faint} size={21} /></Pressable>) : <Text style={styles.emptyHomework}>没有匹配的学生。</Text>}<Pressable style={[styles.primaryCommandButton, isSaving && styles.primaryButtonDisabled]} disabled={isSaving} onPress={() => void save()}>{isSaving ? <ActivityIndicator color={colors.text} /> : <><Ionicons name="save-outline" color={colors.text} size={19} /><Text style={styles.primaryButtonText}>保存班级</Text></>}</Pressable></ScrollView></View></View></SafeAreaView></Modal>
    <Modal visible={archiveTarget !== null} transparent animationType="fade" onRequestClose={() => setArchiveTarget(null)}><SafeAreaView style={styles.modalSafeArea}><View style={styles.modalBackdrop}><View style={styles.confirmModal}><Text style={styles.sectionTitle}>归档班级</Text><Text style={styles.chatTeacherText}>归档“{archiveTarget?.name}”后，老师不能再向这个班级发布作业。</Text><View style={styles.confirmActions}><Pressable style={styles.secondaryCommandButton} onPress={() => setArchiveTarget(null)}><Text style={styles.secondaryButtonText}>取消</Text></Pressable><Pressable style={styles.primaryCommandButton} disabled={!archiveTarget || updatingId === archiveTarget.id} onPress={() => archiveTarget && void updateStatus(archiveTarget, "ARCHIVED")}><Ionicons name="archive-outline" color={colors.text} size={18} /><Text style={styles.primaryButtonText}>确认归档</Text></Pressable></View></View></View></SafeAreaView></Modal>
  </View>;
}

function reviewConversationStatus(conversation: StaffHomeworkSubmissionConversation) {
  if (conversation.reviewStatus === "REVIEWED") return { label: "已批改", icon: "checkmark-circle" as const, color: "#327144" };
  if (conversation.reviewStatus === "PENDING_REVIEW") return { label: "待批改", icon: "time" as const, color: "#9a651d" };
  return { label: "提交中", icon: "create-outline" as const, color: colors.muted };
}

function shanghaiDateRangeValue(value: string, endOfDay: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function matchesFilterQuery(label: string, query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const normalizedLabel = label.toLocaleLowerCase();
  return terms.length === 0 || terms.every((term) => normalizedLabel.includes(term));
}

function automaticFilterMatch<T extends { id: string }>(options: T[], query: string, label: (option: T) => string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return null;
  const matches = options.filter((option) => matchesFilterQuery(label(option), query));
  return matches.find((option) => label(option).trim().toLocaleLowerCase() === normalizedQuery)
    ?? (matches.length === 1 ? matches[0] : null);
}

function TeacherHomeworkSubmissionDetail({
  token,
  occurrenceId,
  providerConfigured,
  onBack,
  onUpdated,
  nextPendingOccurrence,
  onOpenNext,
}: {
  token: string;
  occurrenceId: string;
  providerConfigured: boolean;
  onBack: () => void;
  onUpdated: () => void;
  nextPendingOccurrence?: StaffHomeworkSubmissionConversation | null;
  onOpenNext?: (occurrenceId: string) => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const [conversation, setConversation] = useState<StaffHomeworkSubmissionDetail | null>(null);
  const [selected, setSelected] = useState<StaffHomeworkSubmissionQuestion | null>(null);
  const [grade, setGrade] = useState<StaffReviewGrade>("A");
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const load = async (silent = false) => {
    try {
      const body = await getStaffHomeworkSubmissionDetail(token, occurrenceId);
      setConversation(body.conversation);
      setSelected((current) => current
        ? body.conversation.questions.find((question) => question.submissionId === current.submissionId) ?? null
        : null);
      if (!silent) setMessage("");
    } catch (cause) {
      if (!silent) setMessage(cause instanceof ApiError ? cause.message : "无法加载作业提交");
    }
  };

  useEffect(() => {
    void load();
    return () => playerRef.current?.remove();
  }, [token, occurrenceId]);
  useBoundedAssessmentRefresh(
    pendingAssessmentObservationKeys(conversation?.questions.map((question) => question.assessment) ?? []),
    () => load(true),
  );

  const play = (url: string) => {
    playerRef.current?.remove();
    const player = createAudioPlayer({
      uri: url.startsWith("http") ? url : `${apiBaseUrl}${url}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    playerRef.current = player;
    player.play();
  };

  const openQuestion = (question: StaffHomeworkSubmissionQuestion) => {
    if (!question.submissionId) return;
    setSelected(question);
    setGrade((["SSS", "SS", "S", "A", "B"] as const).includes(question.grade as StaffReviewGrade) ? question.grade as StaffReviewGrade : "A");
    setRecordedUri(null);
    setMessage("");
  };

  const startRecording = async () => {
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) return setMessage("请允许麦克风权限后再开始语音点评。");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecordedUri(null);
    } catch {
      setMessage("语音点评无法开始，请稍后重试。");
    }
  };

  const stopRecording = async () => {
    await recorder.stop();
    setRecordedUri(recorder.uri ?? null);
  };

  const submitReview = async () => {
    if (!selected?.submissionId) return;
    setIsSubmitting(true);
    try {
      let audio: Blob | { uri: string; type: string; name: string } | null = null;
      if (recordedUri) {
        audio = Platform.OS === "web"
          ? await (await fetch(recordedUri)).blob()
          : { uri: recordedUri, type: "audio/mp4", name: "teacher-feedback.m4a" };
      }
      const body = await reviewStaffHomeworkSubmission(token, {
        occurrenceId,
        sourceKind: selected.sourceKind,
        submissionId: selected.submissionId,
        grade,
        audio,
      });
      setConversation(body.conversation);
      setSelected(null);
      setRecordedUri(null);
      setMessage("批改已发送给学生。");
      onUpdated();
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "批改提交失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!conversation) {
    return <View style={[styles.screen, styles.loadingScreen]}>{message ? <Text style={styles.readingMessage}>{message}</Text> : <ActivityIndicator color={colors.text} />}</View>;
  }

  const status = reviewConversationStatus(conversation);
  return <View style={styles.screen}>
    <View style={styles.readingHeader}>
      <Pressable accessibilityLabel="返回批改列表" style={styles.headerIconButton} onPress={onBack}><Ionicons name="chevron-back" color={colors.text} size={23} /></Pressable>
      <View style={styles.practiceHeaderText}><Text style={styles.readingTitle}>{conversation.homeworkTitle}</Text><Text style={styles.practiceTemplateLabel}>{conversation.studentName}</Text></View>
      <Pressable accessibilityLabel="刷新作业提交" style={styles.headerIconButton} onPress={() => void load()}><Ionicons name="refresh-outline" color={colors.text} size={21} /></Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.chatContent}>
      <View style={styles.chatTeacher}>
        <Text style={styles.chatTeacherText}>{conversation.studentName} · {templateLabels[conversation.templateType]}</Text>
        <Text style={styles.previewTag}>{conversation.classroomName ?? "未限定班级"} · 提交于 {staffDateLabel(conversation.latestSubmittedAt)}</Text>
        <Text style={styles.previewTag}>已批改 {conversation.reviewedCount}/{conversation.submittedCount} · 共 {conversation.totalCount} 题</Text>
      </View>
      {conversation.questions.map((question) => {
        const prompt = question.referenceText ?? question.promptText ?? question.answerText ?? `第 ${question.position} 题`;
        const questionStatus = question.reviewStatus === "REVIEWED" ? "已批改" : question.reviewStatus === "PENDING_REVIEW" ? "待批改" : "未提交";
        return <View key={`${question.sourceKind}-${question.questionId}`} style={styles.chatMessage}>
          <Text style={styles.chatLabel}>第 {question.position} 题</Text>
          <Pressable disabled={!question.submissionId} style={({ pressed }) => [styles.staffReviewQuestion, pressed && styles.pressedState]} onPress={() => openQuestion(question)}>
            {question.imageUrl ? <Image style={styles.staffReviewImage} resizeMode="contain" source={{ uri: question.imageUrl.startsWith("http") ? question.imageUrl : `${apiBaseUrl}${question.imageUrl}` }} /> : null}
            <View style={styles.staffReviewQuestionBody}>
              <View style={styles.previewHeader}><Text style={[styles.previewTitle, styles.previewTitleInRow]}>{prompt}</Text><Text style={styles.historyStatus}>{questionStatus}</Text></View>
              {question.submittedAnswerText ? <Text style={styles.previewText}>学生答案：{question.submittedAnswerText} · {question.isCorrect ? "自动判题正确" : "自动判题错误"}</Text> : null}
              <View style={styles.staffReviewQuestionFooter}>
                <Text style={styles.previewTag}>{question.submittedAt ? staffDateLabel(question.submittedAt) : "尚未提交"}{question.grade ? ` · 等级 ${question.grade}` : ""}</Text>
                <View style={styles.staffInlineActions}>
                  {question.sampleAudioUrl ? <Pressable accessibilityLabel={`播放第 ${question.position} 题示范音频`} style={styles.smallOutlineIconButton} onPress={(event) => { event.stopPropagation(); play(question.sampleAudioUrl!); }}><Ionicons name="headset-outline" color={colors.text} size={18} /></Pressable> : null}
                  {question.audioUrl ? <Pressable accessibilityLabel={`播放第 ${question.position} 题学生录音`} style={styles.smallOutlineIconButton} onPress={(event) => { event.stopPropagation(); play(question.audioUrl!); }}><Ionicons name="volume-high-outline" color={colors.text} size={18} /></Pressable> : null}
                  {question.submissionId ? <Ionicons name="chevron-forward" color={colors.muted} size={20} /> : null}
                </View>
              </View>
              <AssessmentSummary assessment={question.assessment} compact providerConfigured={providerConfigured} />
            </View>
          </Pressable>
        </View>;
      })}
      <View style={styles.completedBanner}><Text style={styles.completedText}>{status.label} · 已批改 {conversation.reviewedCount}/{conversation.submittedCount}</Text></View>
      {nextPendingOccurrence ? <Pressable style={({ pressed }) => [styles.primaryCommandButton, pressed && styles.pressedState]} onPress={() => onOpenNext?.(nextPendingOccurrence.occurrenceId)}><Ionicons name="arrow-forward-circle-outline" color={colors.text} size={19} /><Text style={styles.primaryButtonText}>下一份待批改：{nextPendingOccurrence.studentName}</Text></Pressable> : null}
      {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
    </ScrollView>
    <Modal visible={selected !== null} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
      <SafeAreaView style={styles.modalSafeArea}><View style={styles.modalBackdrop}><View style={styles.readingModal}>{selected ? <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
        <View style={styles.modalTopRow}><Text style={styles.modalPage}>第 {selected.position} 题 · {selected.reviewStatus === "REVIEWED" ? "重新批改" : "人工批改"}</Text><Pressable accessibilityLabel="关闭批改" style={styles.headerIconButton} onPress={() => setSelected(null)}><Ionicons name="close" color={colors.text} size={22} /></Pressable></View>
        {selected.imageUrl ? <Image style={styles.cardImage} resizeMode="contain" source={{ uri: selected.imageUrl.startsWith("http") ? selected.imageUrl : `${apiBaseUrl}${selected.imageUrl}` }} /> : null}
        <Text style={styles.practiceModalPrompt}>{selected.referenceText ?? selected.promptText ?? selected.answerText}</Text>
        {selected.submittedAnswerText ? <Text style={styles.chatTeacherText}>学生答案：{selected.submittedAnswerText}</Text> : null}
        {selected.isCorrect !== null ? <Text style={styles.recordingHint}>自动判题：{selected.isCorrect ? "正确" : "错误"}</Text> : null}
        {selected.audioUrl ? <Pressable accessibilityLabel="播放学生录音" style={styles.teacherAudioButton} onPress={() => play(selected.audioUrl!)}><Ionicons name="volume-high-outline" color={colors.text} size={24} /></Pressable> : null}
        <AssessmentSummary assessment={selected.assessment} providerConfigured={providerConfigured} />
        <Text style={styles.modalPage}>人工等级</Text>
        <View style={styles.gradePicker}>{(["SSS", "SS", "S", "A", "B"] as const).map((item) => <Pressable key={item} accessibilityLabel={`选择 ${item} 等级`} style={[styles.gradeChoice, grade === item && styles.gradeChoiceActive]} onPress={() => setGrade(item)}><Text style={styles.gradeChoiceText}>{item}</Text></Pressable>)}</View>
        <View style={styles.modalControls}>{recorderState.isRecording ? <Pressable accessibilityLabel="停止点评录音" style={styles.iconButtonRecord} onPress={stopRecording}><Ionicons name="stop" color={colors.text} size={19} /></Pressable> : <Pressable accessibilityLabel="录制老师点评" style={styles.iconButtonRecord} onPress={startRecording}><Ionicons name="mic-outline" color={colors.text} size={23} /></Pressable>}<Pressable accessibilityLabel="提交老师批改" style={[styles.iconButtonSubmit, isSubmitting && styles.primaryButtonDisabled]} disabled={isSubmitting} onPress={submitReview}>{isSubmitting ? <ActivityIndicator color={colors.text} /> : <Ionicons name="send" color={colors.text} size={20} />}</Pressable></View>
        {recorderState.isRecording ? <Text style={styles.recordingHint}>正在录制点评 {Math.ceil(recorderState.durationMillis / 1000)} 秒</Text> : recordedUri ? <Text style={styles.recordingHint}>点评已录制，可以提交。</Text> : null}
        {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
      </ScrollView> : null}</View></View></SafeAreaView>
    </Modal>
  </View>;
}

function TeacherReviewWorkspace({ token, userId, displayName, role, onLogout }: { token: string; userId: string; displayName: string; role: StaffRole; onLogout: () => void }) {
  const [groups, setGroups] = useState<StaffHomeworkSubmissionGroup[]>([]);
  const [conversations, setConversations] = useState<StaffHomeworkSubmissionConversation[]>([]);
  const [reviewMode, setReviewMode] = useState<"PENDING" | "ALL">("PENDING");
  const [studentSearchInput, setStudentSearchInput] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [dateFilters, setDateFilters] = useState({ submittedFrom: "", submittedTo: "" });
  const [draftDateFilters, setDraftDateFilters] = useState(dateFilters);
  const [filterMessage, setFilterMessage] = useState("");
  const [filterVisible, setFilterVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<StaffHomeworkSubmissionGroup | null>(null);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string | null>(null);
  const [groupPage, setGroupPage] = useState(0);
  const [groupTotal, setGroupTotal] = useState(0);
  const [conversationPage, setConversationPage] = useState(0);
  const [conversationTotal, setConversationTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [message, setMessage] = useState("");
  const [teacherMode, setTeacherMode] = useState<"REVIEW" | "PUBLISH_CHOICE" | "PUBLISH_NEW" | "PUBLISH_TEMPLATE" | "LIBRARY" | "HISTORY" | "CLASSROOMS">("REVIEW");
  const [publishTemplateId, setPublishTemplateId] = useState<string | null>(null);
  const [libraryBackMode, setLibraryBackMode] = useState<"REVIEW" | "PUBLISH_CHOICE">("REVIEW");
  const [staffContext, setStaffContext] = useState<StaffContext | null>(null);

  const loadGroups = async (nextPage = 1, silent = false) => {
    if (!silent) nextPage === 1 ? setIsLoading(true) : setIsLoadingMore(true);
    try {
      const body = await getStaffHomeworkSubmissionGroups(token, { page: nextPage, pageSize: 30, reviewMode, studentSearch: studentSearch || undefined });
      setGroups((current) => nextPage === 1
        ? body.groups
        : [...current, ...body.groups.filter((group) => !current.some((item) => item.homeworkId === group.homeworkId))]);
      setGroupPage(body.pagination.page);
      setGroupTotal(body.pagination.total);
      if (!silent) setMessage("");
    } catch (cause) {
      if (!silent) setMessage(cause instanceof ApiError ? cause.message : "无法加载学生作业分组");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  const loadConversations = async (nextPage = 1, silent = false) => {
    if (!selectedGroup) return;
    if (!silent) nextPage === 1 ? setIsLoading(true) : setIsLoadingMore(true);
    try {
      const body = await getStaffHomeworkSubmissionConversations(token, {
        page: nextPage,
        pageSize: 50,
        homeworkId: selectedGroup.homeworkId,
        reviewMode,
        studentSearch: studentSearch || undefined,
        submittedFrom: dateFilters.submittedFrom ? shanghaiDateRangeValue(dateFilters.submittedFrom, false) ?? undefined : undefined,
        submittedTo: dateFilters.submittedTo ? shanghaiDateRangeValue(dateFilters.submittedTo, true) ?? undefined : undefined,
      });
      setConversations((current) => nextPage === 1
        ? body.conversations
        : [...current, ...body.conversations.filter((conversation) => !current.some((item) => item.occurrenceId === conversation.occurrenceId))]);
      setConversationPage(body.pagination.page);
      setConversationTotal(body.pagination.total);
      if (!silent) setMessage("");
    } catch (cause) {
      if (!silent) setMessage(cause instanceof ApiError ? cause.message : "无法加载学生作业列表");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    if (teacherMode === "REVIEW") void loadGroups(1);
  }, [token, reviewMode, studentSearch, teacherMode]);
  useEffect(() => {
    if (selectedGroup) void loadConversations(1);
  }, [token, selectedGroup?.homeworkId, reviewMode, studentSearch, dateFilters.submittedFrom, dateFilters.submittedTo]);
  useEffect(() => {
    void getStaffContext(token)
      .then(setStaffContext)
      .catch((cause) => setMessage(cause instanceof ApiError ? cause.message : "无法加载老师工作台上下文"));
  }, [token]);

  const effectiveRole = (staffContext?.user.role === "ADMIN" || staffContext?.user.role === "TEACHER" ? staffContext.user.role : undefined) ?? role;
  const providerConfigured = staffContext?.speechAssessment.configured ?? true;
  const activeDateFilterCount = Object.values(dateFilters).filter(Boolean).length;
  const nextPendingOccurrence = selectedOccurrenceId
    ? conversations.find((conversation) => conversation.occurrenceId !== selectedOccurrenceId && conversation.reviewStatus === "PENDING_REVIEW") ?? null
    : null;

  const openTemplatePublish = (templateId: string) => {
    setPublishTemplateId(templateId);
    setTeacherMode("PUBLISH_TEMPLATE");
  };
  const goMenu = (mode: typeof teacherMode) => {
    setMenuVisible(false);
    setSelectedGroup(null);
    setSelectedOccurrenceId(null);
    setTeacherMode(mode);
  };
  const submitStudentSearch = () => setStudentSearch(studentSearchInput.trim());
  const clearStudentSearch = () => { setStudentSearchInput(""); setStudentSearch(""); };
  const openDateFilters = () => { setDraftDateFilters(dateFilters); setFilterMessage(""); setFilterVisible(true); };
  const applyDateFilters = () => {
    if (draftDateFilters.submittedFrom && !shanghaiDateRangeValue(draftDateFilters.submittedFrom, false)) return setFilterMessage("开始日期格式应为 YYYY-MM-DD");
    if (draftDateFilters.submittedTo && !shanghaiDateRangeValue(draftDateFilters.submittedTo, true)) return setFilterMessage("结束日期格式应为 YYYY-MM-DD");
    if (draftDateFilters.submittedFrom && draftDateFilters.submittedTo && draftDateFilters.submittedFrom > draftDateFilters.submittedTo) return setFilterMessage("开始日期不能晚于结束日期");
    setDateFilters(draftDateFilters);
    setFilterVisible(false);
  };

  const renderMenu = () => <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}><SafeAreaView style={styles.modalSafeArea}><Pressable accessibilityLabel="关闭功能菜单" style={styles.menuBackdrop} onPress={() => setMenuVisible(false)}><Pressable style={styles.teacherMenuPanel} onPress={(event) => event.stopPropagation()}>
    {([
      ["REVIEW", "学生作业", "checkmark-done-outline"],
      ["HISTORY", "已发布作业", "time-outline"],
      ["LIBRARY", "作业库", "library-outline"],
      ["CLASSROOMS", "班级管理", "people-outline"],
    ] as const).map(([mode, label, icon]) => <Pressable key={mode} style={({ pressed }) => [styles.teacherMenuItem, pressed && styles.pressedState]} onPress={() => { if (mode === "LIBRARY") setLibraryBackMode("REVIEW"); goMenu(mode); }}><Ionicons name={icon} color={colors.text} size={20} /><Text style={styles.teacherMenuText}>{label}</Text></Pressable>)}
    <Pressable style={({ pressed }) => [styles.teacherMenuItem, styles.teacherMenuLogout, pressed && styles.pressedState]} onPress={() => { setMenuVisible(false); onLogout(); }}><Ionicons name="log-out-outline" color={colors.text} size={20} /><Text style={styles.teacherMenuText}>退出登录</Text></Pressable>
  </Pressable></Pressable></SafeAreaView></Modal>;

  if (teacherMode === "PUBLISH_CHOICE") return <TeacherPublishChoiceWorkspace onNew={() => setTeacherMode("PUBLISH_NEW")} onLibrary={() => { setLibraryBackMode("PUBLISH_CHOICE"); setTeacherMode("LIBRARY"); }} onBack={() => setTeacherMode("REVIEW")} onLogout={onLogout} />;
  if (teacherMode === "PUBLISH_NEW") return <TeacherPublishWorkspace token={token} userId={userId} role={effectiveRole} onBack={() => setTeacherMode("PUBLISH_CHOICE")} onLogout={onLogout} />;
  if (teacherMode === "PUBLISH_TEMPLATE" && publishTemplateId) return <TeacherTemplateAssignmentWorkspace token={token} role={effectiveRole} templateId={publishTemplateId} onBack={() => setTeacherMode("LIBRARY")} onLogout={onLogout} />;
  if (teacherMode === "LIBRARY") return <><TeacherHomeworkLibraryWorkspace token={token} userId={userId} role={effectiveRole} onBack={() => setTeacherMode(libraryBackMode)} onOpenMenu={libraryBackMode === "REVIEW" ? () => setMenuVisible(true) : undefined} onUseTemplate={openTemplatePublish} onLogout={onLogout} />{renderMenu()}</>;
  if (teacherMode === "HISTORY") return <><TeacherHomeworkHistory token={token} onOpenMenu={() => setMenuVisible(true)} onReuseTemplate={openTemplatePublish} onLogout={onLogout} />{renderMenu()}</>;
  if (teacherMode === "CLASSROOMS") return <><TeacherClassroomWorkspace token={token} role={effectiveRole} onOpenMenu={() => setMenuVisible(true)} onLogout={onLogout} />{renderMenu()}</>;
  if (selectedOccurrenceId) return <TeacherHomeworkSubmissionDetail token={token} occurrenceId={selectedOccurrenceId} providerConfigured={providerConfigured} onBack={() => setSelectedOccurrenceId(null)} onUpdated={() => { void loadGroups(1, true); void loadConversations(1, true); }} nextPendingOccurrence={nextPendingOccurrence} onOpenNext={(occurrenceId) => setSelectedOccurrenceId(occurrenceId)} />;

  const header = (title: string, onBack?: () => void) => <View style={styles.readingHeader}>
    <Pressable accessibilityLabel={onBack ? "返回学生作业" : "打开功能菜单"} style={styles.headerIconButton} onPress={onBack ?? (() => setMenuVisible(true))}><Ionicons name={onBack ? "chevron-back" : "menu-outline"} color={colors.text} size={24} /></Pressable>
    <Text numberOfLines={1} style={styles.readingTitle}>{title}</Text>
    <View style={styles.teacherHeaderActions}><Pressable accessibilityLabel="发布作业" style={styles.headerIconButton} onPress={() => setTeacherMode("PUBLISH_CHOICE")}><Ionicons name="add-circle-outline" color={colors.text} size={23} /></Pressable><Pressable accessibilityLabel="刷新" style={styles.headerIconButton} onPress={() => selectedGroup ? void loadConversations(1) : void loadGroups(1)}><Ionicons name="refresh-outline" color={colors.text} size={21} /></Pressable></View>
  </View>;

  if (selectedGroup) {
    return <View style={styles.screen}>
      {header(selectedGroup.title, () => { setSelectedGroup(null); setConversations([]); })}
      <ScrollView contentContainerStyle={styles.staffReviewListContent} keyboardShouldPersistTaps="handled">
        <View style={styles.staffPageSummary}><View style={styles.previewTitleInRow}><Text style={[styles.sectionTitle, styles.homeworkSectionTitle]}>学生作业列表</Text><Text style={styles.previewText}>{selectedGroup.classroomName ?? "未限定班级"} · {reviewMode === "PENDING" ? "待批改" : "历史"}</Text></View><Pressable accessibilityLabel="筛选提交日期" style={[styles.headerIconButton, activeDateFilterCount > 0 && styles.headerIconButtonActive]} onPress={openDateFilters}><Ionicons name="calendar-outline" color={colors.text} size={21} /></Pressable></View>
        <View style={styles.staffReviewCardList}>{isLoading ? <ActivityIndicator color={colors.text} /> : null}{!isLoading && conversations.length === 0 ? <Text style={styles.emptyHomework}>没有符合条件的学生作业。</Text> : null}{conversations.map((conversation) => {
          const status = reviewConversationStatus(conversation);
          return <Pressable key={conversation.occurrenceId} style={({ pressed }) => [styles.previewRow, pressed && styles.pressedState]} onPress={() => setSelectedOccurrenceId(conversation.occurrenceId)}>
            <View style={styles.previewHeader}><View style={styles.previewTitleInRow}><Text style={styles.previewTitle}>{conversation.studentName}</Text><Text style={styles.previewText}>{templateLabels[conversation.templateType]} · {staffDateLabel(conversation.latestSubmittedAt)}</Text></View><View style={styles.homeworkStatusSummary}><Text style={styles.homeworkStatusProgress}>批改 {conversation.reviewedCount}/{conversation.submittedCount}</Text><View style={styles.homeworkStatus}><Ionicons name={status.icon} color={status.color} size={15} /><Text style={[styles.homeworkStatusText, { color: status.color }]}>{status.label}</Text></View></View></View>
            <View style={styles.homeworkFooter}><Text style={styles.homeworkAction}>提交进度 {conversation.submittedCount}/{conversation.totalCount}</Text><Ionicons name="chevron-forward" color={colors.muted} size={20} /></View>
          </Pressable>;
        })}</View>
        {conversations.length < conversationTotal ? <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressedState]} disabled={isLoadingMore} onPress={() => void loadConversations(conversationPage + 1)}>{isLoadingMore ? <ActivityIndicator color={colors.text} /> : <Text style={styles.secondaryButtonText}>加载更多</Text>}</Pressable> : null}
        {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
      </ScrollView>
      {renderMenu()}
      <Modal visible={filterVisible} transparent animationType="slide" onRequestClose={() => setFilterVisible(false)}><SafeAreaView style={styles.modalSafeArea}><View style={styles.modalBackdrop}><View style={[styles.readingModal, styles.staffFilterModal]}><View style={styles.modalTopRow}><Text style={styles.sectionTitle}>筛选提交时间</Text><Pressable accessibilityLabel="关闭筛选" style={styles.headerIconButton} onPress={() => setFilterVisible(false)}><Ionicons name="close" color={colors.text} size={22} /></Pressable></View><ScrollView style={styles.modalScroll} contentContainerStyle={styles.staffFilterContent} keyboardShouldPersistTaps="handled"><View style={styles.staffDateFilterRow}><TextInput style={styles.staffDateInput} value={draftDateFilters.submittedFrom} onChangeText={(submittedFrom) => setDraftDateFilters((current) => ({ ...current, submittedFrom }))} placeholder="开始 YYYY-MM-DD" placeholderTextColor={colors.faint} /><TextInput style={styles.staffDateInput} value={draftDateFilters.submittedTo} onChangeText={(submittedTo) => setDraftDateFilters((current) => ({ ...current, submittedTo }))} placeholder="结束 YYYY-MM-DD" placeholderTextColor={colors.faint} /></View>{filterMessage ? <Text style={styles.error}>{filterMessage}</Text> : null}<View style={styles.confirmActions}><Pressable style={styles.secondaryCommandButton} onPress={() => { setDraftDateFilters({ submittedFrom: "", submittedTo: "" }); setFilterMessage(""); }}><Text style={styles.secondaryButtonText}>重置</Text></Pressable><Pressable style={styles.primaryCommandButton} onPress={applyDateFilters}><Ionicons name="checkmark" color={colors.text} size={19} /><Text style={styles.primaryButtonText}>应用</Text></Pressable></View></ScrollView></View></View></SafeAreaView></Modal>
    </View>;
  }

  return <View style={styles.screen}>
    {header("学生作业")}
    <ScrollView contentContainerStyle={styles.staffReviewListContent} keyboardShouldPersistTaps="handled">
      <View style={styles.staffSearchRow}><View style={styles.staffSearchField}><Ionicons name="search-outline" color={colors.faint} size={19} /><TextInput accessibilityLabel="按学生姓名搜索" style={styles.staffAutocompleteInput} value={studentSearchInput} onChangeText={setStudentSearchInput} placeholder="搜索学生姓名" placeholderTextColor={colors.faint} returnKeyType="search" onSubmitEditing={submitStudentSearch} />{studentSearch ? <Pressable accessibilityLabel="清空学生搜索" style={styles.staffAutocompleteClear} onPress={clearStudentSearch}><Ionicons name="close-circle" color={colors.faint} size={20} /></Pressable> : null}</View><Pressable style={styles.searchSubmitButton} onPress={submitStudentSearch}><Text style={styles.secondaryButtonText}>搜索</Text></Pressable></View>
      <View style={styles.mobileSegment}><Pressable style={[styles.mobileSegmentOption, reviewMode === "PENDING" && styles.mobileSegmentActive]} onPress={() => setReviewMode("PENDING")}><Text style={styles.modeText}>待批改</Text></Pressable><Pressable style={[styles.mobileSegmentOption, reviewMode === "ALL" && styles.mobileSegmentActive]} onPress={() => setReviewMode("ALL")}><Text style={styles.modeText}>历史</Text></Pressable></View>
      <View style={styles.homeworkSectionHeader}><View><Text style={[styles.sectionTitle, styles.homeworkSectionTitle]}>发布实例</Text><Text style={styles.previewText}>{displayName} · 共 {groupTotal} 组</Text></View></View>
      {isLoading ? <ActivityIndicator color={colors.text} /> : null}
      {!isLoading && groups.length === 0 ? <Text style={styles.emptyHomework}>没有符合条件的发布作业。</Text> : null}
      {groups.map((group) => <Pressable key={group.homeworkId} accessibilityLabel={`查看 ${group.title} 的学生作业`} style={({ pressed }) => [styles.staffHistoryCard, pressed && styles.pressedState]} onPress={() => setSelectedGroup(group)}>
        <View style={styles.staffHistoryTitleRow}><View style={styles.checkinDetails}><Text style={styles.previewTitle}>{group.title}</Text><Text style={styles.previewText}>{group.classroomName ?? "未限定班级"} · {staffTemplateLabel(group.templateType)}</Text></View><Ionicons name="chevron-forward" color={colors.muted} size={20} /></View>
        <View style={styles.staffMetricGrid}><View style={styles.staffMetricPill}><Text style={styles.staffMetricValue}>{group.pendingReviewCount}</Text><Text style={styles.staffMetricLabel}>未批改</Text></View><View style={styles.staffMetricPill}><Text style={styles.staffMetricValue}>{group.submittedOccurrenceCount}</Text><Text style={styles.staffMetricLabel}>已交学生作业</Text></View><View style={styles.staffMetricPill}><Text style={styles.staffMetricValue}>{group.assignedStudentCount}</Text><Text style={styles.staffMetricLabel}>学生数</Text></View></View>
        <Text style={styles.previewTag}>题目批改 {group.reviewedQuestionCount}/{group.submittedQuestionCount} · 最近提交 {group.latestSubmittedAt ? staffDateLabel(group.latestSubmittedAt) : "暂无"}</Text>
      </Pressable>)}
      {groups.length < groupTotal ? <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressedState]} disabled={isLoadingMore} onPress={() => void loadGroups(groupPage + 1)}>{isLoadingMore ? <ActivityIndicator color={colors.text} /> : <Text style={styles.secondaryButtonText}>加载更多</Text>}</Pressable> : null}
      {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
    </ScrollView>
    {renderMenu()}
  </View>;
}

function TeacherPublishWorkspace({
  token,
  userId,
  role,
  createOnly = false,
  onBack,
  onCompleted,
  onLogout,
}: {
  token: string;
  userId: string;
  role: StaffRole;
  createOnly?: boolean;
  onBack: () => void;
  onCompleted?: () => void;
  onLogout: () => void;
}) {
  const [students, setStudents] = useState<StaffStudent[]>([]);
  const [classrooms, setClassrooms] = useState<StaffClassroom[]>([]);
  const [selectedClassroomId, setSelectedClassroomId] = useState<string | null>(null);
  const [publishMode, setPublishMode] = useState<"CLASSROOM" | "UNSCOPED">(role === "ADMIN" ? "UNSCOPED" : "CLASSROOM");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [templateType, setTemplateType] = useState<HomeworkTemplateType>("READ_ALOUD_PICTURE_BOOK");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [items, setItems] = useState<HomeworkDraftItem[]>([]);
  const [unit, setUnit] = useState<"DAY" | "WEEK">("WEEK");
  const [interval, setInterval] = useState("1");
  const [occurrenceLimit, setOccurrenceLimit] = useState("4");
  const [startsAt, setStartsAt] = useState(shanghaiInputFromDate());
  const [uploadingCardId, setUploadingCardId] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [message, setMessage] = useState("");
  const [isDraftRestored, setIsDraftRestored] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const previewPlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const sampleRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const sampleRecorderState = useAudioRecorderState(sampleRecorder);
  const [recordingItemId, setRecordingItemId] = useState<string | null>(null);

  useEffect(() => {
    if (createOnly) return;
    if (role !== "ADMIN") setPublishMode("CLASSROOM");
  }, [createOnly, role]);

  useEffect(() => {
    if (createOnly) return;
    const loadScope = async () => {
      try {
        const classroomBody = await getStaffClassrooms(token);
        const activeClassrooms = classroomBody.classrooms.filter((classroom) => isActiveStatus(classroom.status));
        setClassrooms(activeClassrooms);
        if (role === "ADMIN") {
          const studentBody = await getStaffStudents(token);
          setStudents(studentBody.users.filter((student) => !student.status || isActiveStatus(student.status)));
        } else if (activeClassrooms.length === 1) {
          setSelectedClassroomId((current) => current ?? activeClassrooms[0].id);
        } else if (activeClassrooms.length === 0) {
          setMessage("当前没有可发布作业的活跃班级。");
        }
      } catch (cause) {
        setMessage(cause instanceof ApiError ? cause.message : "无法加载班级和学生列表");
      }
    };
    void loadScope();
  }, [createOnly, role, token]);

  useEffect(() => {
    void loadHomeworkDraft(userId).then((draft) => {
      if (draft) {
        setPublishMode(role === "ADMIN" && !draft.classroomId ? "UNSCOPED" : "CLASSROOM");
        setSelectedClassroomId(draft.classroomId);
        setTemplateType(draft.templateType);
        setTitle(draft.title);
        setInstructions(draft.instructions);
        setItems(draft.items);
        setSelectedIds(draft.selectedIds);
        setStartsAt(draft.startsAt || shanghaiInputFromDate());
        setUnit(draft.unit);
        setInterval(draft.interval);
        setOccurrenceLimit(draft.occurrenceLimit);
        setMessage("已恢复上次未发布的作业草稿。");
      }
      setIsDraftRestored(true);
    });
  }, [userId]);

  useEffect(() => {
    if (!isDraftRestored) return;
    const timer = setTimeout(() => {
      const classroomId = publishMode === "CLASSROOM" ? selectedClassroomId : null;
      const draft = { classroomId, templateType, title, instructions, items, selectedIds, startsAt, unit, interval, occurrenceLimit };
      const hasContent = title.trim() || instructions.trim() || items.length > 0 || selectedIds.length > 0;
      void (hasContent ? saveHomeworkDraft(userId, draft) : clearHomeworkDraft(userId));
    }, 500);
    return () => clearTimeout(timer);
  }, [instructions, interval, isDraftRestored, items, occurrenceLimit, publishMode, selectedClassroomId, selectedIds, startsAt, templateType, title, unit, userId]);

  useEffect(() => () => previewPlayerRef.current?.remove(), []);

  const selectedClassroom = selectedClassroomId ? classrooms.find((classroom) => classroom.id === selectedClassroomId) ?? null : null;
  const availableStudents = publishMode === "UNSCOPED"
    ? students
    : selectedClassroom?.students.filter((student) => isActiveStatus(student.status)) ?? [];
  const availableStudentIds = new Set(availableStudents.map((student) => student.id));

  useEffect(() => {
    setSelectedIds((current) => current.filter((studentId) => availableStudentIds.has(studentId)));
  }, [Array.from(availableStudentIds).sort().join("|")]);

  const addItem = () => {
    if (recordingItemId || isPublishing) return setMessage("请先完成当前操作。");
    setItems((current) => [...current, {
      id: `${Date.now()}-${current.length}`,
      imageUrl: "",
      sampleAudioUrl: "",
      imageLocalUri: "",
      imageMimeType: "",
      audioLocalUri: "",
      audioMimeType: "",
      imageName: "",
      audioName: "",
      referenceText: "",
      promptText: "",
      answerText: "",
      choicesText: "",
    }]);
  };
  const selectPublishTemplate = (type: HomeworkTemplateType) => {
    if (recordingItemId) return setMessage("请先停止当前示范录音。");
    setTemplateType(type);
    setPreviewIndex(null);
  };
  const removeItem = (itemId: string) => {
    if (recordingItemId || isPublishing) return setMessage("请先完成当前操作。");
    const item = items.find((entry) => entry.id === itemId);
    if (item) {
      removeHomeworkDraftAsset(userId, item.imageLocalUri);
      removeHomeworkDraftAsset(userId, item.audioLocalUri);
    }
    setItems((current) => current.filter((entry) => entry.id !== itemId));
  };
  const updateItem = (itemId: string, patch: Partial<HomeworkDraftItem>) => setItems((current) => current.map((item) => item.id === itemId ? { ...item, ...patch } : item));
  const toggleStudent = (studentId: string) => setSelectedIds((current) => current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId]);
  const resolveDraftAsset = (localUri: string, uploadedUrl: string) => {
    if (localUri) return localUri;
    if (!uploadedUrl || uploadedUrl.startsWith("http")) return uploadedUrl;
    return `${apiBaseUrl}${uploadedUrl}`;
  };

  async function chooseAsset(itemId: string, field: "image" | "audio") {
    if (recordingItemId) return setMessage("请先停止当前示范录音。");
    if (isPublishing) return setMessage("作业正在发布，请稍候。");
    setMessage("");
    try {
      if (field === "image") {
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
        if (result.canceled) return;
        const asset = result.assets[0];
        const name = asset.fileName ?? `练习图片-${Date.now()}.jpg`;
        const mimeType = asset.mimeType ?? "image/jpeg";
        const localUri = persistHomeworkDraftAsset(userId, itemId, "image", { uri: asset.uri, name, mimeType });
        const previousUri = items.find((item) => item.id === itemId)?.imageLocalUri ?? "";
        updateItem(itemId, {
          imageUrl: "",
          imageLocalUri: localUri,
          imageMimeType: mimeType,
          imageName: name,
        });
        removeHomeworkDraftAsset(userId, previousUri);
        setMessage("图片已加入作业草稿。");
      } else {
        const result = await DocumentPicker.getDocumentAsync({ type: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/webm", "audio/ogg"], copyToCacheDirectory: true });
        if (result.canceled) return;
        const asset = result.assets[0];
        const mimeType = asset.mimeType ?? "audio/mpeg";
        const localUri = persistHomeworkDraftAsset(userId, itemId, "audio", { uri: asset.uri, name: asset.name, mimeType });
        const previousUri = items.find((item) => item.id === itemId)?.audioLocalUri ?? "";
        updateItem(itemId, {
          sampleAudioUrl: "",
          audioLocalUri: localUri,
          audioMimeType: mimeType,
          audioName: asset.name,
        });
        removeHomeworkDraftAsset(userId, previousUri);
        setMessage("本地录音已加入作业草稿，可以试听或更换。");
      }
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "无法读取所选素材，请重新选择。");
    }
  }

  const playSampleAudio = (url: string) => {
    if (!url) return;
    previewPlayerRef.current?.remove();
    const isLocalUrl = /^(blob:|content:|data:|file:)/.test(url);
    const player = createAudioPlayer(url.startsWith("http") || isLocalUrl ? url : `${apiBaseUrl}${url}`);
    previewPlayerRef.current = player;
    player.play();
  };

  async function startSampleRecording(itemId: string) {
    if (recordingItemId || uploadingCardId) return;
    setMessage("");
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) return setMessage("请允许麦克风权限后再录制示范音频。");
      previewPlayerRef.current?.remove();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await sampleRecorder.prepareToRecordAsync();
      sampleRecorder.record();
      setRecordingItemId(itemId);
      setMessage("正在录制示范音频，完成后点击停止。");
    } catch {
      setMessage("示范录音无法开始，请稍后重试。");
    }
  }

  async function stopSampleRecording() {
    const itemId = recordingItemId;
    if (!itemId) return;
    setRecordingItemId(null);
    try {
      await sampleRecorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = sampleRecorder.uri;
      if (!uri) throw new ApiError("没有获得录音文件，请重新录音。", "AUDIO_REQUIRED");
      const mimeType = Platform.OS === "web" ? "audio/webm" : "audio/mp4";
      const name = `sample-recording-${Date.now()}.${Platform.OS === "web" ? "webm" : "m4a"}`;
      const localUri = persistHomeworkDraftAsset(userId, itemId, "audio", { uri, name, mimeType });
      const previousUri = items.find((item) => item.id === itemId)?.audioLocalUri ?? "";
      updateItem(itemId, {
        sampleAudioUrl: "",
        audioLocalUri: localUri,
        audioMimeType: mimeType,
        audioName: "现场录音",
      });
      removeHomeworkDraftAsset(userId, previousUri);
      setMessage("示范录音已加入作业草稿，可以试听或重新录音。");
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "示范录音无法保存，请重新录音。");
    } finally {
      setRecordingItemId(null);
    }
  }

  async function publish() {
    setMessage("");
    if (recordingItemId) return setMessage("请先停止当前示范录音。");
    if (uploadingCardId) return setMessage("请等待素材上传完成。");
    const every = Number(interval);
    const times = Number(occurrenceLimit);
    const classroomId = publishMode === "CLASSROOM" ? selectedClassroomId : null;
    if (title.trim().length < 2) return setMessage("请填写至少两个字的作业标题。");
    if (!createOnly) {
      if (publishMode === "CLASSROOM" && !classroomId) return setMessage("请先选择一个活跃班级。");
      if (role !== "ADMIN" && !classroomId) return setMessage("老师发布作业需要选择一个已分配的活跃班级。");
      if (selectedIds.length === 0) return setMessage("请至少选择一名学生。");
      if (selectedIds.some((studentId) => !availableStudentIds.has(studentId))) return setMessage("请只选择当前班级中的活跃学生。");
      if (!Number.isInteger(every) || every < 1 || !Number.isInteger(times) || times < 1) return setMessage("周期和触发次数必须是大于 0 的整数。");
    }
    if (items.length === 0) return setMessage("请至少添加一项练习内容。");
    const choicesFor = (item: HomeworkDraftItem) => item.choicesText.split(/[，,\n]/).map((choice) => choice.trim()).filter(Boolean);
    const hasImage = (item: HomeworkDraftItem) => Boolean(item.imageLocalUri || item.imageUrl);
    const hasAudio = (item: HomeworkDraftItem) => Boolean(item.audioLocalUri || item.sampleAudioUrl);
    if (templateType === "READ_ALOUD_PICTURE_BOOK" && items.some((item) => !hasImage(item) || !hasAudio(item) || !item.referenceText.trim())) return setMessage("每张绘本卡都需要英文原文、图片和示范录音。");
    if (templateType === "SENTENCE_READ_ALOUD" && items.some((item) => !item.promptText.trim() || !hasAudio(item))) return setMessage("每个句子都需要英文内容和示范录音。");
    if (templateType === "WORD_READ_ALOUD" && items.some((item) => !hasImage(item) || !item.answerText.trim() || !hasAudio(item))) return setMessage("每个单词都需要图片、英文单词和示范录音。");
    if (["WORD_IMAGE_MATCH", "WORD_FILL_BLANK"].includes(templateType) && items.some((item) => {
      const normalizedAnswer = item.answerText.trim().toLocaleLowerCase();
      return !hasImage(item) || !normalizedAnswer || choicesFor(item).length < 2 || !choicesFor(item).some((choice) => choice.toLocaleLowerCase() === normalizedAnswer);
    })) return setMessage("选择题需要图片、答案和至少两个选项，且选项中必须包含答案。");
    if (templateType === "WORD_SCRAMBLE" && items.some((item) => !hasImage(item) || !item.answerText.trim())) return setMessage("每道字母排序题都需要图片和答案单词。");
    if (templateType === "WORD_FILL_BLANK" && items.some((item) => !item.promptText.includes("____"))) return setMessage("看图填空的句子必须包含 ____。");
    const startsAtIso = createOnly ? new Date().toISOString() : parseShanghaiDateTime(startsAt);
    if (!startsAtIso) return setMessage("首次开始时间格式应为 YYYY-MM-DD HH:mm。");
    const executePublish = async () => {
      setIsPublishing(true);
      try {
      const publishItems = items.map((item) => ({ ...item }));
      const needsImage = templateType !== "SENTENCE_READ_ALOUD";
      const needsAudio = templateType === "READ_ALOUD_PICTURE_BOOK" || recordingTemplates.includes(templateType);
      for (let index = 0; index < publishItems.length; index += 1) {
        const item = publishItems[index];
        setUploadingCardId(item.id);
        setMessage(`正在上传第 ${index + 1}/${publishItems.length} 项素材...`);
        if (needsImage && !item.imageUrl && item.imageLocalUri) {
          const uploaded = await uploadHomeworkAsset(token, {
            uri: item.imageLocalUri,
            type: item.imageMimeType || "image/jpeg",
            name: item.imageName || `picture-${index + 1}.jpg`,
          });
          if (uploaded.kind !== "image") throw new ApiError("请选择图片文件", "IMAGE_REQUIRED");
          item.imageUrl = uploaded.url;
          setItems(publishItems.map((entry) => ({ ...entry })));
        }
        if (needsAudio && !item.sampleAudioUrl && item.audioLocalUri) {
          const uploaded = await uploadHomeworkAsset(token, {
            uri: item.audioLocalUri,
            type: item.audioMimeType || "audio/mp4",
            name: item.audioName || `sample-${index + 1}.m4a`,
          });
          if (uploaded.kind !== "audio") throw new ApiError("请选择音频文件", "AUDIO_REQUIRED");
          item.sampleAudioUrl = uploaded.url;
          setItems(publishItems.map((entry) => ({ ...entry })));
        }
      }
      setUploadingCardId(null);
      setMessage(createOnly ? "素材上传完成，正在保存到作业库..." : "素材上传完成，正在发布作业...");
      const common = {
        classroomId,
        title: title.trim(), instructions, studentIds: selectedIds,
        schedule: { startsAt: startsAtIso, unit, interval: every, occurrenceLimit: times },
      };
      let result: { homework: { targetCount: number; occurrenceCount: number } } | null = null;
      if (templateType === "READ_ALOUD_PICTURE_BOOK") {
        const cards: HomeworkPublishCard[] = publishItems.map(({ imageUrl, sampleAudioUrl, referenceText }) => ({ imageUrl, sampleAudioUrl, referenceText: referenceText.trim() }));
        if (createOnly) await createStaffHomeworkTemplate(token, { templateType, title: title.trim(), instructions, cards });
        else result = await publishPictureBookHomework(token, { ...common, cards });
      } else {
        const itemsPayload: HomeworkPublishItem[] = publishItems.map((item) => ({
          ...(templateType === "SENTENCE_READ_ALOUD" || templateType === "WORD_FILL_BLANK" ? { promptText: item.promptText.trim() } : {}),
          ...(templateType !== "SENTENCE_READ_ALOUD" ? { imageUrl: item.imageUrl } : {}),
          ...(recordingTemplates.includes(templateType) ? { sampleAudioUrl: item.sampleAudioUrl } : {}),
          ...(templateType.startsWith("WORD_") ? { answerText: item.answerText.trim() } : {}),
          ...(["WORD_IMAGE_MATCH", "WORD_FILL_BLANK"].includes(templateType) ? { choices: choicesFor(item) } : {}),
        }));
        if (createOnly) await createStaffHomeworkTemplate(token, { templateType, title: title.trim(), instructions, items: itemsPayload });
        else result = await publishHomeworkTemplate(token, { ...common, templateType, items: itemsPayload });
      }
      setTitle(""); setInstructions(""); setItems([]); setSelectedIds([]);
      await clearHomeworkDraft(userId);
      if (createOnly) {
        setMessage("已保存到作业库。");
        onCompleted?.();
        return;
      }
      setMessage(`已发布给 ${result?.homework.targetCount ?? 0} 名学生，共生成 ${result?.homework.occurrenceCount ?? 0} 次练习。`);
      } catch (cause) {
        setMessage(cause instanceof ApiError ? cause.message : "本地素材读取或上传失败，请重新选择后再发布。");
      } finally {
        setUploadingCardId(null);
        setIsPublishing(false);
      }
    };
    if (createOnly) {
      await executePublish();
      return;
    }
    const classroomName = classroomId ? classrooms.find((classroom) => classroom.id === classroomId)?.name ?? "已选班级" : "全部授权学生";
    Alert.alert(
      "确认发布作业",
      `内容：${title.trim()}（${templateLabels[templateType]}，${items.length} 项）\n班级：${classroomName}\n人数：${selectedIds.length} 人\n首次时间：${startsAt}\n周期：每 ${every} ${unit === "DAY" ? "天" : "周"}，共 ${times} 次`,
      [
        { text: "继续编辑", style: "cancel" },
        { text: "确认上传并发布", onPress: () => void executePublish() },
      ],
    );
  }

  const previewCard = previewIndex === null ? null : items[previewIndex];
  const previewImageSource = previewCard ? resolveDraftAsset(previewCard.imageLocalUri, previewCard.imageUrl) : "";
  const previewAudioSource = previewCard ? resolveDraftAsset(previewCard.audioLocalUri, previewCard.sampleAudioUrl) : "";
  const showPreview = () => {
    if (recordingItemId) {
      setMessage("请先停止当前示范录音。");
      return;
    }
    if (items.length === 0) {
      setMessage("请先添加练习内容。");
      return;
    }
    setPreviewIndex(0);
  };
  const playPreviewAudio = () => {
    if (!previewAudioSource) return;
    playSampleAudio(previewAudioSource);
  };

  return <View style={styles.screen}>
    <View style={styles.readingHeader}><Pressable accessibilityLabel={createOnly ? "返回作业库" : "返回发布方式"} style={styles.headerIconButton} onPress={onBack}><Ionicons name="chevron-back" color={colors.text} size={23} /></Pressable><Text style={styles.topBrand}>{createOnly ? "新增作业模板" : "发布作业"}</Text><View style={styles.teacherHeaderActions}><Pressable accessibilityLabel="预览作业" style={styles.headerIconButton} onPress={showPreview}><Ionicons name="eye-outline" color={colors.text} size={22} /></Pressable><Pressable accessibilityLabel="退出登录" style={styles.headerIconButton} onPress={onLogout}><Ionicons name="log-out-outline" color={colors.text} size={22} /></Pressable></View></View>
    <ScrollView contentContainerStyle={styles.teacherPublishContent} keyboardShouldPersistTaps="handled">
      <View style={styles.teacherFormSection}><Text style={styles.sectionTitle}>练习模板</Text><View style={styles.templateGrid}>{homeworkTemplateTypes.map((type) => <Pressable key={type} style={[styles.templateOption, templateType === type && styles.templateOptionActive]} onPress={() => selectPublishTemplate(type)}><Text style={[styles.templateOptionText, templateType === type && styles.templateOptionTextActive]}>{templateLabels[type]}</Text></Pressable>)}</View></View>
      <View style={styles.teacherFormSection}><Text style={styles.sectionTitle}>作业内容</Text><TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="作业标题" placeholderTextColor={colors.faint} /><TextInput style={[styles.input, styles.multilineInput]} value={instructions} onChangeText={setInstructions} placeholder="练习说明（可选）" placeholderTextColor={colors.faint} multiline /></View>
      {!createOnly ? <View style={styles.teacherFormSection}><Text style={styles.sectionTitle}>发布范围</Text>{role === "ADMIN" ? <View style={styles.mobileSegment}><Pressable style={[styles.mobileSegmentOption, publishMode === "UNSCOPED" && styles.mobileSegmentActive]} onPress={() => { setPublishMode("UNSCOPED"); setSelectedClassroomId(null); }}><Text style={styles.modeText}>全部授权学生</Text></Pressable><Pressable style={[styles.mobileSegmentOption, publishMode === "CLASSROOM" && styles.mobileSegmentActive]} onPress={() => setPublishMode("CLASSROOM")}><Text style={styles.modeText}>按班级</Text></Pressable></View> : <Text style={styles.previewText}>老师需要先选择一个已分配的活跃班级。</Text>}{publishMode === "CLASSROOM" ? <View style={styles.templateGrid}>{classrooms.length === 0 ? <Text style={styles.emptyHomework}>暂无可发布的活跃班级。</Text> : classrooms.map((classroom) => <Pressable key={classroom.id} style={[styles.templateOption, selectedClassroomId === classroom.id && styles.templateOptionActive]} onPress={() => setSelectedClassroomId(classroom.id)}><Text style={[styles.templateOptionText, selectedClassroomId === classroom.id && styles.templateOptionTextActive]}>{classroom.name}</Text></Pressable>)}</View> : <Text style={styles.previewText}>管理员将从现有授权学生列表中选择收件人。</Text>}</View> : null}
      <View style={styles.teacherFormSection}>
        <View style={styles.teacherSectionHeader}>
          <Text style={styles.sectionTitle}>练习项目</Text>
          <Pressable accessibilityLabel="添加练习项目" style={styles.smallIconButton} onPress={addItem}>
            <Ionicons name="add" color={colors.text} size={20} />
          </Pressable>
        </View>
        {items.length === 0 ? <Text style={styles.emptyHomework}>按顺序添加本次练习内容。</Text> : items.map((item, index) => {
          const imageSource = resolveDraftAsset(item.imageLocalUri, item.imageUrl);
          const audioSource = resolveDraftAsset(item.audioLocalUri, item.sampleAudioUrl);
          const controlsDisabled = isPublishing || Boolean(recordingItemId);
          return <View key={item.id} style={styles.mobileCardDraft}>
            <View style={styles.mobileCardDraftHeader}>
              <Text style={styles.previewTitle}>第 {index + 1} 项</Text>
              <Pressable accessibilityLabel="删除练习项目" style={styles.smallIconButton} onPress={() => removeItem(item.id)}>
                <Ionicons name="trash-outline" color={colors.muted} size={18} />
              </Pressable>
            </View>
            {templateType === "READ_ALOUD_PICTURE_BOOK" ? <TextInput style={styles.input} value={item.referenceText} onChangeText={(value) => updateItem(item.id, { referenceText: value })} autoCapitalize="sentences" placeholder="本页英文原文" placeholderTextColor={colors.faint} /> : null}
            {(templateType === "SENTENCE_READ_ALOUD" || templateType === "WORD_FILL_BLANK") ? <TextInput style={styles.input} value={item.promptText} onChangeText={(value) => updateItem(item.id, { promptText: value })} placeholder={templateType === "SENTENCE_READ_ALOUD" ? "英文句子" : "含 ____ 的英文句子"} placeholderTextColor={colors.faint} /> : null}
            {templateType.startsWith("WORD_") ? <TextInput style={styles.input} value={item.answerText} onChangeText={(value) => updateItem(item.id, { answerText: value })} autoCapitalize="none" placeholder="英文答案单词" placeholderTextColor={colors.faint} /> : null}
            {["WORD_IMAGE_MATCH", "WORD_FILL_BLANK"].includes(templateType) ? <TextInput style={[styles.input, styles.multilineInput]} value={item.choicesText} onChangeText={(value) => updateItem(item.id, { choicesText: value })} placeholder="选项，用逗号或换行分隔" placeholderTextColor={colors.faint} multiline /> : null}
            {templateType !== "SENTENCE_READ_ALOUD" ? <View style={styles.mobileAssetBlock}>
              {imageSource ? <Image style={styles.mobileAssetPreviewImage} resizeMode="contain" source={{ uri: imageSource }} /> : <View style={styles.mobileAssetPlaceholder}><Ionicons name="image-outline" color={colors.faint} size={30} /></View>}
              <View style={styles.mobileCardAssetRow}>
                <Pressable accessibilityLabel={imageSource ? "更换练习图片" : "选择练习图片"} disabled={controlsDisabled} style={({ pressed }) => [styles.assetCommandButton, controlsDisabled && styles.primaryButtonDisabled, pressed && styles.pressedState]} onPress={() => void chooseAsset(item.id, "image")}>
                  <Ionicons name="image-outline" color={colors.text} size={19} />
                  <Text style={styles.assetCommandText}>{imageSource ? "更换图片" : "选择图片"}</Text>
                </Pressable>
                <View style={styles.mobileAssetStatus}><Ionicons name={imageSource ? "checkmark-circle" : "ellipse-outline"} color={imageSource ? colors.text : colors.faint} size={17} /><Text numberOfLines={1} style={styles.assetName}>{item.imageName || "未选择图片"}</Text></View>
              </View>
            </View> : null}
            {(templateType === "READ_ALOUD_PICTURE_BOOK" || recordingTemplates.includes(templateType)) ? <View style={styles.mobileAssetBlock}>
              <View style={styles.mobileAssetActions}>
                <Pressable accessibilityLabel={audioSource ? "重新选择本地示范录音" : "选择本地示范录音"} disabled={controlsDisabled || recordingItemId === item.id} style={({ pressed }) => [styles.assetCommandButton, (controlsDisabled || recordingItemId === item.id) && styles.primaryButtonDisabled, pressed && styles.pressedState]} onPress={() => void chooseAsset(item.id, "audio")}>
                  <Ionicons name="folder-open-outline" color={colors.text} size={19} />
                  <Text style={styles.assetCommandText}>{audioSource ? "更换录音" : "选择录音"}</Text>
                </Pressable>
                {recordingItemId === item.id ? <Pressable accessibilityLabel="停止并使用这段示范录音" style={({ pressed }) => [styles.assetCommandButton, styles.recordingAssetButton, pressed && styles.pressedState]} onPress={() => void stopSampleRecording()}><Ionicons name="stop" color={colors.text} size={18} /><Text style={styles.assetCommandText}>停止</Text></Pressable> : <Pressable accessibilityLabel={audioSource ? "重新录制示范录音" : "现场录制示范录音"} disabled={controlsDisabled} style={({ pressed }) => [styles.assetCommandButton, controlsDisabled && styles.primaryButtonDisabled, pressed && styles.pressedState]} onPress={() => void startSampleRecording(item.id)}><Ionicons name="mic-outline" color={colors.text} size={20} /><Text style={styles.assetCommandText}>{audioSource ? "重新录音" : "现场录音"}</Text></Pressable>}
                {audioSource ? <Pressable accessibilityLabel="试听示范录音" disabled={controlsDisabled || recordingItemId === item.id} style={({ pressed }) => [styles.assetCommandButton, (controlsDisabled || recordingItemId === item.id) && styles.primaryButtonDisabled, pressed && styles.pressedState]} onPress={() => playSampleAudio(audioSource)}><Ionicons name="play-outline" color={colors.text} size={20} /><Text style={styles.assetCommandText}>试听</Text></Pressable> : null}
              </View>
              <View style={styles.mobileAssetStatus}><Ionicons name={audioSource ? "checkmark-circle" : "ellipse-outline"} color={audioSource ? colors.text : colors.faint} size={17} /><Text numberOfLines={1} style={styles.assetName}>{recordingItemId === item.id ? `正在录音 ${Math.ceil(sampleRecorderState.durationMillis / 1000)} 秒` : item.audioName || "未选择示范录音"}</Text></View>
            </View> : null}
            {uploadingCardId === item.id ? <Text style={styles.recordingHint}>正在上传第 {index + 1} 项素材...</Text> : null}
          </View>;
        })}
      </View>
      {!createOnly ? <View style={styles.teacherFormSection}><Text style={styles.sectionTitle}>发布设置</Text><View style={styles.field}><Text style={styles.label}>首次开始时间</Text><TextInput style={styles.input} value={startsAt} onChangeText={setStartsAt} placeholder="YYYY-MM-DD HH:mm" placeholderTextColor={colors.faint} autoCorrect={false} /></View><View style={styles.mobileSegment}><Pressable style={[styles.mobileSegmentOption, unit === "DAY" && styles.mobileSegmentActive]} onPress={() => setUnit("DAY")}><Text style={styles.modeText}>按天</Text></Pressable><Pressable style={[styles.mobileSegmentOption, unit === "WEEK" && styles.mobileSegmentActive]} onPress={() => setUnit("WEEK")}><Text style={styles.modeText}>按周</Text></Pressable></View><View style={styles.mobileNumberRow}><TextInput style={styles.mobileNumberInput} value={interval} onChangeText={setInterval} keyboardType="number-pad" /><Text style={styles.previewText}>每隔 {unit === "DAY" ? "天" : "周"}</Text><TextInput style={styles.mobileNumberInput} value={occurrenceLimit} onChangeText={setOccurrenceLimit} keyboardType="number-pad" /><Text style={styles.previewText}>次</Text></View></View> : null}
      {!createOnly ? <View style={styles.teacherFormSection}><Text style={styles.sectionTitle}>选择学生</Text>{availableStudents.length === 0 ? <Text style={styles.emptyHomework}>{publishMode === "CLASSROOM" ? "请选择含有活跃学生的班级。" : "暂无可选择的授权学生。"}</Text> : availableStudents.map((student) => <Pressable key={student.id} style={[styles.mobileStudentRow, selectedIds.includes(student.id) && styles.mobileStudentRowActive]} onPress={() => toggleStudent(student.id)}><View><Text style={styles.previewTitle}>{student.displayName}</Text><Text style={styles.previewText}>{student.phone}</Text></View>{selectedIds.includes(student.id) ? <Ionicons name="checkmark-circle" color={colors.text} size={21} /> : <Ionicons name="ellipse-outline" color={colors.faint} size={21} />}</Pressable>)}</View> : null}
      <Pressable accessibilityLabel={createOnly ? "保存作业模板" : "发布作业"} style={[styles.mobilePublishButton, (isPublishing || Boolean(recordingItemId) || Boolean(uploadingCardId)) && styles.primaryButtonDisabled]} disabled={isPublishing || Boolean(recordingItemId) || Boolean(uploadingCardId)} onPress={() => void publish()}>{isPublishing ? <ActivityIndicator color={colors.text} /> : <Ionicons name={createOnly ? "save-outline" : "send"} color={colors.text} size={22} />}</Pressable>
      {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
    </ScrollView>
    <Modal visible={previewCard !== null} transparent animationType="slide" onRequestClose={() => setPreviewIndex(null)}>
      <View style={styles.modalBackdrop}>
        <View style={styles.readingModal}>
          {previewCard ? <>
            <View style={styles.modalTopRow}>
              <Text style={styles.modalPage}>预览第 {previewIndex! + 1} / {items.length} 项</Text>
              <Pressable accessibilityLabel="关闭预览" style={styles.headerIconButton} onPress={() => setPreviewIndex(null)}><Ionicons name="close" color={colors.text} size={22} /></Pressable>
            </View>
            {previewImageSource ? <Image style={styles.cardImage} resizeMode="contain" source={{ uri: previewImageSource }} /> : null}
            <Text style={styles.practiceModalPrompt}>{previewCard.referenceText || previewCard.promptText || previewCard.answerText || templateLabels[templateType]}</Text>
            <View style={styles.modalControls}>
              {previewAudioSource ? <Pressable accessibilityLabel="播放示范录音" style={styles.iconButton} onPress={playPreviewAudio}><Ionicons name="headset-outline" color={colors.text} size={21} /></Pressable> : null}
              <Pressable accessibilityLabel="上一项" style={styles.iconButton} disabled={previewIndex === 0} onPress={() => setPreviewIndex((index) => index === null ? null : Math.max(0, index - 1))}><Ionicons name="chevron-back" color={previewIndex === 0 ? colors.faint : colors.text} size={21} /></Pressable>
              <Pressable accessibilityLabel="下一项" style={styles.iconButton} disabled={previewIndex === items.length - 1} onPress={() => setPreviewIndex((index) => index === null ? null : Math.min(items.length - 1, index + 1))}><Ionicons name="chevron-forward" color={previewIndex === items.length - 1 ? colors.faint : colors.text} size={21} /></Pressable>
            </View>
          </> : null}
        </View>
      </View>
    </Modal>
  </View>;
}

function formatLearningDuration(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`;
}

function compactDateLabel(date: string) {
  if (date.length >= 10) return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  return date;
}

function compactChartMinutes(seconds: number) {
  if (seconds === 0) return "0";
  return String(Math.max(1, Math.round(seconds / 60)));
}

function pointEventLabel(event: StudentPointEvent) {
  if (event.type === "DAILY_CHECKIN") return "每日学习打卡";
  if (event.type === "HOMEWORK_COMPLETED") return "完成一次作业";
  if (event.type === "STREAK_BONUS") return "连续打卡奖励";
  return "学习积分";
}

function pointEventSourceText(event: StudentPointEvent) {
  const date = event.occurredAt.slice(0, 10);
  return event.classroomName ? `${date} · ${event.classroomName}` : date;
}

function normalizeRecentDays(days: LearningRecentDay[] | undefined, checkins: LearningCheckin[]) {
  if (days?.length) return days.map((day) => ({
    date: day.checkinDate,
    voiceSeconds: day.voiceSeconds,
    homeworkSeconds: day.homeworkSeconds,
  }));
  return checkins.slice(0, 7).reverse().map((day) => ({
    date: day.checkinDate,
    voiceSeconds: day.voiceSeconds,
    homeworkSeconds: day.homeworkSeconds,
  }));
}

function LearningTrendChart({ days }: { days: Array<{ date: string; voiceSeconds: number; homeworkSeconds: number }> }) {
  const maxSeconds = Math.max(1, ...days.map((day) => Math.max(day.voiceSeconds, day.homeworkSeconds)));
  return <View style={styles.trendChart} accessible accessibilityLabel={`近七日学习趋势，${days.map((day) => `${compactDateLabel(day.date)}口语${formatLearningDuration(day.voiceSeconds)}、作业${formatLearningDuration(day.homeworkSeconds)}`).join("；")}`}>
    <View style={styles.chartLegend}><View style={styles.legendItem}><View style={styles.voiceLegendDot} /><Text style={styles.previewText}>口语（分）</Text></View><View style={styles.legendItem}><View style={styles.homeworkLegendDot} /><Text style={styles.previewText}>作业（分）</Text></View></View>
    <View style={styles.chartBars}>{days.map((day) => {
      const voiceHeight = Math.max(4, Math.round((day.voiceSeconds / maxSeconds) * 112));
      const homeworkHeight = Math.max(4, Math.round((day.homeworkSeconds / maxSeconds) * 112));
      return <View key={day.date} style={styles.chartDay}>
        <View style={styles.chartBarSlot}><View style={[styles.voiceBar, { height: voiceHeight }]} /><View style={[styles.homeworkBar, { height: homeworkHeight }]} /></View>
        <Text style={styles.chartDate}>{compactDateLabel(day.date)}</Text>
        <Text style={styles.chartValue}>{compactChartMinutes(day.voiceSeconds)}/{compactChartMinutes(day.homeworkSeconds)}</Text>
      </View>;
    })}</View>
  </View>;
}

function historyTitle(item: StudentHomeworkHistoryItem) {
  return item.title;
}

function historyProgress(item: StudentHomeworkHistoryItem) {
  return { completed: item.completedCount, total: item.totalCount };
}

function historyReviewText(item: StudentHomeworkHistoryItem) {
  if (item.completedCount > 0) return `人工批改 ${item.reviewedCount}/${item.completedCount}`;
  return "暂无人工批改";
}

function historyStatusText(item: StudentHomeworkHistoryItem) {
  if (item.homeworkStatus === "PAUSED") return "已暂停";
  if (item.homeworkStatus === "ARCHIVED") return "已封存";
  const { completed, total } = historyProgress(item);
  if (item.occurrenceStatus === "COMPLETED" || (total > 0 && completed >= total)) return "已完成";
  return "进行中";
}

function Profile({ user, token, onBack, onLogout, onUserUpdate }: { user: CurrentUser; token: string; onBack: () => void; onLogout: () => void; onUserUpdate: (user: CurrentUser) => Promise<void> }) {
  const [tab, setTab] = useState<ProfileTab>("PROFILE");
  const [profile, setProfile] = useState<StudentProfileResponse | null>(null);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [englishName, setEnglishName] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [learningGoal, setLearningGoal] = useState("");
  const [summary, setSummary] = useState<LearningStatsSummary | null>(null);
  const [checkins, setCheckins] = useState<LearningCheckin[]>([]);
  const [recentDays, setRecentDays] = useState<Array<{ date: string; voiceSeconds: number; homeworkSeconds: number }>>([]);
  const [history, setHistory] = useState<StudentHomeworkHistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [profileMessage, setProfileMessage] = useState("");
  const [statsMessage, setStatsMessage] = useState("");
  const [historyMessage, setHistoryMessage] = useState("");

  const applyProfile = (body: StudentProfileResponse) => {
    setProfile(body);
    setDisplayName(body.user.displayName);
    setEnglishName(body.profile.englishName ?? "");
    setSchoolName(body.profile.schoolName ?? "");
    setGradeLevel(body.profile.gradeLevel ?? "");
    setLearningGoal(body.profile.learningGoal ?? "");
  };

  const loadProfile = () => {
    setIsLoadingProfile(true);
    setProfileMessage("");
    void getStudentProfile(token)
      .then(applyProfile)
      .catch((cause) => setProfileMessage(cause instanceof ApiError ? cause.message : "资料暂时无法加载。"))
      .finally(() => setIsLoadingProfile(false));
  };

  const loadStats = () => {
    setIsLoadingStats(true);
    setStatsMessage("");
    void getStudentLearningStats(token)
      .then((body) => {
        setSummary(body.summary);
        setCheckins(body.checkins);
        setRecentDays(normalizeRecentDays(body.recentDays, body.checkins));
      })
      .catch(() => setStatsMessage("学习记录暂时无法加载，不影响继续练习。"))
      .finally(() => setIsLoadingStats(false));
  };

  const loadHistory = () => {
    setIsLoadingHistory(true);
    setHistoryMessage("");
    void getStudentHomeworkHistory(token, 1, 50)
      .then((body) => {
        setHistory(body.occurrences);
        setHistoryTotal(body.pagination.total);
      })
      .catch((cause) => setHistoryMessage(cause instanceof ApiError ? cause.message : "作业历史暂时无法加载。"))
      .finally(() => setIsLoadingHistory(false));
  };

  useEffect(() => {
    loadProfile();
    loadStats();
    loadHistory();
  }, [token]);

  const saveProfile = async () => {
    setProfileMessage("");
    if (displayName.trim().length < 2) {
      setProfileMessage("姓名至少需要两个字符。");
      return;
    }
    setIsSavingProfile(true);
    try {
      const body = await updateStudentProfile(token, {
        displayName: displayName.trim(),
        englishName: englishName.trim() || null,
        schoolName: schoolName.trim() || null,
        gradeLevel: gradeLevel.trim() || null,
        learningGoal: learningGoal.trim() || null,
      });
      applyProfile(body);
      await onUserUpdate(body.user);
      setProfileMessage("资料已保存。首页会使用新的姓名。");
    } catch (cause) {
      setProfileMessage(cause instanceof ApiError ? cause.message : "资料保存失败，请稍后重试。");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const points = profile?.points;
  const currentLevelPoints = points?.currentLevelPoints ?? 0;
  const nextLevelPoints = points?.nextLevelPoints ?? 100;
  const levelProgress = Math.min(100, Math.round((currentLevelPoints / Math.max(1, nextLevelPoints)) * 100));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <Pressable onPress={onBack}><Text style={styles.textActionLabel}>返回</Text></Pressable>
        <Text style={styles.topBrand}>我的</Text>
        <Pressable accessibilityLabel="退出登录" style={styles.headerIconButton} onPress={onLogout}><Ionicons name="log-out-outline" color={colors.text} size={21} /></Pressable>
      </View>

      <View style={styles.profileCard}>
        <Text style={styles.profileName}>{displayName || user.displayName}</Text>
        <Text style={styles.profilePhone}>{user.phone}</Text>
      </View>

      <View style={styles.mobileSegment}>{(["PROFILE", "LEARNING", "HISTORY"] as const).map((item) => <Pressable key={item} style={[styles.mobileSegmentOption, tab === item && styles.mobileSegmentActive]} onPress={() => setTab(item)}><Text style={[styles.modeText, tab === item && styles.modeTextActive]}>{item === "PROFILE" ? "资料" : item === "LEARNING" ? "学习" : "历史"}</Text></Pressable>)}</View>

      {tab === "PROFILE" ? <View style={styles.settingsSection}>
        <View style={styles.learningHeader}><Text style={styles.sectionTitle}>个人资料</Text><Pressable accessibilityLabel="刷新资料" style={styles.headerIconButton} onPress={loadProfile}><Ionicons name="refresh-outline" color={colors.text} size={20} /></Pressable></View>
        {isLoadingProfile ? <ActivityIndicator color={colors.text} /> : null}
        <View style={styles.readonlyField}><Text style={styles.label}>手机号</Text><Text style={styles.profilePhone}>{user.phone}</Text></View>
        <View style={styles.field}><Text style={styles.label}>姓名或昵称</Text><TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="中文姓名或昵称" placeholderTextColor={colors.faint} maxLength={24} /></View>
        <View style={styles.field}><Text style={styles.label}>英文名</Text><TextInput style={styles.input} value={englishName} onChangeText={setEnglishName} placeholder="可选" placeholderTextColor={colors.faint} autoCapitalize="words" maxLength={24} /></View>
        <View style={styles.field}><Text style={styles.label}>学校</Text><TextInput style={styles.input} value={schoolName} onChangeText={setSchoolName} placeholder="可选" placeholderTextColor={colors.faint} maxLength={60} /></View>
        <View style={styles.field}><Text style={styles.label}>年级</Text><TextInput style={styles.input} value={gradeLevel} onChangeText={setGradeLevel} placeholder="可选" placeholderTextColor={colors.faint} maxLength={20} /></View>
        <View style={styles.field}><Text style={styles.label}>学习目标</Text><TextInput style={[styles.input, styles.multilineInput]} value={learningGoal} onChangeText={setLearningGoal} placeholder="例如：每天读 10 分钟英语" placeholderTextColor={colors.faint} maxLength={160} multiline /></View>
        <Pressable style={[styles.primaryButton, isSavingProfile && styles.primaryButtonDisabled]} disabled={isSavingProfile} onPress={() => void saveProfile()}>{isSavingProfile ? <ActivityIndicator color={colors.text} /> : <Text style={styles.primaryButtonText}>保存资料</Text>}</Pressable>
        {profileMessage ? <Text style={styles.readingMessage}>{profileMessage}</Text> : null}
      </View> : null}

      {tab === "LEARNING" ? <View style={styles.settingsSection}>
        <View style={styles.pointsPanel}>
          <View><Text style={styles.sectionTitle}>成长积分</Text><Text style={styles.previewText}>积分只记录学习成长，不代表现金价值。</Text></View>
          {points ? <><View style={styles.pointsTopRow}><Text style={styles.pointsValue}>{points.total}</Text><Text style={styles.pointsLevel}>Lv.{points.level}</Text></View><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${levelProgress}%` }]} /></View><Text style={styles.previewTag}>本级 {currentLevelPoints}/{nextLevelPoints} 分</Text></> : isLoadingProfile ? <ActivityIndicator color={colors.text} /> : <Text style={styles.emptyHomework}>暂无积分记录。</Text>}
          {profile?.events.length ? <View style={styles.pointEventList}>{profile.events.slice(0, 5).map((event) => <View key={event.id} style={styles.pointEventRow}><Ionicons name="sparkles-outline" color={colors.text} size={18} /><View style={styles.checkinDetails}><Text style={styles.previewTitle}>{pointEventLabel(event)} · +{event.points}</Text><Text style={styles.previewText}>{pointEventSourceText(event)}</Text></View></View>)}</View> : null}
        </View>
        <View style={styles.learningHeader}><Text style={styles.sectionTitle}>学习记录</Text><Pressable accessibilityLabel="刷新学习记录" style={styles.headerIconButton} onPress={loadStats}><Ionicons name="refresh-outline" color={colors.text} size={20} /></Pressable></View>
        {isLoadingStats ? <ActivityIndicator color={colors.text} /> : null}
        {summary ? <View style={styles.statsGrid}>
          <View style={styles.statCard}><Text style={styles.statValue}>{summary.checkinDays}</Text><Text style={styles.statLabel}>累计打卡</Text></View>
          <View style={styles.statCard}><Text style={styles.statValue}>{summary.currentStreak}</Text><Text style={styles.statLabel}>连续天数</Text></View>
          <View style={styles.statCard}><Text style={styles.statDuration}>{formatLearningDuration(summary.voiceSeconds)}</Text><Text style={styles.statLabel}>口语练习</Text></View>
          <View style={styles.statCard}><Text style={styles.statDuration}>{formatLearningDuration(summary.homeworkSeconds)}</Text><Text style={styles.statLabel}>有效作业</Text></View>
        </View> : null}
        {recentDays.length ? <LearningTrendChart days={recentDays.slice(-7)} /> : null}
        {!isLoadingStats && summary && checkins.length === 0 ? <Text style={styles.emptyHomework}>完成一次录音或作业后，这里会出现你的第一条打卡。</Text> : null}
        {statsMessage ? <Text style={styles.readingMessage}>{statsMessage}</Text> : null}
      </View> : null}

      {tab === "HISTORY" ? <View style={styles.settingsSection}>
        <View style={styles.learningHeader}><View><Text style={styles.sectionTitle}>作业历史</Text><Text style={styles.previewText}>最新 50 条 · 共 {historyTotal} 条</Text></View><Pressable accessibilityLabel="刷新作业历史" style={styles.headerIconButton} onPress={loadHistory}><Ionicons name="refresh-outline" color={colors.text} size={20} /></Pressable></View>
        {isLoadingHistory ? <ActivityIndicator color={colors.text} /> : null}
        {!isLoadingHistory && history.length === 0 ? <Text style={styles.emptyHomework}>还没有作业历史。</Text> : null}
        {history.map((item) => {
          const progress = historyProgress(item);
          return <View key={item.id} style={styles.historyRow}><View style={styles.historyIcon}><Ionicons name={item.homeworkStatus === "ARCHIVED" ? "lock-closed-outline" : item.homeworkStatus === "PAUSED" ? "pause-outline" : "book-outline"} color={colors.text} size={19} /></View><View style={styles.checkinDetails}><View style={styles.historyTitleRow}><Text style={[styles.previewTitle, styles.historyTitleText]}>{historyTitle(item)}</Text><Text style={styles.historyStatus}>{historyStatusText(item)}</Text></View><Text style={styles.previewText}>{templateLabels[item.templateType]} · {compactDateLabel(item.scheduledAt)}</Text><Text style={styles.previewTag}>进度 {progress.total ? `${progress.completed}/${progress.total}` : "暂无"} · {historyReviewText(item)}</Text></View></View>;
        })}
        {historyMessage ? <Text style={styles.readingMessage}>{historyMessage}</Text> : null}
      </View> : null}
    </ScrollView>
  );
}
export default function App() {
  const auth = useAuth();
  const [view, setView] = useState<StudentView>("home");
  const [readingOccurrenceId, setReadingOccurrenceId] = useState<string | null>(null);
  const [practiceOccurrenceId, setPracticeOccurrenceId] = useState<string | null>(null);
  const openReadingOccurrence = (id: string) => {
    setReadingOccurrenceId(id);
    setPracticeOccurrenceId(null);
    setView("reading");
  };
  const openPracticeOccurrence = (id: string) => {
    setPracticeOccurrenceId(id);
    setReadingOccurrenceId(null);
    setView("practice");
  };
  if (auth.isRestoring) {
    return <SafeAreaProvider initialMetrics={Platform.OS === "web" ? webSafeAreaMetrics : undefined}>
      <SafeAreaView style={[styles.screen, { justifyContent: "center", alignItems: "center" }]}><ActivityIndicator color={colors.text} /></SafeAreaView>
    </SafeAreaProvider>;
  }
  return (
    <SafeAreaProvider initialMetrics={Platform.OS === "web" ? webSafeAreaMetrics : undefined}>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        {!auth.session ? <AuthScreen onLogin={auth.login} onRegister={auth.register} /> : auth.session.user.role !== "STUDENT" ? <TeacherReviewWorkspace token={auth.session.token} userId={auth.session.user.id} displayName={auth.session.user.displayName} role={auth.session.user.role} onLogout={auth.logout} /> : view === "home" ? <StudentHome displayName={auth.session.user.displayName} token={auth.session.token} onProfile={() => setView("profile")} onOpenReading={openReadingOccurrence} onOpenPractice={openPracticeOccurrence} /> : view === "reading" && readingOccurrenceId ? <ReadingChat key={readingOccurrenceId} token={auth.session.token} occurrenceId={readingOccurrenceId} onBack={() => setView("home")} onOpenReading={openReadingOccurrence} onOpenPractice={openPracticeOccurrence} /> : view === "practice" && practiceOccurrenceId ? <PracticeWorkspace key={practiceOccurrenceId} token={auth.session.token} occurrenceId={practiceOccurrenceId} onBack={() => setView("home")} onOpenReading={openReadingOccurrence} onOpenPractice={openPracticeOccurrence} /> : <Profile user={auth.session.user} token={auth.session.token} onBack={() => setView("home")} onLogout={auth.logout} onUserUpdate={auth.updateCurrentUser} />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
