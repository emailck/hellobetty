import type { NextRequest } from "next/server";
import { forwardAdminRequest } from "../_proxy";

export function GET(request: NextRequest) {
  return forwardAdminRequest(`/api/admin/homework-submissions${request.nextUrl.search}`);
}
