import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { PHOTO_LIMITS } from "@/lib/config";

export const runtime = "nodejs";

const ALLOWED = ["image/jpeg", "image/webp", "image/png"];
const json = (data: unknown, status = 200) => Response.json(data, { status });

/** Upload a photo that was already shrunk in the browser (full size + thumbnail). */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return json({ error: "Please log in again." }, 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Bad upload." }, 400);
  }
  const full = form.get("full");
  const thumb = form.get("thumb");
  const width = Number(form.get("width"));
  const height = Number(form.get("height"));
  if (!(full instanceof File) || !(thumb instanceof File)) return json({ error: "Missing photo." }, 400);
  if (!ALLOWED.includes(full.type) || !ALLOWED.includes(thumb.type)) return json({ error: "Please use a JPG, PNG or WebP photo." }, 400);
  if (full.size > PHOTO_LIMITS.maxBytes || thumb.size > PHOTO_LIMITS.maxBytes) return json({ error: "That photo is too large." }, 400);
  if (!(width > 0 && height > 0 && width <= 4000 && height <= 4000)) return json({ error: "Bad photo size." }, 400);

  const count = await db.photo.count({ where: { userId: user.id } });
  if (count >= PHOTO_LIMITS.perUser) return json({ error: `You can store up to ${PHOTO_LIMITS.perUser} photos for now.` }, 400);

  const photo = await db.photo.create({
    data: {
      userId: user.id,
      mime: full.type,
      width: Math.round(width),
      height: Math.round(height),
      data: Buffer.from(await full.arrayBuffer()),
      thumb: Buffer.from(await thumb.arrayBuffer()),
    },
    select: { id: true },
  });
  return json({ id: photo.id });
}
