import { db } from "./db";

/**
 * Who can see a photo: its owner, or anyone when it is the picture of a
 * public companion. Memory photos are private to their owner.
 */
export async function canSeePhoto(photoId: string, viewerId: string | undefined) {
  const photo = await db.photo.findUnique({ where: { id: photoId }, select: { userId: true } });
  if (!photo) return false;
  if (viewerId && photo.userId === viewerId) return true;
  const shared = await db.companion.count({ where: { photoId, isPublic: true } });
  return shared > 0;
}

/** Checks a photo id sent from a form belongs to this user. Returns the id or null. */
export async function ownPhotoId(photoId: string, userId: string) {
  if (!photoId) return null;
  const photo = await db.photo.findFirst({ where: { id: photoId, userId }, select: { id: true } });
  return photo?.id ?? null;
}

export const photoUrl = (id: string, size: "full" | "thumb" = "thumb") => `/api/photos/${id}${size === "thumb" ? "?size=thumb" : ""}`;
