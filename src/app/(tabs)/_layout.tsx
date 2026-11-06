import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import { useWindowDimensions, type ColorValue } from 'react-native';
import { useRole } from '../../lib/auth';
import { can } from '../../lib/roles';
import { colors } from '../../lib/theme';
import { useAutoSync } from '../../lib/offline';
import { UnreadProvider, useUnread } from '../../lib/unread';

type IconName = ComponentProps<typeof Ionicons>['name'];

const icon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} color={color as string} size={size} />
  );

/** Side panel navigation: labels beside the icons on tablets, a slim icon rail on phones. */
export default function TabsLayout() {
  return (
    <UnreadProvider>
      <SideTabs />
    </UnreadProvider>
  );
}

function SideTabs() {
  useAutoSync(); // send offline scans whenever possible
  const role = useRole();
  const { count } = useUnread();
  const { width } = useWindowDimensions();
  const wide = width >= 700;

  return (
    <Tabs
      screenOptions={{
        tabBarPosition: 'left',
        tabBarVariant: 'material',
        tabBarLabelPosition: wide ? 'beside-icon' : 'below-icon',
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarActiveBackgroundColor: '#E3EEFB',
        // The side bar defaults to a 360dp minimum; keep it compact.
        tabBarStyle: {
          backgroundColor: colors.card,
          borderRightColor: colors.border,
          width: wide ? 200 : 84,
          minWidth: wide ? 200 : 84,
          paddingStart: wide ? 12 : 4,
          paddingEnd: wide ? 12 : 4,
        },
        tabBarLabelStyle: { fontWeight: '600', fontSize: wide ? 14 : 11 },
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: icon('notifications-outline'),
          tabBarBadge: count > 0 ? (count > 99 ? '99+' : count) : undefined,
        }}
      />
      <Tabs.Screen name="stock" options={{ title: 'Stock', tabBarIcon: icon('cube-outline') }} />
      <Tabs.Screen
        name="scan"
        options={{ title: 'Scan', tabBarIcon: icon('barcode-outline'), href: can.moveStock(role) ? undefined : null }}
      />
      <Tabs.Screen name="transfers" options={{ title: 'Transfers', tabBarIcon: icon('swap-horizontal-outline') }} />
      <Tabs.Screen name="products" options={{ title: 'Products', tabBarIcon: icon('pricetags-outline') }} />
      <Tabs.Screen name="history" options={{ title: 'History', tabBarIcon: icon('time-outline') }} />
      <Tabs.Screen
        name="team"
        options={{ title: 'Team', tabBarIcon: icon('people-outline'), href: can.seeTeam(role) ? undefined : null }}
      />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('settings-outline') }} />
    </Tabs>
  );
}
