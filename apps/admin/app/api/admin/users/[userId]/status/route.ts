import { forwardJsonBody } from "../../../_proxy";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  return forwardJsonBody(`/api/admin/users/${encodeURIComponent(userId)}/status`, request, "PATCH");
}
