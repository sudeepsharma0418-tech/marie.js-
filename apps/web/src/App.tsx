import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Permission } from '@hp/shared';
import { useAuth } from './lib/auth';
import { startSync } from './offline/sync';
import { Layout } from './components/Layout';
import { Notice, Spinner } from './components/ui';
import { AcceptInvitePage, ForgotPasswordPage, LoginPage, ResetPasswordPage } from './pages/Auth';
import { DashboardPage } from './pages/Dashboard';
import { CartPage, CatalogPage } from './pages/Catalog';
import { OrderDetailPage, OrderListPage } from './pages/Orders';
import { ScanHistoryPage, ScanHomePage, ScanShelfPage } from './pages/Scan';
import { InventoryPage } from './pages/Inventory';
import {
  BillDetailPage,
  BillsPage,
  InvoiceDetailPage,
  InvoiceListPage,
  NewBillPage,
  PaymentsPage,
  RecordPaymentPage,
  StatementPage,
} from './pages/Finance';
import {
  DeliveriesPage,
  DeliveryDetailPage,
  HubPage,
  PurchaseOrderDetailPage,
  PurchaseOrderListPage,
} from './pages/Operations';
import {
  ApprovalsPage,
  HotelDetailPage,
  HotelListPage,
  NewRequestPage,
  PricingPage,
  ProductAdminPage,
  RequestDetailPage,
  RequestListPage,
  SupplierDetailPage,
  SupplierListPage,
} from './pages/Admin';
import {
  AuditPage,
  NotFoundPage,
  NotificationsPage,
  ProfilePage,
  ReportsPage,
  SettingsPage,
  UsersPage,
} from './pages/System';

/** Client-side route guard for a clear permission-denied state. The API enforces the real rules. */
function Need({ perms, children }: { perms: Permission[]; children: ReactNode }) {
  const { can } = useAuth();
  const { t } = useTranslation();
  if (!can(...perms)) return <Notice tone="error">{t('errors.forbidden')}</Notice>;
  return <>{children}</>;
}

/** Routes that keep working offline (only the shelf inventory workflow). */
const OFFLINE_OK = ['/scan', '/'];

