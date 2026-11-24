import { View } from 'react-native';
import { defaultGradeTerm, gradeList } from '../lib/grades';
import type { Term } from '../lib/types';
import { Chip, styles, Text } from './ui';

/** The team's standard grade (B until someone picks another). */
export function DefaultGradePicker({
  terms,
  configuredId,
  onPick,
  disabled = false,
}: {
  terms: Term[];
  /** teams.default_grade_id. Null means the grade named B is in force, but not saved yet. */
  configuredId: string | null;
  onPick: (gradeId: string) => void;
  disabled?: boolean;
}) {
  const grades = gradeList(terms);
  const effective = defaultGradeTerm(terms, configuredId);
  if (!grades.length) {
    return (
      <Text style={styles.muted}>Add grades A, B and C in the Recognition Table. Until then there is no standard grade.</Text>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>Standard grade</Text>
      <View style={styles.chipRow}>
        {grades.map((g) => (
          <Chip
            key={g.id}
            label={g.name}
            active={effective?.id === g.id}
            onPress={() => {
              if (!disabled) onPick(g.id);
            }}
          />
        ))}
      </View>
      <Text style={styles.muted}>
        New items and scans use {effective?.name ?? 'B'} unless a recognition entry assigns another grade, or you pick
        one. A grade other than {effective?.name ?? 'B'} can take a remark.
        {configuredId ? '' : ' Grade B is used until you save a choice.'}
      </Text>
    </View>
  );
}
