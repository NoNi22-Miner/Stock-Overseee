import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, View } from 'react-native';
import { Button, Card, Field, styles, Text } from '../components/ui';
import { useAuth, useRole } from '../lib/auth';
import { listMyRequests, sendRequest, STATUS_LABEL, statusColor, type FeatureRequest } from '../lib/plan';
import { colors } from '../lib/theme';
import { timeAgo } from '../lib/time';

/** Supporter: send ideas for new features or utilities to the developer, and see the answers. */
export default function RequestsScreen() {
  const { plan } = useAuth();
  const role = useRole();
  const allowed = plan.plan === 'supporter' && (role === 'owner' || role === 'oversee');
  const [rows, setRows] = useState<FeatureRequest[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listMyRequests()
      .then(setRows)
      .catch(() => {});
  }, []);
  useFocusEffect(load);

  async function send() {
    setBusy(true);
    try {
      await sendRequest(title, body);
      setTitle('');
      setBody('');
      load();
      Alert.alert('Sent', 'Thank you! Supporter requests are answered first.');
    } catch (e) {
      Alert.alert('Could not send', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={[styles.pad, { paddingBottom: 40 }]}
      data={rows}
      keyExtractor={(r) => String(r.id)}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          {allowed ? (
            <Card style={{ gap: 10 }}>
              <Text style={styles.title}>Request a feature or utility</Text>
              <Field
                label="What do you need?"
                value={title}
                onChangeText={setTitle}
                maxLength={120}
                placeholder="e.g. Export stock to Excel"
              />
              <Field
                label="Details (optional)"
                value={body}
                onChangeText={setBody}
                maxLength={2000}
                multiline
                style={{ minHeight: 90, textAlignVertical: 'top' }}
                placeholder="How would you use it?"
              />
              <Button title="Send to the developer" onPress={send} loading={busy} disabled={title.trim().length < 3} />
            </Card>
          ) : (
            <Card style={{ gap: 8 }}>
              <Text style={styles.title}>Feature requests are part of the Supporter plan</Text>
              <Button title="See plans" onPress={() => router.push('/plans')} />
            </Card>
          )}
          {rows.length > 0 && <Text style={styles.title}>Your requests</Text>}
        </View>
      }
      renderItem={({ item }) => (
        <Card style={{ gap: 4, borderLeftWidth: 5, borderLeftColor: statusColor(item.status) }}>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={[styles.title, { flex: 1 }]}>{item.title}</Text>
            <Text style={{ color: statusColor(item.status), fontWeight: '800' }}>{STATUS_LABEL[item.status]}</Text>
          </View>
          {!!item.body && <Text style={{ color: colors.text }}>{item.body}</Text>}
          {item.reply && (
            <Text style={{ color: colors.text, backgroundColor: colors.primarySoft, padding: 8, borderRadius: 8 }}>
              Developer: {item.reply}
            </Text>
          )}
          <Text style={styles.muted}>{timeAgo(item.created_at)}</Text>
        </Card>
      )}
    />
  );
}
