import type { UserRecord } from "../lib/account-store.js";

export const USER_ROLES = {
  STUDENT: "STUDENT",
  TEACHER: "TEACHER",
  ADMIN: "ADMIN",
} as const;

export const USER_STATUSES = {
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export function normalizePhone(phone: string): string {
  let normalized = phone.trim().replace(/[\s-]/g, "");
  if (normalized.startsWith("+86")) normalized = normalized.slice(3);
  else if (normalized.startsWith("86") && normalized.length === 13) {
    normalized = normalized.slice(2);
  }
  return normalized;
}

export function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone);
}

export function toPublicUser(user: UserRecord) {
  return {
    id: user.id,
    phone: user.phone,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}
