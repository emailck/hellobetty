import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { Session } from "../types";

const sessionKey = "hello-betty-session";

function webStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

export async function loadSession(): Promise<Session | null> {
  const value =
    Platform.OS === "web"
      ? webStorage()?.getItem(sessionKey) ?? null
      : await SecureStore.getItemAsync(sessionKey);
  if (!value) return null;
  try {
    return JSON.parse(value) as Session;
  } catch {
    await clearSession();
    return null;
  }
}

export async function saveSession(session: Session) {
  const value = JSON.stringify(session);
  if (Platform.OS === "web") {
    webStorage()?.setItem(sessionKey, value);
    return;
  }
  await SecureStore.setItemAsync(sessionKey, value);
}

export async function clearSession() {
  if (Platform.OS === "web") {
    webStorage()?.removeItem(sessionKey);
    return;
  }
  await SecureStore.deleteItemAsync(sessionKey);
}
