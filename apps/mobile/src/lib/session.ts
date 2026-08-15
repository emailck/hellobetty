import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { Session } from "../types";

const sessionKey = "hello-betty-session";
const lastLoginPhoneKey = "hello-betty-last-login-phone";

function webStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

async function getStoredValue(key: string) {
  return Platform.OS === "web"
    ? webStorage()?.getItem(key) ?? null
    : SecureStore.getItemAsync(key);
}

async function setStoredValue(key: string, value: string) {
  if (Platform.OS === "web") {
    webStorage()?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function removeStoredValue(key: string) {
  if (Platform.OS === "web") {
    webStorage()?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function loadSession(): Promise<Session | null> {
  const value = await getStoredValue(sessionKey);
  if (!value) return null;
  try {
    return JSON.parse(value) as Session;
  } catch {
    await clearSession();
    return null;
  }
}

export async function saveSession(session: Session) {
  await setStoredValue(sessionKey, JSON.stringify(session));
}

export async function clearSession() {
  await removeStoredValue(sessionKey);
}

export async function loadLastLoginPhone() {
  return getStoredValue(lastLoginPhoneKey);
}

export async function saveLastLoginPhone(phone: string) {
  await setStoredValue(lastLoginPhoneKey, phone);
}
