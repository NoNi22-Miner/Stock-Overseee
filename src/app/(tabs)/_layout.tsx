import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import { View, useWindowDimensions, type ColorValue } from 'react-native';
import { BrandMark } from '../../components/BrandMark';
import { useRole } from '../../lib/auth';
import { useBrand } from '../../lib/brand';
import { can } from '../../lib/roles';
import { colors, layout } from '../../lib/theme';
import { useAutoSync } from '../../lib/offline';
import { UnreadProvider, useUnread } from '../../lib/unread';

type IconName = ComponentProps<typeof Ionicons>['name'];

const icon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} color={color as string} size={size} />
  );

/**
 * Menu as set in Theme & layout: a side panel on the left or right (labels beside the icons on
 * tablets, a slim icon rail on phones), or tabs along the bottom.
 */
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
  const { companyName, theme } = useBrand();
  const { width } = useWindowDimensions();
  const wide = width >= 700;
  const side = layout.nav !== 'bottom';
  const logo = theme.logo
    ? () => (
        <View style={{ marginHorizontal: 12 }}>
          <BrandMark size={26} />
        </View>
      )
    : undefined;

  return (
    <Tabs
      screenOptions={{
        tabBarPosition: layout.nav,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        headerStyle: { backgroundColor: colors.card },
        headerTitleStyle: { fontWeight: '700', color: colors.text },
        headerTintColor: colors.primary,
        headerLeft: logo,
        sceneStyle: { backgroundColor: colors.bg },
        ...(side
          ? {
              tabBarVariant: 'material' as const,
              tabBarLabelPosition: wide ? ('beside-icon' as const) : ('below-icon' as const),
              tabBarActiveBackgroundColor: colors.primarySoft,
              // The side bar defaults to a 360dp minimum; keep it compact.
              tabBarStyle: {
                backgroundColor: colors.card,
                borderRightColor: colors.border,
                borderLeftColor: colors.border,
                width: wide ? 200 : 84,
                minWidth: wide ? 200 : 84,
                paddingStart: wide ? 12 : 4,
                paddingEnd: wide ? 12 : 4,
              },
              tabBarLabelStyle: { fontWeight: '600' as const, fontSize: wide ? 14 : 11 },
            }
          : {
              // Nine tabs along the bottom: icons only on phones, with labels on tablets.
              tabBarShowLabel: wide,
              tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
              tabBarLabelStyle: { fontWeight: '600' as const, fontSize: 12 },
            }),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: companyName || 'Home', tabBarLabel: 'Home', tabBarIcon: icon('home-outline') }}
      />
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