export function App() {
  const { me, loading, offline, can } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();

  useEffect(() => {
    if (me?.user && can('hotel_inventory.record') && me.user.hotelId) return startSync(me.user.id);
  }, [me?.user, can]);

  if (loading) return <Spinner />;
  if (!me || me.mfaPending) {
    return (
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  if (offline && !OFFLINE_OK.some((p) => location.pathname === p || location.pathname.startsWith('/scan'))) {
    return (
      <Layout>
        <Notice tone="warn">{t('sync.offlinePage')}</Notice>
      </Layout>
    );
  }
  if (me.mfaEnrolmentRequired && location.pathname !== '/profile') return <Navigate to="/profile" replace />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route
          path="catalog"
          element={
            <Need perms={['orders.create']}>
              <CatalogPage />
            </Need>
          }
        />
        <Route
          path="cart"
          element={
            <Need perms={['orders.create']}>
              <CartPage />
            </Need>
          }
        />
        <Route
          path="orders"
          element={
            <Need perms={['orders.read_all', 'orders.read_own_hotel']}>
              <OrderListPage />
            </Need>
          }
        />
        <Route
          path="orders/:id"
          element={
            <Need perms={['orders.read_all', 'orders.read_own_hotel']}>
              <OrderDetailPage />
            </Need>
          }
        />
        <Route
          path="requests"
          element={
            <Need perms={['requests.create', 'requests.manage']}>
              <RequestListPage />
            </Need>
          }
        />
        <Route
          path="requests/new"
          element={
            <Need perms={['requests.create']}>
              <NewRequestPage />
            </Need>
          }
        />
        <Route
          path="requests/:id"
          element={
            <Need perms={['requests.create', 'requests.manage']}>
              <RequestDetailPage />
            </Need>
          }
        />
        <Route
          path="scan"
          element={
            <Need perms={['hotel_inventory.record']}>
              <ScanHomePage />
            </Need>
          }
        />
        <Route
          path="scan/history"
          element={
            <Need perms={['hotel_inventory.record']}>
              <ScanHistoryPage />
            </Need>
          }
        />
        <Route
          path="scan/:token"
          element={
            <Need perms={['hotel_inventory.record']}>
              <ScanShelfPage />
            </Need>
          }
        />
        <Route
          path="inventory"
          element={
            <Need perms={['hotel_inventory.view', 'hotels.read_all']}>
              <InventoryPage />
            </Need>
          }
        />
        <Route
          path="invoices"
          element={
            <Need perms={['finance.view_all', 'finance.view_own_hotel']}>
              <InvoiceListPage />
            </Need>
          }
        />
        <Route
          path="invoices/:id"
          element={
            <Need perms={['finance.view_all', 'finance.view_own_hotel']}>
              <InvoiceDetailPage />
            </Need>
          }
        />
        <Route
          path="statement"
          element={
            <Need perms={['finance.view_all', 'finance.view_own_hotel']}>
              <StatementPage />
            </Need>
          }
        />
        <Route
          path="payments"
          element={
            <Need perms={['payments.record']}>
              <PaymentsPage />
            </Need>
          }
        />
        <Route
          path="payments/new"
          element={
            <Need perms={['payments.record']}>
              <RecordPaymentPage />
            </Need>
          }
        />
        <Route
          path="bills"
          element={
            <Need perms={['bills.manage']}>
              <BillsPage />
            </Need>
          }
        />
        <Route
          path="bills/new"
          element={
            <Need perms={['bills.manage']}>
              <NewBillPage />
            </Need>
          }
        />
        <Route
          path="bills/:id"
          element={
            <Need perms={['bills.manage', 'finance.view_all']}>
              <BillDetailPage />
            </Need>
          }
        />
        <Route
          path="approvals"
          element={
            <Need perms={['approvals.decide', 'approvals.request']}>
              <ApprovalsPage />
            </Need>
          }
        />
        <Route
          path="purchase-orders"
          element={
            <Need perms={['procurement.manage', 'hub.receive']}>
              <PurchaseOrderListPage />
            </Need>
          }
        />
        <Route
          path="purchase-orders/:id"
          element={
            <Need perms={['procurement.manage', 'hub.receive']}>
              <PurchaseOrderDetailPage />
            </Need>
          }
        />
        <Route
          path="hub"
          element={
            <Need perms={['hub.stock.view']}>
              <HubPage />
            </Need>
          }
        />
        <Route
          path="deliveries"
          element={
            <Need perms={['delivery.manage', 'delivery.view_assigned', 'hub.dispatch']}>
              <DeliveriesPage />
            </Need>
          }
        />
        <Route
          path="deliveries/:id"
          element={
            <Need
              perms={['delivery.manage', 'delivery.view_assigned', 'hub.dispatch', 'orders.read_own_hotel']}
            >
              <DeliveryDetailPage />
            </Need>
          }
        />
        <Route
          path="hotels"
          element={
            <Need perms={['hotels.read_all']}>
              <HotelListPage />
            </Need>
          }
        />
        <Route
          path="hotels/:id"
          element={
            <Need perms={['hotels.read_all']}>
              <HotelDetailPage />
            </Need>
          }
        />
        <Route
          path="suppliers"
          element={
            <Need perms={['suppliers.read']}>
              <SupplierListPage />
            </Need>
          }
        />
        <Route
          path="suppliers/:id"
          element={
            <Need perms={['suppliers.read']}>
              <SupplierDetailPage />
            </Need>
          }
        />
        <Route
          path="products"
          element={
            <Need perms={['catalog.manage']}>
              <ProductAdminPage />
            </Need>
          }
        />
        <Route
          path="pricing"
          element={
            <Need perms={['pricing.manage']}>
              <PricingPage />
            </Need>
          }
        />
        <Route path="reports" element={<ReportsPage />} />
        <Route
          path="users"
          element={
            <Need perms={['users.manage_internal', 'users.manage_own_hotel']}>
              <UsersPage />
            </Need>
          }
        />
        <Route
          path="settings"
          element={
            <Need perms={['settings.manage']}>
              <SettingsPage />
            </Need>
          }
        />
        <Route
          path="audit"
          element={
            <Need perms={['audit.view']}>
              <AuditPage />
            </Need>
          }
        />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
