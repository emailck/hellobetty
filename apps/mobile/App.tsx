import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
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
  getPracticeHomeworks,
  getPracticeOccurrence,
  getStudentLearningStats,
  getReadingHomeworks,
  getReadingOccurrence,
  getStaffStudents,
  getTeacherPracticeRecordingSubmissions,
  getTeacherReadingSubmissions,
  homeworkTemplateTypes,
  publishHomeworkTemplate,
  publishPictureBookHomework,
  type HomeworkTemplateType,
  type PracticeHomeworkSummary,
  type PracticeItem,
  type PracticeOccurrence,
  type LearningCheckin,
  type LearningStatsSummary,
  type ReadingCard,
  type ReadingOccurrence,
  type SpeechAssessment,
  type TeacherReadingSubmission,
  type TeacherPracticeRecordingSubmission,
  reviewPracticeRecordingSubmission,
  reviewReadingSubmission,
  submitPracticeAnswer,
  submitPracticeRecording,
  submitReadingAudio,
  startHomeworkSession,
  uploadHomeworkAsset,
} from "./src/lib/api";
import {
  clearHomeworkDraft,
  loadHomeworkDraft,
  saveHomeworkDraft,
  type HomeworkDraftItem,
} from "./src/lib/publish-draft";
import { colors, styles } from "./src/styles";

type AuthMode = "login" | "register";
type StudentView = "home" | "profile" | "reading" | "practice";

const templateLabels: Record<HomeworkTemplateType, string> = {
  READ_ALOUD_PICTURE_BOOK: "绘本跟读",
  SENTENCE_READ_ALOUD: "句子跟读",
  WORD_READ_ALOUD: "单词跟读",
  WORD_IMAGE_MATCH: "看图选词",
  WORD_SCRAMBLE: "字母排序",
  WORD_FILL_BLANK: "看图填空",
};

const recordingTemplates: HomeworkTemplateType[] = ["SENTENCE_READ_ALOUD", "WORD_READ_ALOUD"];

type ReviewQueueItem = (TeacherReadingSubmission & { source: "PICTURE_BOOK" }) | (TeacherPracticeRecordingSubmission & { source: "PRACTICE" });

function isPendingAssessment(assessment: SpeechAssessment | null) {
  return assessment?.status === "QUEUED" || assessment?.status === "PROCESSING";
}

