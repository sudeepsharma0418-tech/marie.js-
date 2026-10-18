import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Permission, Role } from '@hp/shared';
import i18n from '../i18n';
import { api, ApiError, setCsrf } from './api';
import { clearOfflineData } from '../offline/db';

export interface Me {
  user: {
    id: string;
    email: string;
    name: string;
    role: Role;
    hotelId: string | null;
    preferredLanguage: 'en' | 'ne';
    mfaEnabled: boolean;
  };
  permissions: Permission[];
  csrfToken: string;
  mfaPending: boolean;
  mfaEnrolmentRequired: boolean;
  offlineAccessHours: number;
  company: { name: string; currency: string };
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  /** Set when the network is down and we could not verify the session. */
  offline: boolean;
  can: (...p: Permission[]) => boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ mfaRequired: boolean }>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const LAST_ME = 'hp.lastMe';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const qc = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<Me>('/auth/me');
      setCsrf(data.csrfToken);
      setMe(data);
      setOffline(false);
      // remember minimal identity so offline inventory can work after a reload
      localStorage.setItem(
        LAST_ME,
        JSON.stringify({
          user: data.user,
          permissions: data.permissions,
          offlineAccessHours: data.offlineAccessHours,
          company: data.company,
        }),
      );
      if (data.user.preferredLanguage && !localStorage.getItem('hp.lang'))
        void i18n.changeLanguage(data.user.preferredLanguage);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        const cached = localStorage.getItem(LAST_ME);
        setMe(
          cached
            ? ({ ...JSON.parse(cached), csrfToken: '', mfaPending: false, mfaEnrolmentRequired: false } as Me)
            : null,
        );
        setOffline(true);
      } else {
        if (e instanceof ApiError && e.status === 401 && e.code !== 'mfa_required') {
          // session ended or was revoked: remove anything cached for offline use
          await clearOfflineData();
          localStorage.removeItem(LAST_ME);
        }
        setMe(null);
        setCsrf(null);
        if (e instanceof ApiError && e.code === 'mfa_required') {
          setMe({ ...(JSON.parse(localStorage.getItem(LAST_ME) ?? 'null') ?? {}), mfaPending: true } as Me);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onOnline = () => void refresh();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const r = await api.post<{ csrfToken: string; mfaRequired: boolean }>('/auth/login', {
        email,
        password,
      });
      setCsrf(r.csrfToken);
      await refresh();
      return { mfaRequired: r.mfaRequired };
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* offline logout still clears local data */
    }
    await clearOfflineData();
    localStorage.removeItem(LAST_ME);
    setCsrf(null);
    setMe(null);
    qc.clear();
  }, [qc]);

  const value = useMemo<AuthState>(
    () => ({
      me,
      loading,
      offline,
      can: (...p) => !!me?.permissions && p.some((x) => me.permissions.includes(x)),
      refresh,
      login,
      logout,
    }),
    [me, loading, offline, refresh, login, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
