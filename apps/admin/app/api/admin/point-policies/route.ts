import { forwardAdminRequest } from "../_proxy";

export async function GET() {
  return forwardAdminRequest("/api/admin/point-policies");
}
