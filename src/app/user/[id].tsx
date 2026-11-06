import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Switch, Text, View } from 'react-native';
import { Button, Card, Chip, Field, styles } from '../../components/ui';
import { getTeamMember, manageUser } from '../../lib/api';
import { useRole } from '../../lib/auth';
import { can, ROLE_INFO, ROLE_LABEL, type Role } from '../../lib/roles';
import { colors } from '../../lib/theme';
import { timeAgo } from '../../lib/time';
import type { TeamMember } from '../../lib/types';

const ASSIGNABLE: Exclude<Role, 'owner'>[] = ['oversee', 'staff', 'onlooker'];
const USER_CODE = /^[a-z0-9._-]{3,32}$/;

export default function UserScreen() {
  const myRole = useRole();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';

  const [member, setMember] = useState<TeamMember | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [userCode, setUserCode] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [active, setActive] = useState(true);
  const [canTransfer, setCanTransfer] = useState(true);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) return;
    getTeamMember(id)
      .then((m) => {
        setMember(m);
        setName(m.display_name);
        setRole(m.role);
        setActive(m.is_active);
        setCanTransfer(m.can_transfer);
      })
      .catch((e) => Alert.alert('Error', e.message))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  if (!can.manageUsers(myRole)) {
    return (
      <View style={[styles.screen, styles.pad]}>
        <Text style={styles.title}>Only the Owner can manage accounts.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const isOwnerAccount = member?.role === 'owner';
  const code = userCode.trim().toLowerCase();

  async function run(label: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(label);
    try {
      await fn();
      if (done) Alert.alert('Done', done);
      return true;
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    const ok = await run('create', () =>
      manageUser({
        action: 'create',
        user_code: code,
        display_name: name,
        role,
        password,
        can_transfer: canTransfer,
      }),
    );
    if (ok) {
      Alert.alert('Account created', `User ID: ${code}\nPassword: ${password}\n\nGive these to the person.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    }
  }

  async function save() {
    if (!member) return;
    const ok = await run('save', () =>
      manageUser({
        action: 'update',
        user_id: member.id,
        display_name: name,
        ...(isOwnerAccount ? {} : { role, is_active: active, can_transfer: canTransfer }),
      }),
    );
    if (ok) router.back();
  }

  function remove() {
    if (!member) return;
    Alert.alert('Delete account?', `${member.display_name || member.user_code} will no longer be able to sign in.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const ok = await run('delete', () => manageUser({ action: 'delete', user_id: member.id }));
          if (ok) router.back();
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      <Stack.Screen
        options={{ title: isNew ? 'New account' : member?.display_name || member?.user_code || 'Account' }}
      />

      {isNew ? (
        <Field
          label="User ID (used to sign in)"
          value={userCode}
          onChangeText={(t) => setUserCode(t.toLowerCase().replace(/\s/g, ''))}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="e.g. budi.wrh"
          maxLength={32}
        />
      ) : (
        <Card>
          <Text style={styles.label}>{isOwnerAccount ? 'Signs in with email' : 'User ID'}</Text>
          <Text style={styles.title}>{member?.user_code ?? 'Owner'}</Text>
          <Text style={styles.muted}>
            {member?.online ? 'Online now' : `Last seen ${timeAgo(member?.last_seen_at ?? null)}`}
          </Text>
        </Card>
      )}

      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Budi (Gudang)" />

      {!isOwnerAccount && (
        <View style={{ gap: 8 }}>
          <Text style={styles.label}>Role</Text>
          <View style={styles.chipRow}>
            {ASSIGNABLE.map((r) => (
              <Chip key={r} label={ROLE_LABEL[r]} active={role === r} onPress={() => setRole(r)} />
            ))}
          </View>
          {role !== 'owner' && <Text style={styles.muted}>{ROLE_INFO[role]}</Text>}
          {role === 'staff' && (
            <View style={[styles.row, { justifyContent: 'space-between', marginTop: 4 }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 16 }}>Allow Transfer</Text>
                <Text style={styles.muted}>Move stock between locations (e.g. WRH → TOKO)</Text>
              </View>
              <Switch value={canTransfer} onValueChange={setCanTransfer} />
            </View>
          )}
        </View>
      )}

      {isNew ? (
        <>
          <Field
            label="Password (min 6 characters)"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPw}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Chip
            label={showPw ? 'Hide password' : 'Show password'}
            active={false}
            onPress={() => setShowPw((v) => !v)}
          />
          <Button
            title="Create account"
            onPress={create}
            loading={busy === 'create'}
            disabled={!USER_CODE.test(code) || password.length < 6 || !!busy}
          />
          {code.length > 0 && !USER_CODE.test(code) && (
            <Text style={{ color: colors.out }}>3-32 characters: letters, numbers, dot, dash or underscore.</Text>
          )}
        </>
      ) : (
        <>
          {!isOwnerAccount && (
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <View>
                <Text style={{ color: colors.text, fontSize: 16 }}>Active</Text>
                <Text style={styles.muted}>Off = cannot sign in or see anything</Text>
              </View>
              <Switch value={active} onValueChange={setActive} />
            </View>
          )}
          <Button title="Save changes" onPress={save} loading={busy === 'save'} disabled={!!busy} />

          <Card style={{ gap: 10, marginTop: 12 }}>
            <Text style={styles.title}>Reset password</Text>
            <Field
              label="New password (min 6 characters)"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPw}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Chip
              label={showPw ? 'Hide password' : 'Show password'}
              active={false}
              onPress={() => setShowPw((v) => !v)}
            />
            <Button
              title="Set new password"
              variant="outline"
              onPress={() =>
                member &&
                run(
                  'password',
                  () => manageUser({ action: 'set_password', user_id: member.id, password }),
                  'Password changed.',
                ).then((ok) => ok && setPassword(''))
              }
              loading={busy === 'password'}
              disabled={password.length < 6 || !!busy}
            />
          </Card>

          {!isOwnerAccount && (
            <Button
              title="Delete account"
              variant="outline"
              color={colors.out}
              onPress={remove}
              loading={busy === 'delete'}
              disabled={!!busy}
              style={{ marginTop: 12 }}
            />
          )}
        </>
      )}
    </ScrollView>
  );
}
