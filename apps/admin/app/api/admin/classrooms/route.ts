import { forwardAdminRequest, forwardJsonBody } from "../_proxy";

export async function GET() {
  return forwardAdminRequest("/api/admin/classrooms");
}

export async function POST(request: Request) {
  return forwardJsonBody("/api/admin/classrooms", request, "POST");
}
