export interface CurrentUser {
  id: string;
  phone: string;
  displayName: string;
  role: "STUDENT" | "TEACHER" | "ADMIN";
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Session {
  token: string;
  user: CurrentUser;
}
