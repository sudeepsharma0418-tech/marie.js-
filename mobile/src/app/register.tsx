import React, { useState } from 'react';
import { Banner, Body, Button, Field, Screen } from '../components/ui';
import { useAppStore } from '../state/AppStore';

export default function Register() {
  const { actions } = useAppStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== password;
  const tooShort = password.length > 0 && password.length < 8;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await actions.register(name.trim(), email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create your account. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Body muted>Your account links your phones together. Each phone still needs your approval before anyone can see it.</Body>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" placeholder="Sudeep" />
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        error={tooShort ? 'Use at least 8 characters.' : undefined}
      />
      <Field
        label="Confirm password"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoComplete="new-password"
        error={mismatch ? 'Passwords do not match.' : undefined}
      />
      <Button
        title="Create Account"
        onPress={submit}
        loading={busy}
        disabled={!name || !email || password.length < 8 || confirm !== password}
      />
    </Screen>
  );
}
