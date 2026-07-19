import { NextResponse } from "next/server";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4100";

export async function POST(request: Request) {
  const credentials = await request.json();
  const upstream = await fetch(`${apiBaseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
    cache: "no-store",
  });
  const body = await upstream.json();
  if (!upstream.ok) return NextResponse.json(body, { status: upstream.status });
  if (!(["ADMIN", "TEACHER"].includes(body.user?.role))) {
    return NextResponse.json({ code: "FORBIDDEN", message: "当前账号没有老师管理权限" }, { status: 403 });
  }
  const response = NextResponse.json({ user: body.user });
  response.cookies.set("hb_admin_token", body.token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
