import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money } from '../lib/format';
import { Button, ErrorBox, Notice, PageHeader, Spinner, Stat } from '../components/ui';

export function DashboardPage() {
  const { t } = useTranslation();
  const { me, can, offline } = useAuth();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get('/dashboard'), enabled: !offline });
  const d = q.data ?? {};
  const role = me?.user.role;

  if (offline)
    return (
      <div className="space-y-4">
        <PageHeader title={t('dashboard.hello', { name: me?.user.name })} />
        <Notice tone="warn">{t('sync.offlineDashboard')}</Notice>
        {can('hotel_inventory.record') && (
          <Link to="/scan">
            <Button size="lg">{t('nav.scan')}</Button>
          </Link>
        )}
      </div>
    );

  return (
    <div className="space-y-6">
      <PageHeader title={t('dashboard.hello', { name: me?.user.name })} subtitle={t(`roles.${role}`)} />
      {me?.mfaEnrolmentRequired && <Notice tone="warn">{t('auth.mfaRequiredNotice')}</Notice>}
      {q.isLoading && <Spinner />}
      <ErrorBox error={q.error} />
      {(role === 'owner' || role === 'procurement') && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Link to="/approvals">
              <Stat
                label={t('dashboard.pendingApprovals')}
                value={d.pending_approvals ?? 0}
                tone={d.pending_approvals ? 'warn' : undefined}
              />
            </Link>
            <Link to="/orders?statuses=approved">
              <Stat label={t('dashboard.ordersToSource')} value={d.orders_to_source ?? 0} />
            </Link>
            <Link to="/orders?statuses=procurement,consolidating">
              <Stat label={t('dashboard.inProcurement')} value={d.orders_in_procurement ?? 0} />
            </Link>
            <Link to="/orders?statuses=ready_for_dispatch">
              <Stat label={t('dashboard.readyForDispatch')} value={d.orders_ready ?? 0} />
            </Link>
            <Link to="/requests">
              <Stat label={t('dashboard.openRequests')} value={d.open_requests ?? 0} />
            </Link>
            <Link to="/invoices?status=draft">
              <Stat label={t('dashboard.draftInvoices')} value={d.draft_invoices ?? 0} />
            </Link>
            <Link to="/purchase-orders?status=approved">
              <Stat label={t('dashboard.posToSend')} value={d.pos_to_send ?? 0} />
            </Link>
            {d.overdue_invoices !== undefined && (
              <Link to="/reports?tab=ar">
                <Stat
                  label={t('dashboard.overdueInvoices')}
                  value={d.overdue_invoices}
                  tone={d.overdue_invoices ? 'warn' : undefined}
                />
              </Link>
            )}
          </div>
          {d.receivables !== undefined && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat label={t('dashboard.receivables')} value={money(d.receivables)} />
              <Stat label={t('dashboard.payables')} value={money(d.payables)} />
              <Stat label={t('dashboard.salesThisMonth')} value={money(d.sales_this_month)} tone="good" />
            </div>
          )}
        </>
      )}
      {role === 'warehouse' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Link to="/purchase-orders">
            <Stat label={t('dashboard.posToReceive')} value={d.pos_to_receive ?? 0} />
          </Link>
          <Link to="/hub?tab=consolidation">
            <Stat label={t('dashboard.consolidating')} value={d.orders_consolidating ?? 0} />
          </Link>
          <Link to="/deliveries">
            <Stat label={t('dashboard.toDispatch')} value={d.deliveries_to_dispatch ?? 0} />
          </Link>
        </div>
      )}
      {role === 'driver' && (
        <div className="grid grid-cols-2 gap-3">
          <Link to="/deliveries">
            <Stat label={t('dashboard.myOpenDeliveries')} value={d.my_open_deliveries ?? 0} />
          </Link>
          <Stat label={t('dashboard.myDeliveriesToday')} value={d.my_deliveries_today ?? 0} />
        </div>
      )}
      {me?.user.hotelId && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {d.open_orders !== undefined && can('orders.read_own_hotel') && (
              <Link to="/orders">
                <Stat label={t('dashboard.openOrders')} value={d.open_orders} />
              </Link>
            )}
            {d.awaiting_my_approval !== undefined && can('orders.approve_hotel') && (
              <Link to="/orders?statuses=pending_hotel_approval">
                <Stat
                  label={t('dashboard.awaitingMyApproval')}
                  value={d.awaiting_my_approval}
                  tone={d.awaiting_my_approval ? 'warn' : undefined}
                />
              </Link>
            )}
            {d.drafts !== undefined && can('orders.create') && (
              <Link to="/orders?statuses=draft">
                <Stat label={t('dashboard.drafts')} value={d.drafts} />
              </Link>
            )}
            {d.outstanding_balance !== undefined && (
              <Link to="/statement">
                <Stat label={t('dashboard.outstanding')} value={money(d.outstanding_balance)} />
              </Link>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {can('orders.create') && (
              <Link to="/catalog">
                <Button size="lg">{t('dashboard.startOrder')}</Button>
              </Link>
            )}
            {can('hotel_inventory.record') && (
              <Link to="/scan">
                <Button size="lg" variant="secondary">
                  {t('nav.scan')}
                </Button>
              </Link>
            )}
            {can('requests.create') && (
              <Link to="/requests/new">
                <Button size="lg" variant="secondary">
                  {t('requests.new')}
                </Button>
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}
