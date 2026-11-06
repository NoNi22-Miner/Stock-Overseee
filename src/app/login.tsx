import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, styles } from '../components/ui';
import { resolveLogin } from '../lib/api';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

/** One login panel for everyone: UserID, Username or email + password. */
export default function Login() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    try {
      const email = await resolveLogin(login);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        // Same message whatever was wrong, so it does not reveal which accounts exist.
        Alert.alert(
          'Sign in failed',
          /invalid login credentials|banned/i.test(error.message) ? 'Wrong login or password.' : error.message,
        );
      }
    } catch (e) {
      Alert.alert('Sign in failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ready = login.trim().length >= 3 && password.length >= 6;

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.pad, { flexGrow: 1, justifyContent: 'center', gap: 16 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: 4, marginBottom: 12 }}>
            <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text }}>Stock Overseee</Text>
            <Text style={styles.muted}>Warehouse & store stock, by scan.</Text>
          </View>

          <Field
            label="UserID / Username / Email"
            value={login}
            onChangeText={setLogin}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            keyboardType="email-address"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            onSubmitEditing={() => ready && signIn()}
          />
          <Button title="Sign in" onPress={signIn} loading={busy} disabled={!ready} />

          <View style={{ alignItems: 'center', gap: 6, marginTop: 8 }}>
            <Text style={styles.muted}>Team members: ask your Team Leader for a UserID.</Text>
            <Link href="/signup" style={{ color: colors.primary, fontWeight: '700', fontSize: 15, padding: 6 }}>
              New Team Leader? Sign up with email
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
