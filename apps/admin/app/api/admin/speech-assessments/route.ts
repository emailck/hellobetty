import { forwardAdminRequest } from "../_proxy";

export async function GET(request: Request) {
  return forwardAdminRequest(`/api/admin/speech-assessments${new URL(request.url).search}`);
}
