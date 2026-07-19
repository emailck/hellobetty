import { forwardJsonBody } from "../../../_proxy";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ homeworkId: string }> },
) {
  const { homeworkId } = await params;
  return forwardJsonBody(`/api/admin/homeworks/${encodeURIComponent(homeworkId)}/status`, request, "PATCH");
}
