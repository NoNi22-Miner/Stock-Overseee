import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Chip, Field, styles } from '../components/ui';
import { userIdToEmail } from '../lib/roles';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

type Mode = 'user' | 'owner';

export default function Login() {
  const [mode, setMode] = useState<Mode>('user');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    const email = mode === 'owner' ? login.trim() : userIdToEmail(login);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      const wrong = /invalid login credentials/i.test(error.message);
      Alert.alert(
        'Sign in failed',
        wrong ? (mode === 'owner' ? 'Wrong email or password.' : 'Wrong User ID or password.') : error.message,
      );
    }
  }

  const ready = (mode === 'owner' ? login.includes('@') : login.trim().length >= 3) && password.length >= 6;

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.pad, { flexGrow: 1, justifyContent: 'center', gap: 16 }]}>
          <View style={{ gap: 4, marginBottom: 12 }}>
            <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text }}>Stock Overseee</Text>
            <Text style={styles.muted}>Warehouse & store stock, by scan.</Text>
          </View>

          <View style={styles.chipRow}>
            <Chip label="User ID" active={mode === 'user'} onPress={() => setMode('user')} />
            <Chip label="Owner (email)" active={mode === 'owner'} onPress={() => setMode('owner')} />
          </View>

          {mode === 'user' ? (
            <Field
              label="User ID"
              value={login}
              onChangeText={setLogin}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="e.g. budi.wrh"
            />
          ) : (
            <Field
              label="Owner email"
              value={login}
              onChangeText={setLogin}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@example.com"
            />
          )}
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            onSubmitEditing={() => ready && signIn()}
          />
          <Button title="Sign in" onPress={signIn} loading={busy} disabled={!ready} />
          <Text style={[styles.muted, { textAlign: 'center' }]}>
            {mode === 'user'
              ? 'No User ID yet? Ask the Owner to create one for you.'
              : 'Only the Owner signs in with email.'}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
