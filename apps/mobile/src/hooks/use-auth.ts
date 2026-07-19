import { useEffect, useState } from "react";
import { getCurrentUser, login, register } from "../lib/api";
import { clearSession, loadSession, saveSession } from "../lib/session";
import type { Session } from "../types";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    void (async () => {
      const saved = await loadSession();
      if (saved) {
        try {
          const current = await getCurrentUser(saved.token);
          setSession({ token: saved.token, user: current.user });
        } catch {
          await clearSession();
        }
      }
      setIsRestoring(false);
    })();
  }, []);

  async function authenticate(nextSession: Session) {
    await saveSession(nextSession);
    setSession(nextSession);
  }

  return {
    session,
    isRestoring,
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
