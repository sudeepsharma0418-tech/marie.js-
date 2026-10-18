import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { api, setCsrf } from '../lib/api';
import { Button, ErrorBox, Field, Input, Notice } from '../components/ui';
import { LanguageSwitch } from '../components/Layout';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <img src="/icon.svg" alt="" className="h-10 w-10" />
          <LanguageSwitch />
        </div>
        <h1 className="mb-4 text-xl font-semibold">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const { login, refresh } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'password' | 'mfa'>('password');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (step === 'password') {
        const r = await login(email, password);
        if (r.mfaRequired) setStep('mfa');
        else nav('/');
      } else {
        await api.post('/auth/mfa/verify', { code });
        await refresh();
        nav('/');
      }
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title={step === 'password' ? t('auth.signIn') : t('auth.mfaTitle')}>
      <form onSubmit={submit} className="space-y-3">
        {step === 'password' ? (
          <>
            <Field label={t('auth.email')}>
              <Input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label={t('auth.password')}>
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          </>
        ) : (
          <Field label={t('auth.mfaCode')} hint={t('auth.mfaHint')}>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
        )}
        <ErrorBox error={err} />
        <Button type="submit" className="w-full" loading={busy}>
          {step === 'password' ? t('auth.signIn') : t('auth.verify')}
        </Button>
        <div className="text-center text-sm">
          <Link to="/forgot-password" className="text-brand-700 hover:underline">
            {t('auth.forgot')}
          </Link>
        </div>
      </form>
    </Shell>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  return (
    <Shell title={t('auth.forgot')}>
      {done ? (
        <Notice tone="success">{t('auth.resetSent')}</Notice>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.post('/auth/password/forgot', { email });
              setDone(true);
            } catch (x) {
              setErr(x);
            }
          }}
        >
          <Field label={t('auth.email')}>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <ErrorBox error={err} />
          <Button type="submit" className="w-full">
            {t('auth.sendReset')}
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm">
        <Link to="/login" className="text-brand-700 hover:underline">
          {t('auth.backToLogin')}
        </Link>
      </p>
    </Shell>
  );
}

function PasswordForm({
  submitLabel,
  onSubmit,
}: {
  submitLabel: string;
  onSubmit: (pw: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = pw2.length > 0 && pw !== pw2;
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (mismatch) return;
        setBusy(true);
        try {
          await onSubmit(pw);
        } catch (x) {
          setErr(x);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label={t('auth.newPassword')} hint={t('auth.passwordRule')}>
        <Input
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
      </Field>
      <Field label={t('auth.confirmPassword')} error={mismatch ? t('auth.passwordMismatch') : undefined}>
        <Input
          type="password"
          autoComplete="new-password"
          required
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
        />
      </Field>
      <ErrorBox error={err} />
      <Button type="submit" className="w-full" loading={busy} disabled={mismatch}>
        {submitLabel}
      </Button>
    </form>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const nav = useNavigate();
  return (
    <Shell title={t('auth.resetTitle')}>
      <PasswordForm
        submitLabel={t('auth.setPassword')}
        onSubmit={async (password) => {
          await api.post('/auth/password/reset', { token: params.get('token'), password });
          nav('/login');
        }}
      />
    </Shell>
  );
}

export function AcceptInvitePage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const nav = useNavigate();
  return (
    <Shell title={t('auth.welcome')}>
      <p className="mb-3 text-sm text-slate-600">{t('auth.inviteIntro')}</p>
      <PasswordForm
        submitLabel={t('auth.createAccount')}
        onSubmit={async (password) => {
          const r = await api.post('/auth/invitations/accept', { token: params.get('token'), password });
          setCsrf(r.csrfToken);
          await refresh();
          nav('/');
        }}
      />
    </Shell>
  );
}
