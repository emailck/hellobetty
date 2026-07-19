import { forwardJsonBody } from "../../../_proxy";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ classroomId: string }> },
) {
  const { classroomId } = await params;
  return forwardJsonBody(`/api/admin/classrooms/${encodeURIComponent(classroomId)}/point-policy`, request, "PUT");
}
