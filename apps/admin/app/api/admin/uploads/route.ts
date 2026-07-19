import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4100";

export async function POST(request: Request) {
  const token = (await cookies()).get("hb_admin_token")?.value;
  if (!token) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "请先登录管理台" },
      { status: 401 },
    );
  }
  const upstream = await fetch(`${apiBaseUrl}/api/admin/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: await request.formData(),
    cache: "no-store",
  });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}
