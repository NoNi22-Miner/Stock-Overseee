import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, Share, TextInput, View } from 'react-native';
import { Button, Card, Chip, Field, styles, Text } from '../components/ui';
import { useAuth } from '../lib/auth';
import {
  codeLabel,
  dev,
  getContact,
  planLabel,
  STATUS_LABEL,
  statusColor,
  type DevCode,
  type DevTeam,
  type FeatureRequest,
  type PlanKey,
  type RequestStatus,
} from '../lib/plan';
import { colors, fs } from '../lib/theme';
import { timeAgo } from '../lib/time';

type Tab = 'requests' | 'codes' | 'teams' | 'contact';
const TABS: { key: Tab; label: string }[] = [
  { key: 'requests', label: 'Requests' },
  { key: 'codes', label: 'Codes' },
  { key: 'teams', label: 'Teams' },
  { key: 'contact', label: 'How to buy' },
];
const CODE_KINDS = [
  { key: 'month', label: 'Pro Monthly', plan: 'pro' as const },
  { key: 'life', label: 'Pro Lifetime', plan: 'pro' as const },
  { key: 'sup', label: 'Supporter', plan: 'supporter' as const },
];
const date = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** For the app's developer: feature requests from all companies, activation codes, plans. */
export default function DeveloperScreen() {
  const { plan } = useAuth();
  const [tab, setTab] = useState<Tab>('requests');
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [codes, setCodes] = useState<DevCode[]>([]);
  const [teams, setTeams] = useState<DevTeam[]>([]);
  const [contact, setContact] = useState('');
  const [error, setError] = useState<string | null>(null);

  // code maker
  const [kind, setKind] = useState('month');
  const [months, setMonths] = useState(1);
  const [count, setCount] = useState('1');
  const [note, setNote] = useState('');
  const [made, setMade] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([dev.requests(), dev.codes(), dev.teams(), getContact()])
      .then(([r, c, t, k]) => {
        setRequests(r);
        setCodes(c);
        setTeams(t);
        setContact(k);
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  useFocusEffect(load);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
      load();
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!plan.developer) {
    return (
      <View style={[styles.screen, styles.pad]}>
        <Text style={styles.title}>Developer only.</Text>
      </View>
    );
  }

  const open = requests.filter((r) => r.status === 'new').length;
  const k = CODE_KINDS.find((x) => x.key === kind)!;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.pad, { paddingBottom: 40 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.chipRow}>
        {TABS.map((t) => (
          <Chip
            key={t.key}
            label={t.key === 'requests' && open ? `${t.label} (${open} new)` : t.label}
            active={tab === t.key}
            onPress={() => setTab(t.key)}
          />
        ))}
      </View>
      {error && <Text style={{ color: colors.out }}>{error}</Text>}

      {tab === 'requests' &&
        (requests.length === 0 ? (
          <Text style={styles.empty}>No requests yet.</Text>
        ) : (
          requests.map((r) => (
            <RequestCard key={r.id} r={r} onSave={(s, reply) => run(`r${r.id}`, () => dev.answer(r.id, s, reply))} />
          ))
        ))}

      {tab === 'codes' && (
        <>
          <Card style={{ gap: 10 }}>
            <Text style={styles.title}>Make activation codes</Text>
            <View style={styles.chipRow}>
              {CODE_KINDS.map((x) => (
                <Chip key={x.key} label={x.label} active={kind === x.key} onPress={() => setKind(x.key)} />
              ))}
            </View>
            {kind === 'month' && (
              <View style={styles.chipRow}>
                {[1, 3, 6, 12].map((m) => (
                  <Chip
                    key={m}
                    label={`${m} month${m > 1 ? 's' : ''}`}
                    active={months === m}
                    onPress={() => setMonths(m)}
                  />
                ))}
              </View>
            )}
            <View style={styles.row}>
              <View style={{ width: 100 }}>
                <Field label="How many" value={count} onChangeText={setCount} keyboardType="number-pad" maxLength={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Note (who it is for)" value={note} onChangeText={setNote} maxLength={80} />
              </View>
            </View>
            <Button
              title="Make codes"
              loading={busy === 'make'}
              disabled={!(Number(count) >= 1 && Number(count) <= 50)}
              onPress={() =>
                run('make', async () =>
                  setMade(await dev.makeCodes(k.plan, kind === 'month' ? months : null, Number(count), note)),
                )
              }
            />
          </Card>
          {made.length > 0 && (
            <Card style={{ gap: 8, borderColor: colors.primary }}>
              <Text style={styles.title}>New codes: copy them now (they are shown only once)</Text>
              {made.map((c) => (
                <Text
                  key={c}
                  selectable
                  style={{ color: colors.text, fontSize: fs(20), fontWeight: '800', letterSpacing: 2 }}
                >
                  {c}
                </Text>
              ))}
              <Button
                title="Share codes"
                variant="outline"
                onPress={() =>
                  Share.share({
                    message: `Stock Overseee activation code${made.length > 1 ? 's' : ''} (${codeLabel({
                      plan: k.plan,
                      months: kind === 'month' ? months : null,
                    })}):\n${made.join('\n')}\n\nMore → Plans & activation code → Use code`,
                  })
                }
              />
            </Card>
          )}
          <Text style={styles.title}>Codes made</Text>
          {codes.map((c, i) => (
            <Card key={`${c.hint}${i}`} style={{ gap: 2 }}>
              <View style={[styles.row, { justifyContent: 'space-between' }]}>
                <Text style={styles.title}>…{c.hint}</Text>
                <Text style={{ color: c.redeemed_at ? colors.in : colors.muted, fontWeight: '700' }}>
                  {c.redeemed_at ? `Used by ${c.team_name ?? '?'}` : 'Not used'}
                </Text>
              </View>
              <Text style={styles.muted}>
                {codeLabel(c)} · made {date(c.created_at)}
                {c.note ? ` · ${c.note}` : ''}
                {c.redeemed_at ? ` · used ${date(c.redeemed_at)}` : ''}
              </Text>
            </Card>
          ))}
        </>
      )}

      {tab === 'teams' &&
        teams.map((t) => (
          <Card key={t.id} style={{ gap: 6 }}>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={[styles.title, { flex: 1 }]}>{t.name}</Text>
              <Text style={{ color: t.plan === 'free' ? colors.muted : colors.primary, fontWeight: '800' }}>
                {planLabel({ plan: t.plan, plan_until: t.plan_until })}
              </Text>
            </View>
            <Text style={styles.muted}>
              {t.members} account(s) · {t.locations} location(s) · since {date(t.created_at)}
              {t.plan_until ? ` · until ${date(t.plan_until)}` : ''}
              {t.plan_source ? ` · by ${t.plan_source}` : ''}
            </Text>
            <View style={styles.chipRow}>
              {(
                [
                  ['Free', 'free', null],
                  ['+1 month', 'pro', 'month'],
                  ['Pro Lifetime', 'pro', null],
                  ['Supporter', 'supporter', null],
                ] as [string, PlanKey, string | null][]
              ).map(([label, p, add]) => (
                <Chip
                  key={label}
                  label={label}
                  active={false}
                  color={colors.muted}
                  onPress={() => {
                    const base = t.plan === 'pro' && t.plan_until ? new Date(t.plan_until) : new Date();
                    const until = add ? new Date(base.setMonth(base.getMonth() + 1)).toISOString() : null;
                    Alert.alert(`Set ${t.name} to ${label}?`, undefined, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Set', onPress: () => run(`t${t.id}`, () => dev.setPlan(t.id, p, until)) },
                    ]);
                  }}
                />
              ))}
            </View>
          </Card>
        ))}

      {tab === 'contact' && (
        <Card style={{ gap: 10 }}>
          <Text style={{ color: colors.text }}>
            Shown on every team&apos;s Plans screen as &quot;To buy a code: …&quot;, e.g. your WhatsApp number.
          </Text>
          <TextInput
            style={styles.input}
            value={contact}
            onChangeText={setContact}
            placeholder="e.g. WhatsApp 08xx-xxxx-xxxx"
            placeholderTextColor={colors.muted}
            maxLength={200}
          />
          <Button
            title="Save"
            loading={busy === 'contact'}
            onPress={() => run('contact', () => dev.setContact(contact))}
          />
        </Card>
      )}
    </ScrollView>
  );
}

