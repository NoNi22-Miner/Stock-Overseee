import { View } from 'react-native';
import { useAuth } from '../lib/auth';
import type { Location } from '../lib/types';
import { Chip, styles, Text } from './ui';

export function LocationPicker({
  label,
  locations,
  value,
  onChange,
  exclude,
  badges,
}: {
  label?: string;
  locations: Location[];
  value: string | null;
  onChange: (id: string) => void;
  exclude?: string | null;
  badges?: Record<string, number>;
}) {
  const { plan } = useAuth();
  return (
    <View style={{ gap: 6 }}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.chipRow}>
        {locations
          .filter((l) => l.id !== exclude)
          .map((l) => (
            <Chip
              key={l.id}
              label={plan.locked_locations.includes(l.id) ? `${l.code} 🔒` : l.code}
              active={value === l.id}
              onPress={() => onChange(l.id)}
              badge={badges?.[l.id]}
            />
          ))}
      </View>
    </View>
  );
}
