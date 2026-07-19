import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4100";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ asset: string[] }> },
) {
  const token = (await cookies()).get("hb_admin_token")?.value;
  if (!token) return new NextResponse(null, { status: 401 });
  const { asset } = await params;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const range = request.headers.get("range");
  if (range) headers.Range = range;
  const upstream = await fetch(`${apiBaseUrl}/uploads/${asset.map(encodeURIComponent).join("/")}`, {
    cache: "no-store",
    headers,
  });
  const responseHeaders = new Headers();
  for (const name of ["Accept-Ranges", "Content-Length", "Content-Range", "Content-Type"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
