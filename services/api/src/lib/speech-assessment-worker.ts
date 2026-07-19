import { isAbsolute, relative, resolve } from "node:path";
import type { AccountStore } from "./account-store.js";
import type {
  SpeechAssessmentProvider,
  SpeechAssessmentResult,
  SpeechWordResult,
} from "../domain/speech-assessment.js";

const RETRY_DELAYS_MS = [1_000, 5_000, 30_000] as const;

export class SpeechAssessmentWorker {
  private timer: NodeJS.Timeout | null = null;
  private currentRun: Promise<void> | null = null;

  constructor(
    private readonly store: AccountStore,
    private readonly provider: SpeechAssessmentProvider | null,
    private readonly uploadsPath: string,
    private readonly pollIntervalMs = 2_000,
  ) {}

  start() {
    if (!this.provider || this.timer) return;
    this.timer = setInterval(() => void this.runAvailable(), this.pollIntervalMs);
    this.timer.unref();
    void this.runAvailable();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.currentRun;
  }

  async processNext(now?: Date): Promise<boolean> {
    if (!this.provider) return false;
    const claimTime = now ?? new Date();
    const assessment = this.store.claimNextSpeechAssessment({
      provider: this.provider.id,
      now: claimTime,
    });
    if (!assessment) return false;

    try {
      const result = await this.provider.assess({
        assessmentId: assessment.id,
        submissionId: assessment.submissionId,
        audioPath: resolvePrivateAudioPath(this.uploadsPath, assessment.audioUrl),
        referenceText: assessment.referenceText,
        locale: assessment.locale,
        durationSeconds: assessment.durationSeconds,
      });
      validateResult(result);
      this.store.completeSpeechAssessment({
        assessmentId: assessment.id,
        provider: this.provider.id,
        leaseToken: assessment.leaseToken,
        result,
        now: now ?? new Date(),
      });
    } catch (error) {
      this.store.failSpeechAssessmentAttempt({
        assessmentId: assessment.id,
        provider: this.provider.id,
        leaseToken: assessment.leaseToken,
        error: error instanceof Error ? error.message : "Speech assessment failed",
        retryDelayMs: RETRY_DELAYS_MS[
          Math.min(assessment.attemptCount - 1, RETRY_DELAYS_MS.length - 1)
        ],
        now: now ?? new Date(),
      });
    }
    return true;
  }

  private runAvailable(): Promise<void> {
    if (this.currentRun) return this.currentRun;
    this.currentRun = this.processAvailable().finally(() => {
      this.currentRun = null;
    });
    return this.currentRun;
  }

  private async processAvailable() {
    try {
      while (await this.processNext()) {
        // Drain eligible work; delayed retries wait for the next poll.
      }
    } catch {
      // Individual provider errors are persisted by processNext; polling resumes later.
    }
  }
}

function resolvePrivateAudioPath(uploadsPath: string, audioUrl: string): string {
  const prefix = "/uploads/";
  if (!audioUrl.startsWith(prefix)) throw new Error("Invalid private audio URL");
  const root = resolve(uploadsPath);
  const audioPath = resolve(root, audioUrl.slice(prefix.length));
  const relativePath = relative(root, audioPath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Invalid private audio URL");
  }
  return audioPath;
}

function validateResult(result: SpeechAssessmentResult) {
  for (const score of [
    result.overallScore,
    result.accuracyScore,
    result.fluencyScore,
    result.completenessScore,
    result.prosodyScore,
  ]) {
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) {
      throw new Error("Provider returned a score outside the 0-100 range");
    }
  }
  if (result.wordResults !== null) {
    result.wordResults.forEach(validateWordResult);
  }
}

function validateWordResult(result: SpeechWordResult) {
  if (!result.word || typeof result.word !== "string") {
    throw new Error("Provider returned an invalid word result");
  }
  if (
    result.accuracyScore !== null &&
    (!Number.isFinite(result.accuracyScore) || result.accuracyScore < 0 || result.accuracyScore > 100)
  ) {
    throw new Error("Provider returned an invalid word score");
  }
  if (!Array.isArray(result.phonemes)) {
    throw new Error("Provider returned invalid phoneme results");
  }
  for (const phoneme of result.phonemes) {
    if (!phoneme.phoneme || typeof phoneme.phoneme !== "string") {
      throw new Error("Provider returned an invalid phoneme result");
    }
    if (
      phoneme.accuracyScore !== null &&
      (!Number.isFinite(phoneme.accuracyScore) ||
        phoneme.accuracyScore < 0 || phoneme.accuracyScore > 100)
    ) {
      throw new Error("Provider returned an invalid phoneme score");
    }
  }
}
