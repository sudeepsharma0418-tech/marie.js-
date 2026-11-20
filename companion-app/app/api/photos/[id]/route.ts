import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { canSeePhoto } from "@/lib/photos";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  if (!(await canSeePhoto(id, user?.id))) return new Response("Not found", { status: 404 });

  const thumb = new URL(req.url).searchParams.get("size") === "thumb";
  const photo = thumb
    ? await db.photo.findUnique({ where: { id }, select: { mime: true, thumb: true } }).then((p) => p && { mime: p.mime, bytes: p.thumb })
    : await db.photo.findUnique({ where: { id }, select: { mime: true, data: true } }).then((p) => p && { mime: p.mime, bytes: p.data });
  if (!photo) return new Response("Not found", { status: 404 });

  const bytes = photo.bytes;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": photo.mime,
      // Photos never change (a new upload gets a new id), so browsers can keep them.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
