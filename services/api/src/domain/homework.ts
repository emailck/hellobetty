export const HOMEWORK_STATUS = {
  PUBLISHED: "PUBLISHED",
  PAUSED: "PAUSED",
  ARCHIVED: "ARCHIVED",
} as const;

export const HOMEWORK_TEMPLATE_TYPES = {
  STANDARD: "STANDARD",
  READ_ALOUD_PICTURE_BOOK: "READ_ALOUD_PICTURE_BOOK",
  SENTENCE_READ_ALOUD: "SENTENCE_READ_ALOUD",
  WORD_READ_ALOUD: "WORD_READ_ALOUD",
  WORD_IMAGE_MATCH: "WORD_IMAGE_MATCH",
  WORD_SCRAMBLE: "WORD_SCRAMBLE",
  WORD_FILL_BLANK: "WORD_FILL_BLANK",
} as const;

export type HomeworkTemplateType =
  (typeof HOMEWORK_TEMPLATE_TYPES)[keyof typeof HOMEWORK_TEMPLATE_TYPES];

export const GENERIC_HOMEWORK_TEMPLATE_TYPES = [
  HOMEWORK_TEMPLATE_TYPES.SENTENCE_READ_ALOUD,
  HOMEWORK_TEMPLATE_TYPES.WORD_READ_ALOUD,
  HOMEWORK_TEMPLATE_TYPES.WORD_IMAGE_MATCH,
  HOMEWORK_TEMPLATE_TYPES.WORD_SCRAMBLE,
  HOMEWORK_TEMPLATE_TYPES.WORD_FILL_BLANK,
] as const;

export const RECORDING_HOMEWORK_TEMPLATE_TYPES = [
  HOMEWORK_TEMPLATE_TYPES.SENTENCE_READ_ALOUD,
  HOMEWORK_TEMPLATE_TYPES.WORD_READ_ALOUD,
] as const;

export const OBJECTIVE_HOMEWORK_TEMPLATE_TYPES = [
  HOMEWORK_TEMPLATE_TYPES.WORD_IMAGE_MATCH,
  HOMEWORK_TEMPLATE_TYPES.WORD_SCRAMBLE,
  HOMEWORK_TEMPLATE_TYPES.WORD_FILL_BLANK,
] as const;

export interface HomeworkItemInput {
  promptText?: string;
  imageUrl?: string;
  sampleAudioUrl?: string;
  answerText?: string;
  choices?: string[];
}

export function isGenericHomeworkTemplate(
  templateType: string,
): templateType is (typeof GENERIC_HOMEWORK_TEMPLATE_TYPES)[number] {
  return (GENERIC_HOMEWORK_TEMPLATE_TYPES as readonly string[]).includes(templateType);
}

export function isRecordingHomeworkTemplate(templateType: string): boolean {
  return (RECORDING_HOMEWORK_TEMPLATE_TYPES as readonly string[]).includes(templateType);
}

export function isObjectiveHomeworkTemplate(templateType: string): boolean {
  return (OBJECTIVE_HOMEWORK_TEMPLATE_TYPES as readonly string[]).includes(templateType);
}

export const SCHEDULE_UNITS = {
  DAY: "DAY",
  WEEK: "WEEK",
} as const;

export const OCCURRENCE_STATUS = {
  SCHEDULED: "SCHEDULED",
  AVAILABLE: "AVAILABLE",
  COMPLETED: "COMPLETED",
  EXPIRED: "EXPIRED",
} as const;

export type ScheduleUnit = (typeof SCHEDULE_UNITS)[keyof typeof SCHEDULE_UNITS];

export interface HomeworkSchedule {
  startsAt: string;
  unit: ScheduleUnit;
  interval: number;
  occurrenceLimit: number;
}

export function getOccurrenceTime(
  schedule: HomeworkSchedule,
  sequenceNumber: number,
): string {
  const start = new Date(schedule.startsAt);
  const multiplier = schedule.unit === SCHEDULE_UNITS.DAY ? 1 : 7;
  const offsetDays = (sequenceNumber - 1) * schedule.interval * multiplier;
  return new Date(start.getTime() + offsetDays * 86_400_000).toISOString();
}
