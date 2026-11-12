import { useEffect, useState } from 'react';
import { Alert, ScrollView, TextInput, View } from 'react-native';
import { Button, Card, styles, Text } from '../components/ui';
import { useAuth, useRole } from '../lib/auth';
import { getContact, planLabel, PRICES, redeemCode } from '../lib/plan';
import { can } from '../lib/roles';
import { colors, fs } from '../lib/theme';

const PLANS = [
  {
    key: 'free',
    name: 'Free',
    price: '$0',
    per: '',
    points: ['1 location', '1 account per role (Oversee, Staff, Onlooker)', 'Scanning, transfers, notifications'],
  },
  {
    key: 'monthly',
    name: PRICES.monthly.label,
    price: PRICES.monthly.price,
    per: PRICES.monthly.per,
    points: ['Many locations (WRH, TOKO, …)', 'Up to 20 accounts per role', 'Renew each month'],
  },
  {
    key: 'lifetime',
    name: PRICES.lifetime.label,
    price: PRICES.lifetime.price,
    per: PRICES.lifetime.per,
    points: ['Everything in Pro', 'Pay once, use for life'],
  },
  {
    key: 'supporter',
    name: PRICES.supporter.label,
    price: PRICES.supporter.price,
    per: PRICES.supporter.per,
    points: [
      'Everything in Pro Lifetime',
      'Request new features and utilities — answered first',
      'Supporter badge for your company',
    ],
  },
] as const;

/** Prices, what each plan gives, and the activation code (Team Leader). */
export default function PlansScreen() {
  const { plan, reloadProfile } = useAuth();
  const isLeader = can.manageUsers(useRole());
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getContact()
      .then(setContact)
      .catch(() => {});
  }, []);

  const current =
    plan.plan === 'supporter' ? 'supporter' : plan.plan === 'pro' ? (plan.plan_until ? 'monthly' : 'lifetime') : 'free';

  async function redeem() {
    setBusy(true);
    try {
      const info = await redeemCode(code);
      await reloadProfile();
      setCode('');
      Alert.alert('Activated', `Your team now has ${planLabel(info)}.`);
    } catch (e) {
      Alert.alert('Code not used', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.pad, { paddingBottom: 40 }]}>
      <Text style={styles.muted}>Plans are for the whole company. The Team Leader activates them.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {PLANS.map((p) => {
          const here = p.key === current;
          return (
            <Card
              key={p.key}
              style={{
                flexGrow: 1,
                flexBasis: 240,
                gap: 6,
                borderColor: here ? colors.primary : colors.border,
                borderWidth: here ? 2 : 1,
              }}
            >
              <View style={[styles.row, { justifyContent: 'space-between' }]}>
                <Text style={styles.title}>{p.name}</Text>
                {here && <Text style={{ color: colors.primary, fontWeight: '800' }}>Your plan</Text>}
              </View>
              <Text style={{ color: colors.text, fontSize: fs(26), fontWeight: '800' }}>
                {p.price} <Text style={styles.muted}>{p.per}</Text>
              </Text>
              {p.points.map((t) => (
                <Text key={t} style={{ color: colors.text }}>
                  ✓ {t}
                </Text>
              ))}
            </Card>
          );
        })}
      </View>

      <Text style={[styles.title, { marginTop: 8 }]}>Activation code</Text>
      <Card style={{ gap: 10 }}>
        <Text style={{ color: colors.text }}>
          {contact ? `To buy a code: ${contact}` : 'Ask the app developer for an activation code.'}
        </Text>
        <Text style={styles.muted}>Paying inside the app with Google Play comes with the Play Store version.</Text>
        {isLeader ? (
          <>
            <TextInput
              style={[styles.input, { letterSpacing: 2, fontWeight: '700' }]}
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              placeholder="XXXX-XXXX-XXXX"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={20}
            />
            <Button
              title="Use code"
              onPress={redeem}
              loading={busy}
              disabled={code.replace(/[^A-Z0-9]/g, '').length < 12}
            />
          </>
        ) : (
          <Text style={styles.muted}>Only the Team Leader can use a code.</Text>
        )}
      </Card>
    </ScrollView>
  );
}
