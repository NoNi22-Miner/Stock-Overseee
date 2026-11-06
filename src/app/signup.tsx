import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, styles } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

/** Team Leader sign-up with email. Team members get accounts from their Team Leader instead. */
export default function SignUp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function signUp() {
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (error) {
      Alert.alert('Sign up failed', error.message);
      return;
    }
    // With email confirmation on, there is no session yet: the user confirms, then signs in.
    if (!data.session) setSentTo(email.trim());
  }

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ready = validEmail && password.length >= 8 && password === confirm;

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.pad, { flexGrow: 1, justifyContent: 'center', gap: 16 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: 4, marginBottom: 8 }}>
            <Text style={{ fontSize: 26, fontWeight: '800', color: colors.text }}>Team Leader sign up</Text>
            <Text style={styles.muted}>
              Create your own team. You can then add Oversee, Staff and Onlooker accounts for your people.
            </Text>
          </View>

          {sentTo ? (
            <View style={[styles.card, { gap: 10 }]}>
              <Text style={styles.title}>Check your email</Text>
              <Text style={{ color: colors.text }}>
                We sent a confirmation link to {sentTo}. Open it, then come back and sign in.
              </Text>
              <Button title="Back to sign in" onPress={() => router.replace('/login')} />
            </View>
          ) : (
            <>
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
                label="Password (min 8 characters)"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="new-password"
              />
              <Field
                label="Repeat password"
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoComplete="new-password"
              />
              {confirm.length > 0 && confirm !== password && (
                <Text style={{ color: colors.out }}>Passwords do not match.</Text>
              )}
              <Button title="Sign up" onPress={signUp} loading={busy} disabled={!ready} />
              <Button title="Back to sign in" variant="outline" onPress={() => router.replace('/login')} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
