import { forwardJsonBody } from "../../../../../_proxy";

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ occurrenceId: string; sourceKind: string; submissionId: string }>;
  },
) {
  const { occurrenceId, sourceKind, submissionId } = await params;
  const path = [occurrenceId, sourceKind, submissionId].map(encodeURIComponent).join("/");
  return forwardJsonBody(`/api/admin/homework-submissions/${path}/review`, request, "POST");
}
