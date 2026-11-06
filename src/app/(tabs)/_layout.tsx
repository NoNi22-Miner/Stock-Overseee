import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { useRole } from '../../lib/auth';
import { can } from '../../lib/roles';
import { colors } from '../../lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const icon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

export default function TabsLayout() {
  const role = useRole();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Stock', tabBarIcon: icon('cube-outline') }} />
      <Tabs.Screen
        name="scan"
        options={{ title: 'Scan', tabBarIcon: icon('barcode-outline'), href: can.moveStock(role) ? undefined : null }}
      />
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
