import { forwardAdminRequest } from "../../../_proxy";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ assessmentId: string }> },
) {
  const { assessmentId } = await params;
  return forwardAdminRequest(`/api/admin/speech-assessments/${encodeURIComponent(assessmentId)}/retry`, { method: "POST" });
}
