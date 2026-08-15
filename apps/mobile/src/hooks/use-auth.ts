import { useEffect, useState } from "react";
import { ApiError, getCurrentUser, login, register } from "../lib/api";
import { clearSession, loadLastLoginPhone, loadSession, saveLastLoginPhone, saveSession } from "../lib/session";
import type { Session } from "../types";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [lastLoginPhone, setLastLoginPhone] = useState("");
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const [saved, rememberedPhone] = await Promise.all([
          loadSession().catch(() => null),
          loadLastLoginPhone().catch(() => null),
        ]);
        const phone = rememberedPhone ?? saved?.user.phone ?? "";
        setLastLoginPhone(phone);
        if (saved && !rememberedPhone && saved.user.phone) {
          await saveLastLoginPhone(saved.user.phone).catch(() => undefined);
        }
        if (saved) {
          try {
            const current = await getCurrentUser(saved.token);
            setSession({ token: saved.token, user: current.user });
          } catch (cause) {
            if (cause instanceof ApiError && cause.code === "UNAUTHORIZED") {
              await clearSession().catch(() => undefined);
            } else {
              setSession(saved);
            }
          }
        }
      } finally {
        setIsRestoring(false);
      }
    })();
  }, []);

  async function authenticate(nextSession: Session) {
    await saveSession(nextSession);
    await saveLastLoginPhone(nextSession.user.phone).catch(() => undefined);
    setLastLoginPhone(nextSession.user.phone);
    setSession(nextSession);
  }

  async function updateCurrentUser(user: Session["user"]) {
    if (!session) return;
    const nextSession = { ...session, user };
    await saveSession(nextSession);
    setSession(nextSession);
  }

  return {
    session,
    lastLoginPhone,
    isRestoring,
    updateCurrentUser,
    register: async (input: {
      phone: string;
      displayName: string;
      password: string;
    }) => authenticate(await register(input)),
    login: async (phone: string, password: string) =>
      authenticate(await login(phone, password)),
    logout: async () => {
      await clearSession();
      setSession(null);
    },
  };
}