function RequestCard({ r, onSave }: { r: FeatureRequest; onSave: (s: RequestStatus, reply: string) => void }) {
  const [status, setStatus] = useState<RequestStatus>(r.status);
  const [reply, setReply] = useState(r.reply ?? '');
  const changed = status !== r.status || reply !== (r.reply ?? '');
  return (
    <Card style={{ gap: 6, borderLeftWidth: 5, borderLeftColor: statusColor(r.status) }}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text style={styles.muted}>
          {r.team_name}
          {r.team_plan === 'supporter' ? ' ★ Supporter' : ''} · {timeAgo(r.created_at)}
        </Text>
        <Text style={{ color: statusColor(r.status), fontWeight: '800' }}>{STATUS_LABEL[r.status]}</Text>
      </View>
      <Text style={styles.title}>{r.title}</Text>
      {!!r.body && <Text style={{ color: colors.text }}>{r.body}</Text>}
      <View style={styles.chipRow}>
        {(Object.keys(STATUS_LABEL) as RequestStatus[]).map((s) => (
          <Chip
            key={s}
            label={STATUS_LABEL[s]}
            active={status === s}
            color={statusColor(s)}
            onPress={() => setStatus(s)}
          />
        ))}
      </View>
      <TextInput
        style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
        value={reply}
        onChangeText={setReply}
        placeholder="Reply to the team (optional)"
        placeholderTextColor={colors.muted}
        multiline
        maxLength={2000}
      />
      {changed && <Button title="Save answer" onPress={() => onSave(status, reply)} />}
    </Card>
  );
}
