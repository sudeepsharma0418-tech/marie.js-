import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth';
import { userRoutes } from './users';
import { settingsRoutes } from './settings';
import { hotelRoutes } from './hotels';
import { supplierRoutes } from './suppliers';
import { catalogRoutes } from './catalog';
import { orderRoutes } from './orders';
import { requestRoutes } from './requests';
import { procurementRoutes } from './procurement';
import { hubRoutes } from './hub';
import { deliveryRoutes } from './delivery';
import { hotelInventoryRoutes } from './hotel-inventory';
import { financeRoutes } from './finance';
import { approvalRoutes } from './approvals';
import { reportRoutes } from './reports';
import { attachmentRoutes } from './attachments';
import { adminRoutes } from './admin';

export async function registerRoutes(app: FastifyInstance) {
  for (const r of [
    authRoutes,
    userRoutes,
    settingsRoutes,
    hotelRoutes,
    supplierRoutes,
    catalogRoutes,
    orderRoutes,
    requestRoutes,
    procurementRoutes,
    hubRoutes,
    deliveryRoutes,
    hotelInventoryRoutes,
    financeRoutes,
    approvalRoutes,
    reportRoutes,
    attachmentRoutes,
    adminRoutes,
  ]) {
    await r(app);
  }
}
