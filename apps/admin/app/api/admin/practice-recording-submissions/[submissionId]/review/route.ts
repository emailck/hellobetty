import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4100";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  const token = (await cookies()).get("hb_admin_token")?.value;
  if (!token) return NextResponse.json({ code: "UNAUTHORIZED", message: "请先登录管理台" }, { status: 401 });
  const { submissionId } = await params;
  const upstream = await fetch(`${apiBaseUrl}/api/admin/practice-recording-submissions/${encodeURIComponent(submissionId)}/review`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(await request.json()),
    cache: "no-store",
  });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}
