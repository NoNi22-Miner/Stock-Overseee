import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, styles } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'in' | 'up' | null>(null);

  async function signIn() {
    setBusy('in');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(null);
    if (error) Alert.alert('Sign in failed', error.message);
  }

  async function signUp() {
    setBusy('up');
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    setBusy(null);
    if (error) Alert.alert('Sign up failed', error.message);
    else if (!data.session) Alert.alert('Check your email', 'Open the confirmation link, then sign in.');
  }

  const ready = email.includes('@') && password.length >= 6;

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center' }}
      >
        <View style={[styles.pad, { gap: 16 }]}>
          <View style={{ gap: 4, marginBottom: 12 }}>
            <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text }}>Stock Overseee</Text>
            <Text style={styles.muted}>Warehouse & store stock, by scan.</Text>
          </View>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@example.com"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            placeholder="At least 6 characters"
          />
          <Button title="Sign in" onPress={signIn} loading={busy === 'in'} disabled={!ready || !!busy} />
          <Button
            title="Create account"
            variant="outline"
            onPress={signUp}
            loading={busy === 'up'}
            disabled={!ready || !!busy}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
