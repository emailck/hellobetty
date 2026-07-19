export const SPEECH_ASSESSMENT_STATUSES = {
  QUEUED: "QUEUED",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

export type SpeechAssessmentStatus =
  (typeof SPEECH_ASSESSMENT_STATUSES)[keyof typeof SPEECH_ASSESSMENT_STATUSES];

export const SPEECH_ASSESSMENT_SOURCE_KINDS = {
  PICTURE_BOOK_CARD: "PICTURE_BOOK_CARD",
  PRACTICE_ITEM: "PRACTICE_ITEM",
} as const;

export type SpeechAssessmentSourceKind =
  (typeof SPEECH_ASSESSMENT_SOURCE_KINDS)[keyof typeof SPEECH_ASSESSMENT_SOURCE_KINDS];

export interface SpeechPhonemeResult {
  phoneme: string;
  accuracyScore: number | null;
}

export interface SpeechWordResult {
  word: string;
  accuracyScore: number | null;
  errorType: string | null;
  phonemes: SpeechPhonemeResult[];
}

export interface SpeechAssessment {
  id: string;
  status: SpeechAssessmentStatus;
  provider: string | null;
  overallScore: number | null;
  accuracyScore: number | null;
  fluencyScore: number | null;
  completenessScore: number | null;
  prosodyScore: number | null;
  wordResults: SpeechWordResult[] | null;
  completedAt: string | null;
}

export interface SpeechAssessmentRequest {
  assessmentId: string;
  submissionId: string;
  audioPath: string;
  referenceText: string;
  locale: string;
  durationSeconds: number | null;
}

export interface SpeechAssessmentResult {
  overallScore: number | null;
  accuracyScore: number | null;
  fluencyScore: number | null;
  completenessScore: number | null;
  prosodyScore: number | null;
  wordResults: SpeechWordResult[] | null;
  rawResult?: unknown;
}

export interface SpeechAssessmentProvider {
  readonly id: string;
  assess(request: SpeechAssessmentRequest): Promise<SpeechAssessmentResult>;
}

export interface ClaimedSpeechAssessment {
  id: string;
  submissionId: string;
  audioUrl: string;
  referenceText: string;
  locale: string;
  durationSeconds: number | null;
  attemptCount: number;
  leaseToken: string;
}
