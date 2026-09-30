import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { router } from 'expo-router';
import { Banner, Body, Button, Field, Screen, Title } from '../components/ui';
import { useAppStore } from '../state/AppStore';
import { spacing } from '../theme';

/**
 * Our own sign in screen is intentionally NOT marked as secure (no
 * FLAG_SECURE on Android), so it never turns into a black rectangle during a
 * support session. The password itself is still masked with dots. Note that
 * iOS may still omit the contents of a secure text field from a capture;
 * that is OS behavior we respect, and the rest of the screen stays visible.
 */
export default function Login() {
  const { actions } = useAppStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await actions.login(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen edges={['top', 'bottom']}>
        <View style={{ gap: spacing.sm, marginTop: spacing.xxl }}>
          <Title>PeerView</Title>
          <Body muted>Share your phone screen with people you trust, only when you say so.</Body>
        </View>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          placeholder="you@example.com"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          placeholder="••••••••"
          onSubmitEditing={submit}
        />
        <Button title="Sign In" onPress={submit} loading={busy} disabled={!email || !password} />
        <Button kind="ghost" title="Create an account" onPress={() => router.push('/register')} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
