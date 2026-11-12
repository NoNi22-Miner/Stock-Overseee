import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, styles, Text } from '../components/ui';
import { createTeam } from '../lib/api';
import { useAuth } from '../lib/auth';
import { colors, fs } from '../lib/theme';

/** First sign-in of a new Team Leader: name the team. */
export default function CreateTeam() {
  const { reloadProfile, signOut } = useAuth();
  const [teamName, setTeamName] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      await createTeam(teamName, name);
      await reloadProfile();
    } catch (e) {
      Alert.alert('Could not create team', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.pad, { flexGrow: 1, justifyContent: 'center', gap: 16 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: fs(26), fontWeight: '800', color: colors.text }}>Create your team</Text>
            <Text style={styles.muted}>
              You will be the Team Leader. Locations WRH and TOKO are added for you; you can add more later.
            </Text>
          </View>
          <Field
            label="Team / business name"
            value={teamName}
            onChangeText={setTeamName}
            placeholder="e.g. Toko Maju"
          />
          <Field label="Your name" value={name} onChangeText={setName} placeholder="e.g. Andi" />
          <Button title="Create team" onPress={create} loading={busy} disabled={!teamName.trim()} />
          <Button title="Sign out" variant="outline" color={colors.out} onPress={signOut} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
