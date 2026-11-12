import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs, type BottomTabBarButtonProps } from 'expo-router/js-tabs';
import { PlatformPressable } from 'expo-router/react-navigation';
import type { ComponentProps } from 'react';
import { View, useWindowDimensions, type ColorValue } from 'react-native';
import { BrandMark } from '../../components/BrandMark';
import { useAuth, useRole } from '../../lib/auth';
import { useBrand } from '../../lib/brand';
import { can } from '../../lib/roles';
import { colors, fs, is, layout, sizing } from '../../lib/theme';
import { useAutoSync } from '../../lib/offline';
import { UnreadProvider, useUnread } from '../../lib/unread';
import { Text } from '../../components/ui';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Menu icon size before the person's own icon scale (More → Text & icon size). */
const ICON = 20;

const iconSize = () => is(layout.nav === 'bottom' ? ICON + 2 : ICON);

const icon =
  (name: IconName) =>
  ({ color }: { color: ColorValue }) => <Ionicons name={name} color={color as string} size={iconSize()} />;

/** A menu button with less padding than the navigator's own, so the side bar can be slimmer. */
const slimButton = (beside: boolean) =>
  function SlimTabButton({ style, ...props }: BottomTabBarButtonProps) {
    return (
      <PlatformPressable
        {...props}
        style={[
          style,
          beside
            ? { paddingVertical: 10, paddingStart: 12, paddingEnd: 10 }
            : { paddingVertical: 7, paddingHorizontal: 2 },
        ]}
      />
    );
  };
const besideButton = slimButton(true);
const belowButton = slimButton(false);

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
  const { plan } = useAuth();
  const supporter =
    plan.plan === 'supporter'
      ? () => (
          <Text
            style={{ color: colors.primary, fontWeight: '800', marginHorizontal: 16 }}
            accessibilityLabel="Supporter"
          >
            ★ Supporter
          </Text>
        )
      : undefined;
  const { width } = useWindowDimensions();
  const wide = width >= 700;
  const side = layout.nav !== 'bottom';
  // The side bar is as wide as its icons and labels need at the person's chosen sizes.
  const labelSize = fs(wide ? 13 : 10);
  const barWidth = wide
    ? is(ICON) + Math.round(labelSize * 5.8) + 68
    : Math.max(Math.round(labelSize * 5.4) + 12, is(ICON) + 34);
  const logo = theme.logo
    ? () => (
        <View style={{ marginHorizontal: 12 }}>
          <BrandMark size={is(24)} />
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
        headerTitleStyle: { fontWeight: '700', color: colors.text, fontSize: fs(18) },
        headerTintColor: colors.primary,
        headerLeft: logo,
        // A little room around the icon, so the unread badge sits on its corner instead of on top of it.
        tabBarIconStyle: { width: iconSize() + 6, height: iconSize() + 6 },
        tabBarBadgeStyle: { top: -5, end: -7, transform: [{ scale: 0.85 * sizing.icon }] },
        sceneStyle: { backgroundColor: colors.bg },
        ...(side
          ? {
              tabBarVariant: 'material' as const,
              tabBarLabelPosition: wide ? ('beside-icon' as const) : ('below-icon' as const),
              tabBarActiveBackgroundColor: colors.primarySoft,
              // The side bar defaults to a 360dp minimum; keep it compact.
              tabBarButton: wide ? besideButton : belowButton,
              tabBarStyle: {
                backgroundColor: colors.card,
                borderRightColor: colors.border,
                borderLeftColor: colors.border,
                width: barWidth,
                minWidth: barWidth,
                paddingStart: wide ? 8 : 3,
                paddingEnd: wide ? 8 : 3,
              },
              tabBarLabelStyle: {
                fontWeight: '600' as const,
                fontSize: labelSize,
                ...(wide ? { marginEnd: 0, lineHeight: Math.max(22, Math.round(labelSize * 1.5)) } : null),
              },
            }
          : {
              // Nine tabs along the bottom: icons only on phones, with labels on tablets.
              tabBarShowLabel: wide,
              tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
              tabBarLabelStyle: { fontWeight: '600' as const, fontSize: fs(12) },
            }),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: companyName || 'Home',
          tabBarLabel: 'Home',
          tabBarIcon: icon('home-outline'),
          headerRight: supporter,
        }}
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
