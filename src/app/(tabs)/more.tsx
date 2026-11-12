import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, Switch, View } from 'react-native';
import { PlanCard } from '../../components/PlanCard';
import { Button, Card, Chip, Field, styles, Text } from '../../components/ui';
import {
  addLocation,
  getMyTeam,
  listLocations,
  manageUser,
  renameTeam,
  setLocationActive,
  setNotifyChanges,
} from '../../lib/api';
import { useAuth, useRole } from '../../lib/auth';
import { useQueue } from '../../lib/offline';
import { can, ROLE_LABEL } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import { colors, fs } from '../../lib/theme';
import type { Location, LocationKind, Team } from '../../lib/types';

const KINDS: { kind: LocationKind; label: string }[] = [
  { kind: 'warehouse', label: 'Warehouse' },
  { kind: 'store', label: 'Store' },
  { kind: 'other', label: 'Other' },
];

export default function MoreScreen() {
  const { profile, signOut, reloadProfile, plan } = useAuth();
  const queue = useQueue();
  const [notifyChanges, setNotifyChangesState] = useState(profile?.notify_changes ?? true);
  const role = useRole();
  const manage = can.manageLocations(role);
  const isLeader = can.manageUsers(role);

  const [team, setTeam] = useState<Team | null>(null);
  const [teamName, setTeamName] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LocationKind>('store');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [showDelete, setShowDelete] = useState(false);

  const load = useCallback(() => {
    listLocations(true)
      .then(setLocations)
      .catch((e) => Alert.alert('Error', e.message));
    getMyTeam()
      .then((t) => {
        setTeam(t);
        setTeamName(t?.name ?? '');
      })
      .catch(() => {});
  }, []);

  useFocusEffect(load);

  async function add() {
    setBusy('add');
    try {
      await addLocation({ code, name, kind });
      setCode('');
      setName('');
      load();
      reloadProfile();
    } catch (e) {
      const msg = (e as Error).message;
      Alert.alert('Could not add location', /duplicate|unique/i.test(msg) ? 'That code is already used.' : msg);
    } finally {
      setBusy(null);
    }
  }

  async function toggle(l: Location) {
    try {
      await setLocationActive(l.id, !l.is_active);
      load();
      reloadProfile();
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    }
  }

  async function saveTeamName() {
    if (!team) return;
    setBusy('team');
    try {
      await renameTeam(team.id, teamName);
      load();
    } catch (e) {
      Alert.alert('Could not rename team', (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function deleteTeam() {
    setBusy('delete');
    try {
      await manageUser({ action: 'delete_team', confirm_name: confirmName.trim() });
      // The account no longer exists; clear the local session.
      await supabase.auth.signOut({ scope: 'local' });
    } catch (e) {
      Alert.alert('Could not delete', (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const validCode = /^[A-Z0-9_-]{1,12}$/.test(code.trim().toUpperCase());

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Plan</Text>
      <PlanCard />

      <Text style={[styles.title, { marginTop: 12 }]}>Team</Text>
      <Card style={{ gap: 10 }}>
        {isLeader ? (
          <>
            <Field label="Team name" value={teamName} onChangeText={setTeamName} maxLength={60} />
            {teamName.trim() !== (team?.name ?? '') && (
              <Button
                title="Save team name"
                onPress={saveTeamName}
                loading={busy === 'team'}
                disabled={!teamName.trim() || !!busy}
              />
            )}
          </>
        ) : (
          <Text style={styles.title}>{team?.name ?? '…'}</Text>
        )}
        {isLeader && (
          <Button
            title="Theme & layout (logo, colors, menu)"
            variant="outline"
            onPress={() => router.push('/branding')}
          />
        )}
      </Card>

      <Text style={[styles.title, { marginTop: 12 }]}>Locations</Text>
      {locations.map((l) => (
        <Card key={l.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>
              {l.code} <Text style={styles.muted}>· {l.kind}</Text>
            </Text>
            <Text style={styles.muted}>{l.name}</Text>
            {plan.locked_locations.includes(l.id) && (
              <Text style={{ color: colors.warn, fontWeight: '700', fontSize: fs(12) }}>
                🔒 LOCKED: view only until Pro is renewed
              </Text>
            )}
          </View>
          <Switch value={l.is_active} onValueChange={() => toggle(l)} disabled={!manage} />
        </Card>
      ))}

      {manage && plan.locations >= plan.max_locations && (
        <Card style={{ gap: 8 }}>
          <Text style={{ color: colors.text }}>
            The Free plan has 1 location. Pro gives you as many as you need (WRH, TOKO, …).
          </Text>
          <Button title="See plans" onPress={() => router.push('/plans')} />
        </Card>
      )}
      {manage && plan.locations < plan.max_locations && (
        <Card style={{ gap: 10 }}>
          <Text style={styles.title}>Add location</Text>
          <Field
            label="Code (short, e.g. TOKO2)"
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            autoCapitalize="characters"
            maxLength={12}
          />
          <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Toko Cabang 2" />
          <View style={styles.chipRow}>
            {KINDS.map((k) => (
              <Chip key={k.kind} label={k.label} active={kind === k.kind} onPress={() => setKind(k.kind)} />
            ))}
          </View>
          <Button
            title="Add location"
            onPress={add}
            loading={busy === 'add'}
            disabled={!validCode || !name.trim() || !!busy}
          />
        </Card>
      )}

      <Text style={[styles.title, { marginTop: 12 }]}>Account</Text>
      <Card>
        <Text style={styles.title}>{profile?.display_name || profile?.user_code || 'Team Leader'}</Text>
        <Text style={styles.muted}>
          {profile?.user_code
            ? `UserID: ${profile.user_code}${profile.username ? `  ·  Username: ${profile.username}` : ''}`
            : 'Signs in with email'}
          {role ? `  ·  ${ROLE_LABEL[role]}` : ''}
        </Text>
        <Button title="Text & icon size" variant="outline" onPress={() => router.push('/display')} />
        <Button
          title="Sign out"
          variant="outline"
          color={colors.out}
          onPress={() => {
            const waiting = queue.filter((q) => q.status === 'pending').length;
            if (!waiting) return signOut();
            Alert.alert(
              `${waiting} scan${waiting > 1 ? 's' : ''} not synced yet`,
              'They stay on this phone and are sent the next time you sign in here.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign out', style: 'destructive', onPress: signOut },
              ],
            );
          }}
        />
      </Card>

      <Text style={[styles.title, { marginTop: 12 }]}>Notifications</Text>
      <Card style={{ gap: 6 }}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: fs(16) }}>Every stock change</Text>
            <Text style={styles.muted}>
              In / Out / count at my locations. Transfers and low stock are always notified.
            </Text>
          </View>
          <Switch
            value={notifyChanges}
            onValueChange={(on) => {
              setNotifyChangesState(on);
              setNotifyChanges(on).then(reloadProfile, (e) => {
                setNotifyChangesState(!on);
                Alert.alert('Could not save', e.message);
              });
            }}
          />
        </View>
      </Card>

      {isLeader && (
        <Card style={{ gap: 10, marginTop: 12, borderColor: colors.out }}>
          <Text style={[styles.title, { color: colors.out }]}>Delete team & account</Text>
          {!showDelete ? (
            <Button title="Delete team…" variant="outline" color={colors.out} onPress={() => setShowDelete(true)} />
          ) : (
            <>
              <Text style={{ color: colors.text }}>
                This permanently deletes your account, every member account, and all products, stock and history of this
                team. It cannot be undone.
              </Text>
              <Field
                label={`Type the team name (${team?.name ?? ''}) to confirm`}
                value={confirmName}
                onChangeText={setConfirmName}
                autoCapitalize="none"
              />
              <Button
                title="Delete everything"
                color={colors.out}
                onPress={deleteTeam}
                loading={busy === 'delete'}
                disabled={confirmName.trim() !== team?.name || !!busy}
              />
              <Button title="Cancel" variant="outline" color={colors.muted} onPress={() => setShowDelete(false)} />
            </>
          )}
        </Card>
      )}
    </ScrollView>
  );
}
