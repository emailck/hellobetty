import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4100";

async function getAdminToken() {
  return (await cookies()).get("hb_admin_token")?.value;
}

export async function GET() {
  const token = await getAdminToken();
  if (!token) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "请先登录管理台" },
      { status: 401 },
    );
  }
  const upstream = await fetch(`${apiBaseUrl}/api/admin/homeworks`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}

export async function POST(request: Request) {
  const token = await getAdminToken();
  if (!token) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "请先登录管理台" },
      { status: 401 },
    );
  }
  const upstream = await fetch(`${apiBaseUrl}/api/admin/homeworks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(await request.json()),
    cache: "no-store",
  });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}
