import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4100";

export async function getAdminToken() {
  return (await cookies()).get("hb_admin_token")?.value;
}

async function readJsonSafely(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { code: "BAD_UPSTREAM_RESPONSE", message: "上游服务返回了无法解析的数据" };
  }
}

export async function forwardAdminRequest(path: string, init: RequestInit = {}) {
  const token = await getAdminToken();
  if (!token) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "请先登录管理台" },
      { status: 401 },
    );
  }

  const upstream = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });

  return NextResponse.json(await readJsonSafely(upstream), { status: upstream.status });
}

export async function forwardJsonBody(path: string, request: Request, method: "POST" | "PATCH" | "PUT") {
  return forwardAdminRequest(path, {
    method,
    body: JSON.stringify(await request.json()),
  });
}
