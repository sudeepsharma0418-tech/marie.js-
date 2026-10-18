import { as, type Client, EMAILS, type TestEnv } from './helpers';

export interface Clients {
  owner: Client;
  proc: Client;
  hub: Client;
  driver: Client;
}

export async function staff(env: TestEnv): Promise<Clients> {
  return {
    owner: await as(env, EMAILS.owner),
    proc: await as(env, EMAILS.procurement),
    hub: await as(env, EMAILS.warehouse),
    driver: await as(env, EMAILS.driver),
  };
}

/**
 * Drives an approved order through sourcing, approved POs, hub receipt,
 * dispatch and a full delivery. Returns the order id and the draft invoice.
 */
export async function fulfilOrder(env: TestEnv, c: Clients, orderId: string, unitCost = '10.00') {
  const { order } = await c.proc.ok(c.proc.get(`/orders/${orderId}`));
  const supplierId = env.seed.supplierIds[3]!;
  for (const l of order.lines) {
    await c.proc.ok(c.proc.put(`/orders/${orderId}/lines/${l.id}/sourcing`, { supplierId, unitCost }));
  }
  const { purchaseOrders } = await c.proc.ok(c.proc.post(`/orders/${orderId}/purchase-orders`, {}));
  for (const po of purchaseOrders) {
    const r = await c.proc.ok(c.proc.post(`/purchase-orders/${po.id}/submit`));
    if (r.approval)
      await c.owner.ok(c.owner.post(`/approvals/${r.approval.id}/decide`, { decision: 'approved' }));
    await c.proc.ok(c.proc.post(`/purchase-orders/${po.id}/send`));
    const detail = await c.hub.ok(c.hub.get(`/purchase-orders/${po.id}`));
    await c.hub.ok(
      c.hub.post(`/purchase-orders/${po.id}/receipts`, {
        lines: detail.lines.map((l: any) => ({ poLineId: l.id, qtyAccepted: l.quantity })),
      }),
    );
  }
  const { delivery } = await c.proc.ok(c.proc.post('/deliveries', { orderId }));
  await c.hub.ok(c.hub.post(`/deliveries/${delivery.id}/dispatch`));
  const d = await c.proc.ok(c.proc.get(`/deliveries/${delivery.id}`));
  await c.proc.ok(
    c.proc.post(`/deliveries/${delivery.id}/confirm`, {
      recipientName: 'Receiver',
      lines: d.lines.map((l: any) => ({ deliveryLineId: l.id, qtyDelivered: l.qtyDispatched })),
    }),
  );
  const drafts = await c.proc.ok(c.proc.get(`/invoices?orderId=${orderId}&status=draft`));
  return { orderId, draftInvoice: drafts.items[0], purchaseOrders };
}

export async function placeOrder(hotelClient: Client, lines: { productId: string; quantity: string }[]) {
  const { order } = await hotelClient.ok(hotelClient.post('/orders', { lines, submit: true }));
  return order;
}
