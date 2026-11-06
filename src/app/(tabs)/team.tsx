import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Button, Empty, styles } from '../../components/ui';
import { listTeam } from '../../lib/api';
import { useRole } from '../../lib/auth';
import { can, ROLE_LABEL } from '../../lib/roles';
import { colors } from '../../lib/theme';
import { timeAgo } from '../../lib/time';
import type { TeamMember } from '../../lib/types';

const REFRESH_MS = 30_000;

export default function TeamScreen() {
  const role = useRole();
  const isOwner = can.manageUsers(role);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setTeam(await listTeam());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh now and every 30 s while this tab is open.
  useFocusEffect(
    useCallback(() => {
      load();
      const t = setInterval(() => load(true), REFRESH_MS);
      return () => clearInterval(t);
    }, [load]),
  );

  const onlineCount = team.filter((m) => m.online).length;

  return (
    <View style={styles.screen}>
      <View style={[styles.pad, { paddingBottom: 4 }]}>
        <View style={styles.row}>
          <View style={[dot, { backgroundColor: colors.online }]} />
          <Text style={styles.title}>
            {onlineCount} online now <Text style={styles.muted}>of {team.length}</Text>
          </Text>
        </View>
        {isOwner && (
          <Button
            title="+ Add account"
            onPress={() => router.push({ pathname: '/user/[id]', params: { id: 'new' } })}
          />
        )}
        {error && <Text style={{ color: colors.out }}>{error}</Text>}
      </View>
      <FlatList
        data={team}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 8 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} />}
        ListEmptyComponent={loading ? undefined : <Empty text="No accounts yet." />}
        renderItem={({ item }) => (
          <Pressable
            disabled={!isOwner}
            onPress={() => router.push(`/user/${item.id}`)}
            style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }, !item.is_active && { opacity: 0.5 }]}
          >
            <View style={[dot, { backgroundColor: item.online ? colors.online : colors.border }]} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.title}>{item.display_name || item.user_code || 'Owner'}</Text>
              <Text style={styles.muted}>
                {item.user_code ? `@${item.user_code}` : 'email login'} · {ROLE_LABEL[item.role]}
                {item.is_active ? '' : ' · disabled'}
              </Text>
            </View>
            <Text style={{ color: item.online ? colors.online : colors.muted, fontWeight: '600' }}>
              {item.online ? 'Online' : timeAgo(item.last_seen_at)}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const dot = { width: 12, height: 12, borderRadius: 6 };
