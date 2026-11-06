import { Text, View } from 'react-native';
import type { Location } from '../lib/types';
import { Chip, styles } from './ui';

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
  return (
    <View style={{ gap: 6 }}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.chipRow}>
        {locations
          .filter((l) => l.id !== exclude)
          .map((l) => (
            <Chip
              key={l.id}
              label={l.code}
              active={value === l.id}
              onPress={() => onChange(l.id)}
              badge={badges?.[l.id]}
            />
          ))}
      </View>
    </View>
  );
}