function AssessmentSummary({ assessment, compact = false }: { assessment: SpeechAssessment | null; compact?: boolean }) {
  if (!assessment) return null;

  let headline = "";
  if (assessment.status === "QUEUED") headline = "云端发音评分已排队";
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
    if (typeof window !== "undefined") window.addEventListener("beforeunload", beforeUnload);

    return () => {
      desiredActive = false;
      keepalive = true;
      void reconcile();
      subscription.remove();
      if (typeof window !== "undefined") window.removeEventListener("beforeunload", beforeUnload);
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
  const [homeworks, setHomeworks] = useState<Array<{ id: string; title: string; cardCount: number; submittedCardCount: number }>>([]);
  const [practiceHomeworks, setPracticeHomeworks] = useState<PracticeHomeworkSummary[]>([]);
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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <Text style={styles.topBrand}>Hello Betty</Text>
        <Pressable accessibilityLabel="打开个人资料" style={styles.avatar} onPress={onProfile}>
          <Text style={styles.avatarText}>{displayName.slice(0, 1)}</Text>
        </Pressable>
      </View>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>嗨，{displayName}</Text>
        <Text style={styles.heroTitle}>今天，先从一句英语开始。</Text>
        <Text style={styles.heroText}>跟着绘本听一听、说一说，完成今天的英语练习。</Text>
      </View>
      <Text style={styles.sectionTitle}>我的作业</Text>
      <View>
        {isLoading ? <ActivityIndicator color={colors.text} /> : null}
        {!isLoading && homeworks.length === 0 && practiceHomeworks.length === 0 ? <Text style={styles.emptyHomework}>老师暂时还没有布置练习。</Text> : null}
        {homeworks.map((homework) => <Pressable key={homework.id} style={styles.previewRow} onPress={() => onOpenReading(homework.id)}>
          <Text style={styles.previewTitle}>{homework.title}</Text>
          <Text style={styles.previewText}>跟读绘本 · {homework.submittedCardCount}/{homework.cardCount} 张已完成</Text>
          <Text style={styles.previewTag}>{homework.submittedCardCount === homework.cardCount ? "已完成，可重新录音" : "开始跟读"}</Text>
        </Pressable>)}
        {practiceHomeworks.map((homework) => <Pressable key={homework.id} style={styles.previewRow} onPress={() => onOpenPractice(homework.id)}>
          <Text style={styles.previewTitle}>{homework.title}</Text>
          <Text style={styles.previewText}>{templateLabels[homework.templateType]} · {homework.completedItemCount}/{homework.itemCount} 题已完成</Text>
          <Text style={styles.previewTag}>{homework.completedItemCount === homework.itemCount ? "已完成，可继续巩固" : "继续练习"}</Text>
        </Pressable>)}
        {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
      </View>
    </ScrollView>
  );
}

function ReadingChat({ token, occurrenceId, onBack }: { token: string; occurrenceId: string; onBack: () => void }) {
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

  const hasPendingAssessment = occurrence?.cards.some((card) => isPendingAssessment(card.assessment)) ?? false;
  useEffect(() => {
    if (!hasPendingAssessment) return;
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const body = await getReadingOccurrence(token, occurrenceId);
        if (!disposed) applyOccurrence(body.occurrence);
      } catch {
        // Keep the submitted recording available while a background refresh fails.
      } finally {
        refreshing = false;
      }
    };
    const timer = setInterval(() => void refresh(), 4000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [hasPendingAssessment, occurrenceId, token]);

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
        audio = { uri: recordedUri, type: "audio/m4a", name: "reading.m4a" };
      }
      const next = await submitReadingAudio(token, occurrenceId, selectedCard.id, audio, recordedDurationSeconds ?? undefined);
      applyOccurrence(next);
      setSelectedCard(null);
      setRecordedUri(null);
      setRecordedDurationSeconds(null);
      setMessage("提交成功，下一张卡片已经送达。完成的卡片也可以重新录音。");
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "提交失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!occurrence) return <SafeAreaView style={[styles.screen, styles.loadingScreen]}><ActivityIndicator color={colors.text} /></SafeAreaView>;
  const nextCard = occurrence.cards.find((card) => !card.submittedAudioUrl) ?? null;
  const visibleCards = occurrence.cards.filter((card) => card.submittedAudioUrl || card.id === nextCard?.id);

  return <View style={styles.screen}>
    <View style={styles.readingHeader}><Pressable accessibilityLabel="返回作业列表" style={styles.headerIconButton} onPress={onBack}><Ionicons name="chevron-back" color={colors.text} size={23} /></Pressable><Text style={styles.readingTitle}>{occurrence.title}</Text><View style={{ width: 32 }} /></View>
    <ScrollView contentContainerStyle={styles.chatContent}>
      {occurrence.instructions ? <View style={styles.chatTeacher}><Text style={styles.chatTeacherText}>{occurrence.instructions}</Text></View> : null}
        {visibleCards.map((card) => <View key={card.id} style={styles.chatMessage}><Text style={styles.chatLabel}>第 {card.position} 页 · {card.status === "UNMADE" ? "未作" : card.status === "DONE" ? "已做，等待老师批改" : `老师已批改 · ${card.grade} 级`}</Text><Pressable style={styles.readingCard} onPress={() => { setSelectedCard(card); setRecordedUri(null); setRecordedDurationSeconds(null); setMessage(""); }}><Image style={styles.cardThumbnail} source={{ uri: playableUrl(card.imageUrl) }} /><Text style={styles.readingCardText}>{card.status === "UNMADE" ? "点击打开绘本卡片" : card.status === "DONE" ? "点击听自己的录音或重新录音" : "点击听点评、自己的录音或重新录音"}</Text><AssessmentSummary assessment={card.assessment} compact /></Pressable></View>)}
      {!nextCard ? <View style={styles.completedBanner}><Text style={styles.completedText}>这份绘本已完成。点击任意卡片可以重新录音。</Text></View> : null}
      {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
    </ScrollView>
    <Modal visible={selectedCard !== null} transparent animationType="slide" onRequestClose={() => setSelectedCard(null)}>
      <View style={styles.modalBackdrop}><View style={styles.readingModal}>
        {selectedCard ? <><View style={styles.modalTopRow}><Text style={styles.modalPage}>第 {selectedCard.position} 页</Text><Pressable accessibilityLabel="关闭卡片" style={styles.headerIconButton} onPress={() => setSelectedCard(null)}><Ionicons name="close" color={colors.text} size={22} /></Pressable></View><Image style={styles.cardImage} resizeMode="contain" source={{ uri: playableUrl(selectedCard.imageUrl) }} />{selectedCard.referenceText ? <Text style={styles.practiceModalPrompt}>{selectedCard.referenceText}</Text> : null}<View style={[styles.statusPill, selectedCard.status === "GRADED" ? styles.statusGraded : selectedCard.status === "DONE" ? styles.statusDone : styles.statusUnmade]}><Text style={styles.statusPillText}>{selectedCard.status === "UNMADE" ? "未作" : selectedCard.status === "DONE" ? "已做，等待老师批改" : `老师已批改 · ${selectedCard.grade} 级`}</Text></View><AssessmentSummary assessment={selectedCard.assessment} /><View style={styles.modalControls}><Pressable accessibilityLabel="听老师示范录音" style={styles.iconButton} onPress={() => play(selectedCard.sampleAudioUrl)}><Ionicons name="headset-outline" color={colors.text} size={21} /></Pressable>{selectedCard.submittedAudioUrl ? <Pressable accessibilityLabel="听我的录音" style={styles.iconButton} onPress={() => play(selectedCard.submittedAudioUrl!)}><Ionicons name="volume-high-outline" color={colors.text} size={21} /></Pressable> : null}{selectedCard.feedbackAudioUrl ? <Pressable accessibilityLabel="听老师点评语音" style={styles.iconButton} onPress={() => play(selectedCard.feedbackAudioUrl!)}><Ionicons name="chatbubble-ellipses-outline" color={colors.text} size={21} /></Pressable> : null}{recorderState.isRecording ? <Pressable accessibilityLabel="停止录音" style={styles.iconButtonRecord} onPress={stopRecording}><Ionicons name="stop" color={colors.text} size={19} /></Pressable> : <Pressable accessibilityLabel={selectedCard.submittedAudioUrl ? "重新录音" : "开始录音"} style={styles.iconButtonRecord} onPress={startRecording}><Ionicons name="mic-outline" color={colors.text} size={23} /></Pressable>}{recordedUri ? <Pressable accessibilityLabel="提交跟读录音" style={[styles.iconButtonSubmit, isSubmitting && styles.primaryButtonDisabled]} disabled={isSubmitting} onPress={submit}>{isSubmitting ? <ActivityIndicator color={colors.text} /> : <Ionicons name="send" color={colors.text} size={20} />}</Pressable> : null}</View>{recorderState.isRecording ? <Text style={styles.recordingHint}>正在录音 {Math.ceil(recorderState.durationMillis / 1000)} 秒</Text> : null}</> : null}
      </View></View>
    </Modal>
  </View>;
}

function PracticeWorkspace({ token, occurrenceId, onBack }: { token: string; occurrenceId: string; onBack: () => void }) {
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

  const hasPendingAssessment = occurrence?.items.some((item) => isPendingAssessment(item.assessment)) ?? false;
  useEffect(() => {
    if (!hasPendingAssessment) return;
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const body = await getPracticeOccurrence(token, occurrenceId);
        if (!disposed) applyOccurrence(body.occurrence);
      } catch {
        // Keep the submitted recording available while a background refresh fails.
      } finally {
        refreshing = false;
      }
    };
    const timer = setInterval(() => void refresh(), 4000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [hasPendingAssessment, occurrenceId, token]);

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
        : { uri: recordedUri, type: "audio/m4a", name: "practice.m4a" };
      const next = await submitPracticeRecording(token, occurrenceId, selectedItem.id, audio, recordedDurationSeconds ?? undefined);
      applyOccurrence(next);
      setSelectedItem(null);
      setRecordedUri(null);
      setRecordedDurationSeconds(null);
      setMessage("录音已提交，下一项练习已解锁。");
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

  return <View style={styles.screen}>
    <View style={styles.readingHeader}><Pressable accessibilityLabel="返回作业列表" style={styles.headerIconButton} onPress={onBack}><Ionicons name="chevron-back" color={colors.text} size={23} /></Pressable><View style={styles.practiceHeaderText}><Text style={styles.readingTitle}>{occurrence.title}</Text><Text style={styles.practiceTemplateLabel}>{templateLabels[occurrence.templateType]}</Text></View><View style={{ width: 32 }} /></View>
    <ScrollView contentContainerStyle={styles.chatContent}>
      {occurrence.instructions ? <View style={styles.chatTeacher}><Text style={styles.chatTeacherText}>{occurrence.instructions}</Text></View> : null}
      {visibleItems.map((item) => isRecordingTemplate ? <View key={item.id} style={styles.chatMessage}>
        <Text style={styles.chatLabel}>第 {item.position} 项 · {item.status === "UNMADE" ? "未作" : item.status === "DONE" ? "等待老师批改" : `老师已批改 · ${item.grade} 级`}</Text>
        <Pressable style={styles.practiceCard} onPress={() => { setSelectedItem(item); setRecordedUri(null); setRecordedDurationSeconds(null); setMessage(""); }}>
          {item.imageUrl ? <Image style={styles.practiceImage} source={{ uri: item.imageUrl.startsWith("http") ? item.imageUrl : `${apiBaseUrl}${item.imageUrl}` }} /> : null}
          <Text style={styles.practicePrompt}>{item.promptText ?? item.answerText}</Text>
          <Text style={styles.previewTag}>{item.submittedAudioUrl ? "可试听或重新录音" : "点击开始跟读"}</Text>
          <AssessmentSummary assessment={item.assessment} compact />
        </Pressable>
      </View> : <View key={item.id} style={styles.objectiveCard}>
        <Text style={styles.chatLabel}>第 {item.position} / {occurrence.items.length} 题</Text>
        {item.imageUrl ? <Image style={styles.objectiveImage} resizeMode="contain" source={{ uri: item.imageUrl.startsWith("http") ? item.imageUrl : `${apiBaseUrl}${item.imageUrl}` }} /> : null}
        {occurrence.templateType === "WORD_FILL_BLANK" ? <Text style={styles.objectivePrompt}>{item.promptText}</Text> : <Text style={styles.objectivePrompt}>{occurrence.templateType === "WORD_SCRAMBLE" ? "按顺序拼出图片中的单词" : "选择图片对应的英文单词"}</Text>}
        {occurrence.templateType === "WORD_SCRAMBLE" ? <>
          <View style={styles.scrambleAnswer}>{scrambleAnswer.map((token) => <Pressable key={token.id} style={styles.letterTileActive} onPress={() => { setScrambleAnswer((current) => current.filter((entry) => entry.id !== token.id)); setScramblePool((current) => [...current, token]); }}><Text style={styles.letterTileText}>{token.letter}</Text></Pressable>)}</View>
          <View style={styles.scramblePool}>{scramblePool.length === 0 && scrambleAnswer.length === 0 ? <Pressable style={styles.secondaryButton} onPress={() => resetScramble(item)}><Text style={styles.secondaryButtonText}>开始拼词</Text></Pressable> : scramblePool.map((token) => <Pressable key={token.id} style={styles.letterTile} onPress={() => { setScramblePool((current) => current.filter((entry) => entry.id !== token.id)); setScrambleAnswer((current) => [...current, token]); }}><Text style={styles.letterTileText}>{token.letter}</Text></Pressable>)}</View>
          {scrambleAnswer.length ? <Pressable style={[styles.primaryButton, isSubmitting && styles.primaryButtonDisabled]} disabled={isSubmitting} onPress={() => void submitAnswer(item, scrambleAnswer.map((token) => token.letter).join(""))}><Text style={styles.primaryButtonText}>提交答案</Text></Pressable> : null}
        </> : <View style={styles.choiceList}>{item.choices.map((choice) => <Pressable key={choice} style={[styles.choiceButton, answer === choice && styles.choiceButtonActive]} onPress={() => setAnswer(choice)}><Text style={styles.choiceText}>{choice}</Text></Pressable>)}<Pressable style={[styles.primaryButton, (!answer || isSubmitting) && styles.primaryButtonDisabled]} disabled={!answer || isSubmitting} onPress={() => void submitAnswer(item)}><Text style={styles.primaryButtonText}>确认答案</Text></Pressable></View>}
      </View>)}
      {!currentItem ? <View style={styles.completedBanner}><Text style={styles.completedText}>这份练习已完成。跟读题仍可以打开已完成项目重新录音。</Text></View> : null}
      {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
    </ScrollView>
    <Modal visible={selectedItem !== null} transparent animationType="slide" onRequestClose={() => setSelectedItem(null)}><View style={styles.modalBackdrop}><View style={styles.readingModal}>{selectedItem ? <><View style={styles.modalTopRow}><Text style={styles.modalPage}>第 {selectedItem.position} 项</Text><Pressable accessibilityLabel="关闭练习" style={styles.headerIconButton} onPress={() => setSelectedItem(null)}><Ionicons name="close" color={colors.text} size={22} /></Pressable></View>{selectedItem.imageUrl ? <Image style={styles.cardImage} resizeMode="contain" source={{ uri: selectedItem.imageUrl.startsWith("http") ? selectedItem.imageUrl : `${apiBaseUrl}${selectedItem.imageUrl}` }} /> : null}<Text style={styles.practiceModalPrompt}>{selectedItem.promptText ?? selectedItem.answerText}</Text><View style={[styles.statusPill, selectedItem.status === "GRADED" ? styles.statusGraded : selectedItem.status === "DONE" ? styles.statusDone : styles.statusUnmade]}><Text style={styles.statusPillText}>{selectedItem.status === "UNMADE" ? "未作" : selectedItem.status === "DONE" ? "等待老师批改" : `老师已批改 · ${selectedItem.grade} 级`}</Text></View><AssessmentSummary assessment={selectedItem.assessment} /><View style={styles.modalControls}>{selectedItem.sampleAudioUrl ? <Pressable accessibilityLabel="听示范录音" style={styles.iconButton} onPress={() => play(selectedItem.sampleAudioUrl!)}><Ionicons name="headset-outline" color={colors.text} size={21} /></Pressable> : null}{selectedItem.submittedAudioUrl ? <Pressable accessibilityLabel="听我的录音" style={styles.iconButton} onPress={() => play(selectedItem.submittedAudioUrl!)}><Ionicons name="volume-high-outline" color={colors.text} size={21} /></Pressable> : null}{selectedItem.feedbackAudioUrl ? <Pressable accessibilityLabel="听老师点评" style={styles.iconButton} onPress={() => play(selectedItem.feedbackAudioUrl!)}><Ionicons name="chatbubble-ellipses-outline" color={colors.text} size={21} /></Pressable> : null}{recorderState.isRecording ? <Pressable accessibilityLabel="停止录音" style={styles.iconButtonRecord} onPress={stopRecording}><Ionicons name="stop" color={colors.text} size={19} /></Pressable> : <Pressable accessibilityLabel={selectedItem.submittedAudioUrl ? "重新录音" : "开始录音"} style={styles.iconButtonRecord} onPress={startRecording}><Ionicons name="mic-outline" color={colors.text} size={23} /></Pressable>}{recordedUri ? <Pressable accessibilityLabel="提交录音" style={[styles.iconButtonSubmit, isSubmitting && styles.primaryButtonDisabled]} disabled={isSubmitting} onPress={submitRecording}>{isSubmitting ? <ActivityIndicator color={colors.text} /> : <Ionicons name="send" color={colors.text} size={20} />}</Pressable> : null}</View>{recorderState.isRecording ? <Text style={styles.recordingHint}>正在录音 {Math.ceil(recorderState.durationMillis / 1000)} 秒</Text> : recordedUri ? <Text style={styles.recordingHint}>录音完成，可以提交。</Text> : null}</> : null}</View></View></Modal>
  </View>;
}

function TeacherReviewWorkspace({ token, userId, displayName, onLogout }: { token: string; userId: string; displayName: string; onLogout: () => void }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const [submissions, setSubmissions] = useState<ReviewQueueItem[]>([]);
  const [selected, setSelected] = useState<ReviewQueueItem | null>(null);
  const [grade, setGrade] = useState<"A" | "B" | "C" | "D">("A");
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [teacherMode, setTeacherMode] = useState<"REVIEW" | "PUBLISH">("REVIEW");

  const applySubmissions = (next: ReviewQueueItem[]) => {
    setSubmissions(next);
    setSelected((current) => current
      ? next.find((item) => item.id === current.id && item.source === current.source) ?? null
      : null);
  };

  const load = async () => {
    try {
      const [pictureBooks, practice] = await Promise.all([
        getTeacherReadingSubmissions(token),
        getTeacherPracticeRecordingSubmissions(token),
      ]);
      applySubmissions([
        ...pictureBooks.submissions.map((submission) => ({ ...submission, source: "PICTURE_BOOK" as const })),
        ...practice.submissions.map((submission) => ({ ...submission, source: "PRACTICE" as const })),
      ]);
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "无法加载学生跟读提交");
    }
  };

  useEffect(() => { void load(); return () => playerRef.current?.remove(); }, [token]);

  const play = (url: string) => {
    playerRef.current?.remove();
    const player = createAudioPlayer({
      uri: `${apiBaseUrl}${url}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    playerRef.current = player;
    player.play();
  };

  const startRecording = async () => {
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setMessage("请允许麦克风权限后再开始语音点评。");
        return;
      }
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
    if (!selected) return;
    setIsSubmitting(true);
    try {
      let audio: Blob | { uri: string; type: string; name: string } | null = null;
      if (recordedUri) {
        audio = Platform.OS === "web"
          ? await (await fetch(recordedUri)).blob()
          : { uri: recordedUri, type: "audio/m4a", name: "teacher-feedback.m4a" };
      }
      if (selected.source === "PRACTICE") {
        const body = await reviewPracticeRecordingSubmission(token, selected.id, grade, audio);
        setSubmissions((current) => current.map((item) => item.id === selected.id && item.source === "PRACTICE" ? { ...body.submission, source: "PRACTICE" } : item));
      } else {
        const body = await reviewReadingSubmission(token, selected.id, grade, audio);
        setSubmissions((current) => current.map((item) => item.id === selected.id && item.source === "PICTURE_BOOK" ? { ...body.submission, source: "PICTURE_BOOK" } : item));
      }
      setSelected(null);
      setRecordedUri(null);
      setMessage("批改已发送给学生。");
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "批改提交失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (teacherMode === "PUBLISH") {
    return <TeacherPublishWorkspace token={token} userId={userId} onBack={() => setTeacherMode("REVIEW")} onLogout={onLogout} />;
  }

  return <View style={styles.screen}>
    <View style={styles.readingHeader}><Text style={styles.topBrand}>老师工作台</Text><View style={styles.teacherHeaderActions}><Pressable accessibilityLabel="批改跟读" style={[styles.headerIconButton, styles.headerIconButtonActive]} onPress={() => setTeacherMode("REVIEW")}><Ionicons name="checkmark-done-outline" color={colors.text} size={22} /></Pressable><Pressable accessibilityLabel="发布绘本作业" style={styles.headerIconButton} onPress={() => setTeacherMode("PUBLISH")}><Ionicons name="add-circle-outline" color={colors.text} size={23} /></Pressable><Pressable accessibilityLabel="退出登录" style={styles.headerIconButton} onPress={onLogout}><Ionicons name="log-out-outline" color={colors.text} size={22} /></Pressable></View></View>
    <ScrollView contentContainerStyle={styles.chatContent}>
      <View style={styles.chatTeacher}><Text style={styles.chatTeacherText}>你好，{displayName}。这里是等待批改的学生跟读。</Text></View>
      {submissions.filter((submission) => submission.status === "DONE").length === 0 ? <Text style={styles.emptyHomework}>暂时没有待批改的录音。</Text> : null}
      {submissions.filter((submission) => submission.status === "DONE").map((submission) => <Pressable key={`${submission.source}-${submission.id}`} style={styles.teacherSubmissionCard} onPress={() => { setSelected(submission); setGrade(submission.grade ?? "A"); setRecordedUri(null); }}><View style={styles.teacherSubmissionText}><Text style={styles.previewTitle}>{submission.studentName} · 第 {submission.source === "PRACTICE" ? submission.itemPosition : submission.cardPosition} 项</Text><Text style={styles.previewText}>{submission.homeworkTitle}</Text><Text style={styles.previewTag}>{submission.source === "PRACTICE" ? `${templateLabels[submission.templateType]} · ${submission.promptText ?? submission.answerText ?? ""}` : submission.referenceText ?? "绘本跟读"}</Text><AssessmentSummary assessment={submission.assessment} compact /></View><Ionicons name="chevron-forward" color={colors.muted} size={20} /></Pressable>)}
      {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
    </ScrollView>
    <Modal visible={selected !== null} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
      <View style={styles.modalBackdrop}><View style={styles.readingModal}>{selected ? <><View style={styles.modalTopRow}><Text style={styles.modalPage}>{selected.studentName} · 第 {selected.source === "PRACTICE" ? selected.itemPosition : selected.cardPosition} 项</Text><Pressable accessibilityLabel="关闭批改" style={styles.headerIconButton} onPress={() => setSelected(null)}><Ionicons name="close" color={colors.text} size={22} /></Pressable></View><Text style={styles.practiceModalPrompt}>{selected.source === "PRACTICE" ? selected.promptText ?? selected.answerText : selected.referenceText}</Text><Pressable accessibilityLabel="播放学生录音" style={styles.teacherAudioButton} onPress={() => play(selected.audioUrl)}><Ionicons name="volume-high-outline" color={colors.text} size={24} /></Pressable><AssessmentSummary assessment={selected.assessment} /><Text style={styles.modalPage}>选择等级</Text><View style={styles.gradePicker}>{(["A", "B", "C", "D"] as const).map((item) => <Pressable key={item} accessibilityLabel={`选择 ${item} 等级`} style={[styles.gradeChoice, grade === item && styles.gradeChoiceActive]} onPress={() => setGrade(item)}><Text style={styles.gradeChoiceText}>{item}</Text></Pressable>)}</View><View style={styles.modalControls}>{recorderState.isRecording ? <Pressable accessibilityLabel="停止点评录音" style={styles.iconButtonRecord} onPress={stopRecording}><Ionicons name="stop" color={colors.text} size={19} /></Pressable> : <Pressable accessibilityLabel="录制老师点评" style={styles.iconButtonRecord} onPress={startRecording}><Ionicons name="mic-outline" color={colors.text} size={23} /></Pressable>}<Pressable accessibilityLabel="提交老师批改" style={[styles.iconButtonSubmit, isSubmitting && styles.primaryButtonDisabled]} disabled={isSubmitting} onPress={submitReview}>{isSubmitting ? <ActivityIndicator color={colors.text} /> : <Ionicons name="send" color={colors.text} size={20} />}</Pressable></View>{recorderState.isRecording ? <Text style={styles.recordingHint}>正在录制点评 {Math.ceil(recorderState.durationMillis / 1000)} 秒</Text> : recordedUri ? <Text style={styles.recordingHint}>点评已录制，可以提交。</Text> : <Text style={styles.recordingHint}>可直接提交等级，也可先录制语音点评。</Text>}</> : null}</View></View>
    </Modal>
  </View>;
}

function TeacherPublishWorkspace({ token, userId, onBack, onLogout }: { token: string; userId: string; onBack: () => void; onLogout: () => void }) {
  const [students, setStudents] = useState<Array<{ id: string; displayName: string; phone: string }>>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [templateType, setTemplateType] = useState<HomeworkTemplateType>("READ_ALOUD_PICTURE_BOOK");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [items, setItems] = useState<HomeworkDraftItem[]>([]);
  const [unit, setUnit] = useState<"DAY" | "WEEK">("WEEK");
  const [interval, setInterval] = useState("1");
  const [occurrenceLimit, setOccurrenceLimit] = useState("4");
  const [uploadingCardId, setUploadingCardId] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [message, setMessage] = useState("");
  const [isDraftRestored, setIsDraftRestored] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const previewPlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);

  useEffect(() => {
    void getStaffStudents(token)
      .then((body) => setStudents(body.users))
      .catch((cause) => setMessage(cause instanceof ApiError ? cause.message : "无法加载学生列表"));
  }, [token]);

  useEffect(() => {
    void loadHomeworkDraft(userId).then((draft) => {
      if (draft) {
        setTemplateType(draft.templateType);
        setTitle(draft.title);
        setInstructions(draft.instructions);
        setItems(draft.items);
        setSelectedIds(draft.selectedIds);
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
      const draft = { templateType, title, instructions, items, selectedIds, unit, interval, occurrenceLimit };
      const hasContent = title.trim() || instructions.trim() || items.length > 0 || selectedIds.length > 0;
      void (hasContent ? saveHomeworkDraft(userId, draft) : clearHomeworkDraft(userId));
    }, 500);
    return () => clearTimeout(timer);
  }, [instructions, interval, isDraftRestored, items, occurrenceLimit, selectedIds, templateType, title, unit, userId]);

  useEffect(() => () => previewPlayerRef.current?.remove(), []);

  const addItem = () => setItems((current) => [...current, {
    id: `${Date.now()}-${current.length}`, imageUrl: "", sampleAudioUrl: "", imageName: "", audioName: "", referenceText: "", promptText: "", answerText: "", choicesText: "",
  }]);
  const updateItem = (itemId: string, patch: Partial<HomeworkDraftItem>) => setItems((current) => current.map((item) => item.id === itemId ? { ...item, ...patch } : item));
  const toggleStudent = (studentId: string) => setSelectedIds((current) => current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId]);

  async function chooseAsset(itemId: string, field: "image" | "audio") {
    setMessage("");
    setUploadingCardId(itemId);
    try {
      if (field === "image") {
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
        if (result.canceled) return;
        const asset = result.assets[0];
        const uploaded = await uploadHomeworkAsset(token, { uri: asset.uri, type: asset.mimeType ?? "image/jpeg", name: asset.fileName ?? `picture-${Date.now()}.jpg` });
        if (uploaded.kind !== "image") throw new ApiError("请选择图片文件", "IMAGE_REQUIRED");
        updateItem(itemId, { imageUrl: uploaded.url, imageName: asset.fileName ?? "练习图片" });
      } else {
        const result = await DocumentPicker.getDocumentAsync({ type: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/webm", "audio/ogg"], copyToCacheDirectory: true });
        if (result.canceled) return;
        const asset = result.assets[0];
        const uploaded = await uploadHomeworkAsset(token, { uri: asset.uri, type: asset.mimeType ?? "audio/mpeg", name: asset.name });
        if (uploaded.kind !== "audio") throw new ApiError("请选择音频文件", "AUDIO_REQUIRED");
        updateItem(itemId, { sampleAudioUrl: uploaded.url, audioName: asset.name });
      }
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "素材上传失败，请稍后重试。");
    } finally {
      setUploadingCardId(null);
    }
  }

  async function publish() {
    setMessage("");
    const every = Number(interval);
    const times = Number(occurrenceLimit);
    if (title.trim().length < 2) return setMessage("请填写至少两个字的作业标题。");
    if (selectedIds.length === 0) return setMessage("请至少选择一名学生。");
    if (!Number.isInteger(every) || every < 1 || !Number.isInteger(times) || times < 1) return setMessage("周期和触发次数必须是大于 0 的整数。");
    if (items.length === 0) return setMessage("请至少添加一项练习内容。");
    const choicesFor = (item: HomeworkDraftItem) => item.choicesText.split(/[，,\n]/).map((choice) => choice.trim()).filter(Boolean);
    if (templateType === "READ_ALOUD_PICTURE_BOOK" && items.some((item) => !item.imageUrl || !item.sampleAudioUrl || !item.referenceText.trim())) return setMessage("每张绘本卡都需要英文原文、图片和示范录音。");
    if (templateType === "SENTENCE_READ_ALOUD" && items.some((item) => !item.promptText.trim() || !item.sampleAudioUrl)) return setMessage("每个句子都需要英文内容和示范录音。");
    if (templateType === "WORD_READ_ALOUD" && items.some((item) => !item.imageUrl || !item.answerText.trim() || !item.sampleAudioUrl)) return setMessage("每个单词都需要图片、英文单词和示范录音。");
    if (["WORD_IMAGE_MATCH", "WORD_FILL_BLANK"].includes(templateType) && items.some((item) => {
      const normalizedAnswer = item.answerText.trim().toLocaleLowerCase();
      return !item.imageUrl || !normalizedAnswer || choicesFor(item).length < 2 || !choicesFor(item).some((choice) => choice.toLocaleLowerCase() === normalizedAnswer);
    })) return setMessage("选择题需要图片、答案和至少两个选项，且选项中必须包含答案。");
    if (templateType === "WORD_SCRAMBLE" && items.some((item) => !item.imageUrl || !item.answerText.trim())) return setMessage("每道字母排序题都需要图片和答案单词。");
    if (templateType === "WORD_FILL_BLANK" && items.some((item) => !item.promptText.includes("____"))) return setMessage("看图填空的句子必须包含 ____。");
    setIsPublishing(true);
    try {
      const common = {
        title: title.trim(), instructions, studentIds: selectedIds,
        schedule: { startsAt: new Date().toISOString(), unit, interval: every, occurrenceLimit: times },
      };
      const result = templateType === "READ_ALOUD_PICTURE_BOOK"
        ? await publishPictureBookHomework(token, { ...common, cards: items.map(({ imageUrl, sampleAudioUrl, referenceText }) => ({ imageUrl, sampleAudioUrl, referenceText: referenceText.trim() })) })
        : await publishHomeworkTemplate(token, {
          ...common,
          templateType,
          items: items.map((item) => ({
            ...(templateType === "SENTENCE_READ_ALOUD" || templateType === "WORD_FILL_BLANK" ? { promptText: item.promptText.trim() } : {}),
            ...(templateType !== "SENTENCE_READ_ALOUD" ? { imageUrl: item.imageUrl } : {}),
            ...(recordingTemplates.includes(templateType) ? { sampleAudioUrl: item.sampleAudioUrl } : {}),
            ...(templateType.startsWith("WORD_") ? { answerText: item.answerText.trim() } : {}),
            ...(["WORD_IMAGE_MATCH", "WORD_FILL_BLANK"].includes(templateType) ? { choices: choicesFor(item) } : {}),
          })),
        });
      setTitle(""); setInstructions(""); setItems([]); setSelectedIds([]);
      await clearHomeworkDraft(userId);
      setMessage(`已发布给 ${result.homework.targetCount} 名学生，共生成 ${result.homework.occurrenceCount} 次练习。`);
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "发布失败，请稍后重试。");
    } finally {
      setIsPublishing(false);
    }
  }

  const previewCard = previewIndex === null ? null : items[previewIndex];
  const showPreview = () => {
    if (items.length === 0) {
      setMessage("请先添加练习内容。");
      return;
    }
    setPreviewIndex(0);
  };
  const playPreviewAudio = () => {
    if (!previewCard) return;
    previewPlayerRef.current?.remove();
    const player = createAudioPlayer(previewCard.sampleAudioUrl.startsWith("http") ? previewCard.sampleAudioUrl : `${apiBaseUrl}${previewCard.sampleAudioUrl}`);
    previewPlayerRef.current = player;
    player.play();
  };

  return <View style={styles.screen}>
    <View style={styles.readingHeader}><Pressable accessibilityLabel="返回批改" style={styles.headerIconButton} onPress={onBack}><Ionicons name="chevron-back" color={colors.text} size={23} /></Pressable><Text style={styles.topBrand}>发布作业</Text><View style={styles.teacherHeaderActions}><Pressable accessibilityLabel="预览作业" style={styles.headerIconButton} onPress={showPreview}><Ionicons name="eye-outline" color={colors.text} size={22} /></Pressable><Pressable accessibilityLabel="退出登录" style={styles.headerIconButton} onPress={onLogout}><Ionicons name="log-out-outline" color={colors.text} size={22} /></Pressable></View></View>
    <ScrollView contentContainerStyle={styles.teacherPublishContent} keyboardShouldPersistTaps="handled">
      <View style={styles.teacherFormSection}><Text style={styles.sectionTitle}>练习模板</Text><View style={styles.templateGrid}>{homeworkTemplateTypes.map((type) => <Pressable key={type} style={[styles.templateOption, templateType === type && styles.templateOptionActive]} onPress={() => { setTemplateType(type); setPreviewIndex(null); }}><Text style={[styles.templateOptionText, templateType === type && styles.templateOptionTextActive]}>{templateLabels[type]}</Text></Pressable>)}</View></View>
      <View style={styles.teacherFormSection}><Text style={styles.sectionTitle}>作业内容</Text><TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="作业标题" placeholderTextColor={colors.faint} /><TextInput style={[styles.input, styles.multilineInput]} value={instructions} onChangeText={setInstructions} placeholder="练习说明（可选）" placeholderTextColor={colors.faint} multiline /></View>
      <View style={styles.teacherFormSection}><View style={styles.teacherSectionHeader}><Text style={styles.sectionTitle}>练习项目</Text><Pressable accessibilityLabel="添加练习项目" style={styles.smallIconButton} onPress={addItem}><Ionicons name="add" color={colors.text} size={20} /></Pressable></View>{items.length === 0 ? <Text style={styles.emptyHomework}>按顺序添加本次练习内容。</Text> : items.map((item, index) => <View key={item.id} style={styles.mobileCardDraft}><View style={styles.mobileCardDraftHeader}><Text style={styles.previewTitle}>第 {index + 1} 项</Text><Pressable accessibilityLabel="删除练习项目" style={styles.smallIconButton} onPress={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}><Ionicons name="trash-outline" color={colors.muted} size={18} /></Pressable></View>{templateType === "READ_ALOUD_PICTURE_BOOK" ? <TextInput style={styles.input} value={item.referenceText} onChangeText={(value) => updateItem(item.id, { referenceText: value })} autoCapitalize="sentences" placeholder="本页英文原文" placeholderTextColor={colors.faint} /> : null}{(templateType === "SENTENCE_READ_ALOUD" || templateType === "WORD_FILL_BLANK") ? <TextInput style={styles.input} value={item.promptText} onChangeText={(value) => updateItem(item.id, { promptText: value })} placeholder={templateType === "SENTENCE_READ_ALOUD" ? "英文句子" : "含 ____ 的英文句子"} placeholderTextColor={colors.faint} /> : null}{templateType.startsWith("WORD_") ? <TextInput style={styles.input} value={item.answerText} onChangeText={(value) => updateItem(item.id, { answerText: value })} autoCapitalize="none" placeholder="英文答案单词" placeholderTextColor={colors.faint} /> : null}{["WORD_IMAGE_MATCH", "WORD_FILL_BLANK"].includes(templateType) ? <TextInput style={[styles.input, styles.multilineInput]} value={item.choicesText} onChangeText={(value) => updateItem(item.id, { choicesText: value })} placeholder="选项，用逗号或换行分隔" placeholderTextColor={colors.faint} multiline /> : null}{templateType !== "SENTENCE_READ_ALOUD" ? <View style={styles.mobileCardAssetRow}><Pressable accessibilityLabel="选择练习图片" style={styles.assetIconButton} onPress={() => void chooseAsset(item.id, "image")}><Ionicons name="image-outline" color={colors.text} size={20} /></Pressable><Text style={styles.assetName}>{item.imageName || "选择图片"}</Text></View> : null}{(templateType === "READ_ALOUD_PICTURE_BOOK" || recordingTemplates.includes(templateType)) ? <View style={styles.mobileCardAssetRow}><Pressable accessibilityLabel="选择示范录音" style={styles.assetIconButton} onPress={() => void chooseAsset(item.id, "audio")}><Ionicons name="headset-outline" color={colors.text} size={20} /></Pressable><Text style={styles.assetName}>{item.audioName || "选择示范录音"}</Text></View> : null}{uploadingCardId === item.id ? <Text style={styles.recordingHint}>正在上传素材...</Text> : null}</View>)}</View>
      <View style={styles.teacherFormSection}><Text style={styles.sectionTitle}>发布设置</Text><View style={styles.mobileSegment}><Pressable style={[styles.mobileSegmentOption, unit === "DAY" && styles.mobileSegmentActive]} onPress={() => setUnit("DAY")}><Text style={styles.modeText}>按天</Text></Pressable><Pressable style={[styles.mobileSegmentOption, unit === "WEEK" && styles.mobileSegmentActive]} onPress={() => setUnit("WEEK")}><Text style={styles.modeText}>按周</Text></Pressable></View><View style={styles.mobileNumberRow}><TextInput style={styles.mobileNumberInput} value={interval} onChangeText={setInterval} keyboardType="number-pad" /><Text style={styles.previewText}>每隔 {unit === "DAY" ? "天" : "周"}</Text><TextInput style={styles.mobileNumberInput} value={occurrenceLimit} onChangeText={setOccurrenceLimit} keyboardType="number-pad" /><Text style={styles.previewText}>次</Text></View></View>
      <View style={styles.teacherFormSection}><Text style={styles.sectionTitle}>选择学生</Text>{students.map((student) => <Pressable key={student.id} style={[styles.mobileStudentRow, selectedIds.includes(student.id) && styles.mobileStudentRowActive]} onPress={() => toggleStudent(student.id)}><View><Text style={styles.previewTitle}>{student.displayName}</Text><Text style={styles.previewText}>{student.phone}</Text></View>{selectedIds.includes(student.id) ? <Ionicons name="checkmark-circle" color={colors.text} size={21} /> : <Ionicons name="ellipse-outline" color={colors.faint} size={21} />}</Pressable>)}</View>
      <Pressable accessibilityLabel="发布作业" style={[styles.mobilePublishButton, isPublishing && styles.primaryButtonDisabled]} disabled={isPublishing} onPress={() => void publish()}>{isPublishing ? <ActivityIndicator color={colors.text} /> : <Ionicons name="send" color={colors.text} size={22} />}</Pressable>
      {message ? <Text style={styles.readingMessage}>{message}</Text> : null}
    </ScrollView>
    <Modal visible={previewCard !== null} transparent animationType="slide" onRequestClose={() => setPreviewIndex(null)}><View style={styles.modalBackdrop}><View style={styles.readingModal}>{previewCard ? <><View style={styles.modalTopRow}><Text style={styles.modalPage}>预览第 {previewIndex! + 1} / {items.length} 项</Text><Pressable accessibilityLabel="关闭预览" style={styles.headerIconButton} onPress={() => setPreviewIndex(null)}><Ionicons name="close" color={colors.text} size={22} /></Pressable></View>{previewCard.imageUrl ? <Image style={styles.cardImage} resizeMode="contain" source={{ uri: previewCard.imageUrl.startsWith("http") ? previewCard.imageUrl : `${apiBaseUrl}${previewCard.imageUrl}` }} /> : null}<Text style={styles.practiceModalPrompt}>{previewCard.referenceText || previewCard.promptText || previewCard.answerText || templateLabels[templateType]}</Text><View style={styles.modalControls}>{previewCard.sampleAudioUrl ? <Pressable accessibilityLabel="播放示范录音" style={styles.iconButton} onPress={playPreviewAudio}><Ionicons name="headset-outline" color={colors.text} size={21} /></Pressable> : null}<Pressable accessibilityLabel="上一项" style={styles.iconButton} disabled={previewIndex === 0} onPress={() => setPreviewIndex((index) => index === null ? null : Math.max(0, index - 1))}><Ionicons name="chevron-back" color={previewIndex === 0 ? colors.faint : colors.text} size={21} /></Pressable><Pressable accessibilityLabel="下一项" style={styles.iconButton} disabled={previewIndex === items.length - 1} onPress={() => setPreviewIndex((index) => index === null ? null : Math.min(items.length - 1, index + 1))}><Ionicons name="chevron-forward" color={previewIndex === items.length - 1 ? colors.faint : colors.text} size={21} /></Pressable></View></> : null}</View></View></Modal>
  </View>;
}

function formatLearningDuration(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`;
}

function Profile({ name, phone, token, onBack, onLogout }: { name: string; phone: string; token: string; onBack: () => void; onLogout: () => void }) {
  const [summary, setSummary] = useState<LearningStatsSummary | null>(null);
  const [checkins, setCheckins] = useState<LearningCheckin[]>([]);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [statsMessage, setStatsMessage] = useState("");

  const loadStats = () => {
    setIsLoadingStats(true);
    setStatsMessage("");
    void getStudentLearningStats(token)
      .then((body) => {
        setSummary(body.summary);
        setCheckins(body.checkins);
      })
      .catch(() => setStatsMessage("学习记录暂时无法加载，不影响继续练习。"))
      .finally(() => setIsLoadingStats(false));
  };

  useEffect(loadStats, [token]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <Pressable onPress={onBack}><Text style={styles.textActionLabel}>返回</Text></Pressable>
        <Text style={styles.topBrand}>我的账号</Text>
        <View style={{ width: 28 }} />
      </View>
      <View style={styles.profileCard}>
        <Text style={styles.profileName}>{name}</Text>
        <Text style={styles.profilePhone}>{phone}</Text>
      </View>
      <View style={styles.learningHeader}><Text style={styles.sectionTitle}>学习记录</Text><Pressable accessibilityLabel="刷新学习记录" style={styles.headerIconButton} onPress={loadStats}><Ionicons name="refresh-outline" color={colors.text} size={20} /></Pressable></View>
      {isLoadingStats ? <ActivityIndicator color={colors.text} /> : null}
      {summary ? <View style={styles.statsGrid}>
        <View style={styles.statCard}><Text style={styles.statValue}>{summary.checkinDays}</Text><Text style={styles.statLabel}>累计打卡</Text></View>
        <View style={styles.statCard}><Text style={styles.statValue}>{summary.currentStreak}</Text><Text style={styles.statLabel}>连续天数</Text></View>
        <View style={styles.statCard}><Text style={styles.statDuration}>{formatLearningDuration(summary.voiceSeconds)}</Text><Text style={styles.statLabel}>口语练习</Text></View>
        <View style={styles.statCard}><Text style={styles.statDuration}>{formatLearningDuration(summary.homeworkSeconds)}</Text><Text style={styles.statLabel}>有效作业</Text></View>
      </View> : null}
      {!isLoadingStats && summary && checkins.length === 0 ? <Text style={styles.emptyHomework}>完成一次录音或作业后，这里会出现你的第一条打卡。</Text> : null}
      {checkins.length ? <View style={styles.checkinList}>{checkins.map((checkin) => <View key={checkin.checkinDate} style={styles.checkinRow}><View style={styles.checkinDateBadge}><Text style={styles.checkinDay}>{checkin.checkinDate.slice(8, 10)}</Text><Text style={styles.checkinMonth}>{checkin.checkinDate.slice(5, 7)} 月</Text></View><View style={styles.checkinDetails}><Text style={styles.previewTitle}>{checkin.checkinDate}</Text><Text style={styles.previewText}>口语 {formatLearningDuration(checkin.voiceSeconds)} · 作业 {formatLearningDuration(checkin.homeworkSeconds)}</Text></View><Ionicons name="checkmark-circle" color={colors.text} size={21} /></View>)}</View> : null}
      {statsMessage ? <Text style={styles.readingMessage}>{statsMessage}</Text> : null}
      <Pressable style={styles.logoutButton} onPress={onLogout}><Text style={styles.logoutText}>退出登录</Text></Pressable>
    </ScrollView>
  );
}

export default function App() {
  const auth = useAuth();
  const [view, setView] = useState<StudentView>("home");
  const [readingOccurrenceId, setReadingOccurrenceId] = useState<string | null>(null);
  const [practiceOccurrenceId, setPracticeOccurrenceId] = useState<string | null>(null);
  if (auth.isRestoring) {
    return <SafeAreaView style={[styles.screen, { justifyContent: "center", alignItems: "center" }]}><ActivityIndicator color={colors.text} /></SafeAreaView>;
  }
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      {!auth.session ? <AuthScreen onLogin={auth.login} onRegister={auth.register} /> : auth.session.user.role !== "STUDENT" ? <TeacherReviewWorkspace token={auth.session.token} userId={auth.session.user.id} displayName={auth.session.user.displayName} onLogout={auth.logout} /> : view === "home" ? <StudentHome displayName={auth.session.user.displayName} token={auth.session.token} onProfile={() => setView("profile")} onOpenReading={(id) => { setReadingOccurrenceId(id); setView("reading"); }} onOpenPractice={(id) => { setPracticeOccurrenceId(id); setView("practice"); }} /> : view === "reading" && readingOccurrenceId ? <ReadingChat token={auth.session.token} occurrenceId={readingOccurrenceId} onBack={() => setView("home")} /> : view === "practice" && practiceOccurrenceId ? <PracticeWorkspace token={auth.session.token} occurrenceId={practiceOccurrenceId} onBack={() => setView("home")} /> : <Profile name={auth.session.user.displayName} phone={auth.session.user.phone} token={auth.session.token} onBack={() => setView("home")} onLogout={auth.logout} />}
    </SafeAreaView>
  );
}
