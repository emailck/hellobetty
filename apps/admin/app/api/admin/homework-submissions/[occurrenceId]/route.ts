import { forwardAdminRequest } from "../../_proxy";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ occurrenceId: string }> },
) {
  const { occurrenceId } = await params;
  return forwardAdminRequest(`/api/admin/homework-submissions/${encodeURIComponent(occurrenceId)}`);
}
