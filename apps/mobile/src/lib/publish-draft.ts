import AsyncStorage from "@react-native-async-storage/async-storage";
import type { HomeworkTemplateType } from "./api";

export interface PictureBookDraftCard {
  id: string;
  imageUrl: string;
  sampleAudioUrl: string;
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
  unit: "DAY" | "WEEK";
  interval: string;
  occurrenceLimit: string;
}

function draftKey(userId: string) {
  return `hello-betty-picture-book-draft:${userId}`;
}

function templateDraftKey(userId: string) {
  return `hello-betty-homework-template-draft:${userId}`;
}

export async function loadHomeworkDraft(userId: string) {
  const stored = await AsyncStorage.getItem(templateDraftKey(userId));
  if (stored) {
    try {
      const draft = JSON.parse(stored) as HomeworkPublishDraft;
      return {
        ...draft,
        classroomId: draft.classroomId ?? null,
        items: draft.items.map((item) => ({ ...item, referenceText: item.referenceText ?? "" })),
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
    items: legacy.cards.map((card) => ({ ...card, referenceText: card.referenceText ?? "", promptText: "", answerText: "", choicesText: "" })),
    selectedIds: legacy.selectedIds,
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
}

export async function loadPictureBookDraft(userId: string) {
  const stored = await AsyncStorage.getItem(draftKey(userId));
  if (!stored) return null;
  try {
    const draft = JSON.parse(stored) as PictureBookPublishDraft;
    return {
      ...draft,
      classroomId: draft.classroomId ?? null,
      cards: draft.cards.map((card) => ({ ...card, referenceText: card.referenceText ?? "" })),
    };
  } catch {
    await AsyncStorage.removeItem(draftKey(userId));
    return null;
  }
}

export function savePictureBookDraft(userId: string, draft: PictureBookPublishDraft) {
  return AsyncStorage.setItem(draftKey(userId), JSON.stringify(draft));
}

export function clearPictureBookDraft(userId: string) {
  return AsyncStorage.removeItem(draftKey(userId));
}
