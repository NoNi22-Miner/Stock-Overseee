import { useState } from 'react';
import { View } from 'react-native';
import { colors } from '../lib/theme';
import { Chip, styles, Text } from './ui';

export type ChipOption = { id: string; name: string; hint?: string };

/**
 * Pick one (or several, in order) from a list of chips. The `common` options (e.g. used with this
 * category) are shown first; "More…" shows the rest.
 */
export function PartChips({
  label,
  options,
  common,
  value,
  onChange,
  multi = false,
  max = 3,
  disabled = false,
  noneLabel = 'None',
}: {
  label: string;
  options: ChipOption[];
  common?: Set<string>;
  value: string[];
  onChange: (ids: string[]) => void;
  multi?: boolean;
  max?: number;
  disabled?: boolean;
  noneLabel?: string;
}) {
  const [all, setAll] = useState(false);
  // Options used with this category first; otherwise the first few. "More…" shows the rest.
  const commonList = common && common.size ? options.filter((o) => common.has(o.id)) : options.slice(0, 8);
  const shortList = commonList.length >= options.length ? options : commonList;
  const shown = all
    ? options
    : [...shortList, ...options.filter((o) => value.includes(o.id) && !shortList.includes(o))];
  const hidden = options.length - shown.length;

  function tap(id: string) {
    if (disabled) return;
    if (!multi) return onChange(value[0] === id ? [] : [id]);
    if (value.includes(id)) return onChange(value.filter((x) => x !== id));
    if (value.length >= max) return;
    onChange([...value, id]);
  }

  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>
        {label}
        {multi && value.length > 1
          ? `  (order: ${value.map((id) => options.find((o) => o.id === id)?.name).join(' · ')})`
          : ''}
      </Text>
      <View style={styles.chipRow}>
        {!multi && (
          <Chip
            label={noneLabel}
            active={value.length === 0}
            color={colors.muted}
            onPress={() => !disabled && onChange([])}
          />
        )}
        {shown.map((o) => (
          <Chip key={o.id} label={o.name} active={value.includes(o.id)} onPress={() => tap(o.id)} />
        ))}
        {hidden > 0 && (
          <Chip label={`More… (${hidden})`} active={false} color={colors.muted} onPress={() => setAll(true)} />
        )}
        {all && shortList.length < options.length && (
          <Chip label="Fewer" active={false} color={colors.muted} onPress={() => setAll(false)} />
        )}
      </View>
    </View>
  );
}
