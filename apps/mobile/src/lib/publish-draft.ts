import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import { homeworkTemplateTypes, type HomeworkTemplateType, type StaffPublishedHomeworkDetailResponse } from "./api";

export interface PictureBookDraftCard {
  id: string;
  imageUrl: string;
  sampleAudioUrl: string;
  imageLocalUri: string;
  imageMimeType: string;
  audioLocalUri: string;
  audioMimeType: string;
  imageName: string;
  audioName: string;
  referenceText: string;
}

export interface PictureBookPublishDraft {
  classroomId: string | null;
  title: string;
  instructions: string;
  cards: PictureBookDraftCard[];
  selectedIds: string[];
  unit: "DAY" | "WEEK";
  interval: string;
  occurrenceLimit: string;
}

export interface HomeworkDraftItem extends PictureBookDraftCard {
  promptText: string;
  answerText: string;
  choicesText: string;
}

export interface HomeworkPublishDraft {
  classroomId: string | null;
  templateType: HomeworkTemplateType;
  title: string;
  instructions: string;
  items: HomeworkDraftItem[];
  selectedIds: string[];
  startsAt: string;
  unit: "DAY" | "WEEK";
  interval: string;
  occurrenceLimit: string;
}

export function buildHomeworkDraftFromPublishedHomework(
  detail: StaffPublishedHomeworkDetailResponse,
): HomeworkPublishDraft | null {
  const templateType = detail.homework.templateType;
  if (!homeworkTemplateTypes.includes(templateType as HomeworkTemplateType)) return null;

  return {
    classroomId: null,
    templateType: templateType as HomeworkTemplateType,
    title: detail.homework.title,
    instructions: detail.homework.instructions ?? "",
    items: detail.questions.map((question) => ({
      id: `reuse-${detail.homework.id}-${question.sourceKind.toLowerCase()}-${question.id}`,
      imageUrl: question.imageUrl ?? "",
      sampleAudioUrl: question.sampleAudioUrl ?? "",
      imageLocalUri: "",
      imageMimeType: "",
      audioLocalUri: "",
      audioMimeType: "",
      imageName: question.imageUrl ? "已发布图片" : "",
      audioName: question.sampleAudioUrl ? "已发布示范录音" : "",
      referenceText: question.referenceText ?? "",
      promptText: question.promptText ?? "",
      answerText: question.answerText ?? "",
      choicesText: question.choices?.join("\n") ?? "",
    })),
    selectedIds: [],
    startsAt: "",
    unit: "WEEK",
    interval: "1",
    occurrenceLimit: "4",
  };
}

function draftKey(userId: string) {
  return `hello-betty-picture-book-draft:${userId}`;
}

function templateDraftKey(userId: string) {
  return `hello-betty-homework-template-draft:${userId}`;
}

function draftAssetDirectory(userId: string) {
  return new Directory(Paths.document, "homework-drafts", userId.replace(/[^a-zA-Z0-9-]/g, "_"));
}

function assetExtension(name: string, mimeType: string) {
  const namedExtension = name.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0]?.toLowerCase();
  if (namedExtension) return namedExtension;
  const byMimeType: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
  };
  return byMimeType[mimeType] ?? "";
}

export function persistHomeworkDraftAsset(
  userId: string,
  itemId: string,
  kind: "image" | "audio",
  asset: { uri: string; name: string; mimeType: string },
) {
  if (Platform.OS === "web") return asset.uri;
  const directory = draftAssetDirectory(userId);
  directory.create({ idempotent: true, intermediates: true });
  const safeItemId = itemId.replace(/[^a-zA-Z0-9-]/g, "_");
  const destination = new File(directory, `${safeItemId}-${kind}-${Date.now()}${assetExtension(asset.name, asset.mimeType)}`);
  new File(asset.uri).copy(destination);
  return destination.uri;
}

export function removeHomeworkDraftAsset(userId: string, uri: string) {
  if (Platform.OS === "web" || !uri) return;
  const directory = draftAssetDirectory(userId);
  const directoryPrefix = directory.uri.endsWith("/") ? directory.uri : `${directory.uri}/`;
  if (!uri.startsWith(directoryPrefix)) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}

function clearHomeworkDraftAssets(userId: string) {
  if (Platform.OS === "web") return;
  const directory = draftAssetDirectory(userId);
  if (directory.exists) directory.delete();
}

function normalizeDraftCard<T extends PictureBookDraftCard>(card: T): T {
  return {
    ...card,
    imageUrl: card.imageUrl ?? "",
    sampleAudioUrl: card.sampleAudioUrl ?? "",
    imageLocalUri: card.imageLocalUri ?? "",
    imageMimeType: card.imageMimeType ?? "",
    audioLocalUri: card.audioLocalUri ?? "",
    audioMimeType: card.audioMimeType ?? "",
    imageName: card.imageName ?? "",
    audioName: card.audioName ?? "",
    referenceText: card.referenceText ?? "",
  };
}

export async function loadHomeworkDraft(userId: string) {
  const stored = await AsyncStorage.getItem(templateDraftKey(userId));
  if (stored) {
    try {
      const draft = JSON.parse(stored) as HomeworkPublishDraft;
      return {
        ...draft,
        classroomId: draft.classroomId ?? null,
        startsAt: draft.startsAt ?? "",
        items: draft.items.map(normalizeDraftCard),
      };
    } catch {
      await AsyncStorage.removeItem(templateDraftKey(userId));
    }
  }

  const legacy = await loadPictureBookDraft(userId);
  if (!legacy) return null;
  return {
    templateType: "READ_ALOUD_PICTURE_BOOK",
    classroomId: legacy.classroomId ?? null,
    title: legacy.title,
    instructions: legacy.instructions,
    items: legacy.cards.map((card) => ({ ...normalizeDraftCard(card), promptText: "", answerText: "", choicesText: "" })),
    selectedIds: legacy.selectedIds,
    startsAt: "",
    unit: legacy.unit,
    interval: legacy.interval,
    occurrenceLimit: legacy.occurrenceLimit,
  } satisfies HomeworkPublishDraft;
}

export function saveHomeworkDraft(userId: string, draft: HomeworkPublishDraft) {
  return AsyncStorage.setItem(templateDraftKey(userId), JSON.stringify(draft));
}

export async function clearHomeworkDraft(userId: string) {
  await AsyncStorage.multiRemove([templateDraftKey(userId), draftKey(userId)]);
  clearHomeworkDraftAssets(userId);
}

export async function loadPictureBookDraft(userId: string) {
  const stored = await AsyncStorage.getItem(draftKey(userId));
  if (!stored) return null;
  try {
    const draft = JSON.parse(stored) as PictureBookPublishDraft;
    return {
      ...draft,
      classroomId: draft.classroomId ?? null,
      cards: draft.cards.map(normalizeDraftCard),
    };
  } catch {
    await AsyncStorage.removeItem(draftKey(userId));
    return null;
  }
}

export function savePictureBookDraft(userId: string, draft: PictureBookPublishDraft) {
  return AsyncStorage.setItem(draftKey(userId), JSON.stringify(draft));
}

export async function clearPictureBookDraft(userId: string) {
  await AsyncStorage.removeItem(draftKey(userId));
  clearHomeworkDraftAssets(userId);
}
