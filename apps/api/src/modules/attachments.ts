import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { attachments } from '../db/schema';
import { ATTACHMENT_CATEGORIES } from '../db/schema/system';
import { ctxOf, guard } from '../plugins/auth';
import { can, isInternal, type Ctx } from '../lib/context';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { idParam, parse } from '../lib/http';
import { audit } from '../lib/audit';

/** Allowed file types, checked by content (magic bytes), not by the client-supplied name. */
const ALLOWED = new Map([
  ['application/pdf', 'pdf'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

type Category = (typeof ATTACHMENT_CATEGORIES)[number];

/** Who may upload which kind of file. */
function canUpload(ctx: Ctx, category: Category): boolean {
  switch (category) {
    case 'request_photo':
      return can(ctx, 'requests.create') || can(ctx, 'requests.manage');
    case 'delivery_evidence':
      return can(ctx, 'delivery.confirm') || can(ctx, 'delivery.manage');
    case 'contract':
      return can(ctx, 'contracts.manage');
    case 'product_image':
      return can(ctx, 'catalog.manage');
    case 'payment_proof':
      return can(ctx, 'payments.record');
    case 'supplier_bill':
      return can(ctx, 'bills.manage');
    default:
      return isInternal(ctx);
  }
}

/** Local disk storage for development and single-server deployments. See docs/DEPLOYMENT.md for object storage. */
export async function attachmentRoutes(app: FastifyInstance) {
  const db = app.db;
  const root = path.resolve(app.config.STORAGE_DIR);

  app.post('/attachments', { preHandler: guard() }, async (req) => {
    const ctx = ctxOf(req);
    const file = await req.file();
    if (!file) throw badRequest('No file uploaded');
    const fields = Object.fromEntries(
      Object.entries(file.fields).map(([k, v]) => [k, (v as { value?: unknown })?.value]),
    );
    const meta = parse(
      z.object({ category: z.enum(ATTACHMENT_CATEGORIES), hotelId: z.uuid().optional() }),
      fields,
    );
    if (!canUpload(ctx, meta.category)) throw forbidden();
    const buf = await file.toBuffer();
    if (file.file.truncated) throw badRequest(`File is larger than ${app.config.MAX_UPLOAD_MB} MB`);
    const type = await fileTypeFromBuffer(buf);
    if (!type || !ALLOWED.has(type.mime)) throw badRequest('Only PDF, JPEG, PNG and WebP files are accepted');
    const hotelId = ctx.actor.hotelId ?? meta.hotelId ?? null;
    const key = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ALLOWED.get(type.mime)}`;
    await fs.mkdir(path.join(root, path.dirname(key)), { recursive: true });
    await fs.writeFile(path.join(root, key), buf, { mode: 0o600 });
    const safeName = file.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';
    const att = await db.transaction(async (tx) => {
      const [a] = await tx
        .insert(attachments)
        .values({
          category: meta.category,
          hotelId,
          // files uploaded by hotel users, and delivery evidence, are visible to that hotel
          internalOnly: !(
            ctx.actor.hotelId ||
            meta.category === 'delivery_evidence' ||
            meta.category === 'product_image'
          ),
          fileName: safeName,
          mimeType: type.mime,
          sizeBytes: buf.length,
          sha256: createHash('sha256').update(buf).digest('hex'),
          storageKey: key,
          uploadedBy: ctx.actor.id,
        })
        .returning();
      await audit(tx, ctx, {
        action: 'attachment.uploaded',
        entityType: 'attachment',
        entityId: a!.id,
        hotelId,
        after: { category: a!.category, fileName: a!.fileName, sizeBytes: a!.sizeBytes },
      });
      return a!;
    });
    return {
      attachment: {
        id: att.id,
        fileName: att.fileName,
        mimeType: att.mimeType,
        sizeBytes: att.sizeBytes,
        category: att.category,
      },
    };
  });

  app.get('/attachments/:id/download', { preHandler: guard() }, async (req, reply) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const [a] = await db.select().from(attachments).where(eq(attachments.id, id));
    if (!a || a.deletedAt) throw notFound('File');
    if (ctx.actor.hotelId) {
      const visible = a.category === 'product_image' || (a.hotelId === ctx.actor.hotelId && !a.internalOnly);
      if (!visible) throw notFound('File');
      if (a.category === 'contract' && !can(ctx, 'contracts.read_own')) throw notFound('File');
    } else if (
      ctx.actor.role === 'driver' &&
      a.category !== 'delivery_evidence' &&
      a.category !== 'product_image'
    ) {
      throw notFound('File');
    } else if (
      ctx.actor.role === 'warehouse' &&
      !['product_image', 'delivery_evidence'].includes(a.category)
    ) {
      throw notFound('File');
    }
    const data = await fs.readFile(path.join(root, a.storageKey));
    return reply
      .type(a.mimeType)
      .header(
        'content-disposition',
        `${a.mimeType.startsWith('image/') ? 'inline' : 'attachment'}; filename="${a.fileName}"`,
      )
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, max-age=300')
      .send(data);
  });
}
