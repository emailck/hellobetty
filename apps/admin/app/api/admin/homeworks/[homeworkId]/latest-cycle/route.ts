import { forwardAdminRequest } from "../../../_proxy";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ homeworkId: string }> },
) {
  const { homeworkId } = await params;
  return forwardAdminRequest(`/api/admin/homeworks/${encodeURIComponent(homeworkId)}/latest-cycle`);
}
