import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { useAuth, useRole } from '../lib/auth';
import { isPro, planLabel } from '../lib/plan';
import { can } from '../lib/roles';
import { colors } from '../lib/theme';
import { Button, Card, styles } from './ui';

const date = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** The team's plan, what it allows, and the way to upgrade (More screen). */
export function PlanCard() {
  const { plan } = useAuth();
  const role = useRole();
  const ended = plan.plan === 'free' && plan.saved_plan !== 'free';
  const lockedCount = plan.locked_locations.length + plan.locked_members.length;
  return (
    <Card style={{ gap: 8, borderColor: isPro(plan) ? colors.primary : colors.border }}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text style={styles.title}>
          {planLabel(plan)} plan{plan.plan === 'supporter' ? '  ★' : ''}
        </Text>
        {plan.plan === 'pro' && plan.plan_until && <Text style={styles.muted}>until {date(plan.plan_until)}</Text>}
      </View>
      <Text style={{ color: colors.text }}>
        {isPro(plan) ? 'Many locations' : '1 location'} · {plan.max_per_role} account
        {plan.max_per_role === 1 ? '' : 's'} per role (plus the Team Leader)
      </Text>
      {ended && plan.plan_until && (
        <Text style={{ color: colors.warn, fontWeight: '600' }}>
          Pro ended on {date(plan.plan_until)}.{' '}
          {lockedCount ? `${lockedCount} location(s) / account(s) are locked. ` : ''}
          Nothing was deleted: renew Pro to unlock them.
        </Text>
      )}
      {plan.locked && (
        <Text style={{ color: colors.warn, fontWeight: '600' }}>
          Your account is locked by the plan: you can look but not change anything until Pro is renewed.
        </Text>
      )}
      <Button
        title={isPro(plan) ? 'Plans & activation code' : 'Upgrade to Pro'}
        variant={isPro(plan) ? 'outline' : 'solid'}
        onPress={() => router.push('/plans')}
      />
      {plan.plan === 'supporter' && (role === 'owner' || role === 'oversee') && (
        <Button title="Request a feature" variant="outline" onPress={() => router.push('/requests')} />
      )}
      {plan.developer && can.manageUsers(role) && (
        <Button
          title="Developer tools"
          variant="outline"
          color={colors.muted}
          onPress={() => router.push('/developer')}
        />
      )}
    </Card>
  );
}
