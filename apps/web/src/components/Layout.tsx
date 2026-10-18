import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { Permission } from '@hp/shared';
import { useAuth } from '../lib/auth';
import { useCart } from '../lib/cart';
import { api } from '../lib/api';
import { useSyncStatus } from '../offline/sync';
import { cx } from './ui';

interface NavItem {
  to: string;
  label: string;
  perms?: Permission[];
  roles?: string[];
}

export function LanguageSwitch({ className }: { className?: string }) {
  const { i18n, t } = useTranslation();
  return (
    <div
      className={cx('inline-flex rounded-lg border border-slate-300 bg-white text-xs', className)}
      role="group"
      aria-label={t('common.language')}
    >
      {(['en', 'ne'] as const).map((l) => (
        <button
          key={l}
          onClick={() => {
            void i18n.changeLanguage(l);
            void api.patch('/auth/me', { preferredLanguage: l }).catch(() => undefined);
          }}
          aria-pressed={i18n.language === l}
          className={cx(
            'px-2.5 py-1 first:rounded-l-lg last:rounded-r-lg',
            i18n.language === l ? 'bg-brand-700 text-white' : 'text-slate-700 hover:bg-slate-50',
          )}
        >
          {l === 'en' ? 'English' : 'नेपाली'}
        </button>
      ))}
    </div>
  );
}

export function SyncIndicator() {
  const { t } = useTranslation();
  const s = useSyncStatus();
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  if (!online)
    return (
      <span
        className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"
        role="status"
      >
        {t('sync.offline')}
        {s.pending > 0 && ` · ${t('sync.pending', { count: s.pending })}`}
      </span>
    );
  if (s.sessionExpired)
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
        {t('sync.sessionExpired')}
      </span>
    );
  if (s.pending > 0)
    return (
      <span
        className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"
        role="status"
      >
        {s.syncing ? t('sync.syncing') : t('sync.pending', { count: s.pending })}
      </span>
    );
  return null;
}

export function Layout({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const { me, can, logout, offline } = useAuth();
  const cart = useCart();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications'),
    enabled: !!me && !offline,
    refetchInterval: 60_000,
  });

  const items: NavItem[] = [
    { to: '/', label: t('nav.dashboard') },
    { to: '/catalog', label: t('nav.catalog'), perms: ['orders.create'] },
    { to: '/orders', label: t('nav.orders'), perms: ['orders.read_all', 'orders.read_own_hotel'] },
    { to: '/requests', label: t('nav.requests'), perms: ['requests.create', 'requests.manage'] },
    {
      to: '/scan',
      label: t('nav.scan'),
      perms: ['hotel_inventory.record'],
      roles: ['hotel_manager', 'hotel_inventory', 'hotel_purchaser'],
    },
    {
      to: '/inventory',
      label: t('nav.inventory'),
      perms: ['hotel_inventory.view'],
      roles: ['hotel_manager', 'hotel_purchaser', 'hotel_inventory'],
    },
    { to: '/invoices', label: t('nav.invoices'), perms: ['finance.view_all', 'finance.view_own_hotel'] },
    {
      to: '/statement',
      label: t('nav.statement'),
      perms: ['finance.view_own_hotel'],
      roles: ['hotel_manager'],
    },
    { to: '/approvals', label: t('nav.approvals'), perms: ['approvals.decide', 'approvals.request'] },
    { to: '/purchase-orders', label: t('nav.purchaseOrders'), perms: ['procurement.manage', 'hub.receive'] },
    { to: '/hub', label: t('nav.hub'), perms: ['hub.stock.view'] },
    {
      to: '/deliveries',
      label: t('nav.deliveries'),
      perms: ['delivery.manage', 'delivery.view_assigned', 'hub.dispatch'],
    },
    { to: '/hotels', label: t('nav.hotels'), perms: ['hotels.read_all'] },
    { to: '/suppliers', label: t('nav.suppliers'), perms: ['suppliers.read'] },
    { to: '/products', label: t('nav.products'), perms: ['catalog.manage'] },
    { to: '/pricing', label: t('nav.pricing'), perms: ['pricing.manage'] },
    { to: '/payments', label: t('nav.payments'), perms: ['payments.record'] },
    { to: '/bills', label: t('nav.bills'), perms: ['bills.manage'] },
    {
      to: '/reports',
      label: t('nav.reports'),
      perms: [
        'reports.business',
        'reports.financial',
        'reports.inventory',
        'reports.operations',
        'reports.own_hotel',
      ],
    },
    { to: '/users', label: t('nav.users'), perms: ['users.manage_internal', 'users.manage_own_hotel'] },
    { to: '/settings', label: t('nav.settings'), perms: ['settings.manage'] },
    { to: '/audit', label: t('nav.audit'), perms: ['audit.view'] },
  ];
  const visible = items.filter(
    (i) => (!i.perms || can(...i.perms)) && (!i.roles || (me && i.roles.includes(me.user.role))),
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside
        className={cx(
          'no-print fixed inset-y-0 left-0 z-30 w-64 transform border-r border-slate-200 bg-white transition lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <img src="/icon.svg" alt="" className="h-7 w-7" />
          <span className="truncate font-semibold">{me?.company.name ?? 'HotelProc'}</span>
        </div>
        <nav
          className="flex max-h-[calc(100vh-3.5rem)] flex-col gap-0.5 overflow-y-auto p-2"
          aria-label={t('nav.main')}
        >
          {visible.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cx(
                  'rounded-lg px-3 py-2 text-sm',
                  isActive ? 'bg-brand-50 font-semibold text-brand-800' : 'text-slate-700 hover:bg-slate-100',
                )
              }
            >
              {i.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      {open && (
        <div
          className="fixed inset-0 z-20 bg-slate-900/30 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/95 px-3 backdrop-blur sm:px-4">
          <button
            className="rounded-lg p-2 hover:bg-slate-100 lg:hidden"
            onClick={() => setOpen(true)}
            aria-label={t('nav.menu')}
          >
            ☰
          </button>
          <SyncIndicator />
          {offline && <span className="text-xs text-amber-700">{t('sync.offlineLimited')}</span>}
          <div className="ml-auto flex items-center gap-2">
            {can('orders.create') && (
              <button
                onClick={() => nav('/cart')}
                className="relative rounded-lg px-2 py-1 text-sm hover:bg-slate-100"
                aria-label={t('nav.cart')}
              >
                🛒 <span className="hidden sm:inline">{t('nav.cart')}</span>
                {cart.lines.length > 0 && (
                  <span className="ml-1 rounded-full bg-brand-700 px-1.5 text-xs text-white">
                    {cart.lines.length}
                  </span>
                )}
              </button>
            )}
            <button
              onClick={() => nav('/notifications')}
              className="relative rounded-lg px-2 py-1 text-sm hover:bg-slate-100"
              aria-label={t('nav.notifications')}
            >
              🔔
              {(notifications.data?.unread ?? 0) > 0 && (
                <span className="ml-1 rounded-full bg-red-600 px-1.5 text-xs text-white">
                  {notifications.data.unread}
                </span>
              )}
            </button>
            <LanguageSwitch className="hidden sm:inline-flex" />
            <button
              onClick={() => nav('/profile')}
              className="hidden max-w-40 truncate rounded-lg px-2 py-1 text-sm hover:bg-slate-100 sm:block"
            >
              {me?.user.name}
            </button>
            <button
              onClick={async () => {
                await logout();
                nav('/login');
              }}
              className="rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
            >
              {t('auth.logout')}
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-3 sm:p-6">{children ?? <Outlet />}</main>
      </div>
    </div>
  );
}
