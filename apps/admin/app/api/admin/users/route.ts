import { forwardAdminRequest, forwardJsonBody } from "../_proxy";

export async function GET(request: Request) {
  return forwardAdminRequest(`/api/admin/users${new URL(request.url).search}`);
}

export async function POST(request: Request) {
  return forwardJsonBody("/api/admin/users", request, "POST");
}
