import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Button, Card, styles, Text } from '../components/ui';
import { useBrand } from '../lib/brand';
import { colors, DEFAULT_DISPLAY, fs, SIZE_STEPS, stepScale, type DisplayPrefs, type SizeStep } from '../lib/theme';

/**
 * Text size for this account on this phone: Tiny, Smaller, Normal, Bigger, Enormous.
 * Icons stay small so item names keep the room to wrap. The team's look is set in Theme & layout.
 */
export default function DisplayScreen() {
  const { display, setDisplay } = useBrand();
  const [draft, setDraft] = useState<DisplayPrefs>(display);
  const text = stepScale(draft.text);
  const changed = draft.text !== display.text;
  const isDefault = draft.text === DEFAULT_DISPLAY.text;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.pad, { paddingBottom: 40 }]}>
      {/* Preview at the sizes picked below (before they are used) */}
      <Card style={{ gap: 10, borderColor: colors.primary }}>
        <Text style={[styles.label, { fontSize: 13 * text }]}>Preview</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <Ionicons name="refresh" size={16} color={colors.primary} />
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 17 * text, flex: 1 }}>
            {"PLAT BESI · SS400 · 12mm × 4' × 8' · GRP (Grade A)"}
          </Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 13 * text }}>IT346 · Lembar · WRH: 24</Text>
        <View
          style={{
            backgroundColor: colors.primary,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 44,
            paddingHorizontal: 16,
          }}
        >
          <Text style={{ color: colors.primaryText, fontWeight: '600', fontSize: 16 * text }}>In 5 Lembar → WRH</Text>
        </View>
      </Card>

      <SizePicker
        title="Text size"
        value={draft.text}
        onChange={(v) => setDraft({ text: v })}
        sample={(scale, color) => (
          <Text style={{ color, fontSize: Math.round(16 * scale), fontWeight: '700' }}>Aa</Text>
        )}
      />

      <Button title="Use these sizes" onPress={() => setDisplay(draft, '/display')} disabled={!changed} />
      {!isDefault && (
        <Button
          title="Back to Normal"
          variant="outline"
          color={colors.muted}
          onPress={() => setDraft(DEFAULT_DISPLAY)}
        />
      )}
      <Text style={styles.muted}>
        Saved on this phone for your account only. Other people keep their own sizes, also on a shared phone.
      </Text>
    </ScrollView>
  );
}

function SizePicker({
  title,
  value,
  onChange,
  sample,
}: {
  title: string;
  value: SizeStep;
  onChange: (v: SizeStep) => void;
  sample: (scale: number, color: string) => ReactNode;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.title}>{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {SIZE_STEPS.map((s) => {
          const active = value === s.key;
          const color = active ? colors.primaryText : colors.primary;
          return (
            <Pressable
              key={s.key}
              onPress={() => onChange(s.key)}
              accessibilityRole="button"
              accessibilityLabel={`${title}: ${s.label}`}
              accessibilityState={{ selected: active }}
              style={{
                width: '30%',
                flexGrow: 1,
                alignItems: 'center',
                gap: 4,
                paddingVertical: 10,
                paddingHorizontal: 2,
                borderRadius: 12,
                borderWidth: 1.5,
                borderColor: colors.primary,
                backgroundColor: active ? colors.primary : colors.card,
              }}
            >
              <View style={{ height: 34, justifyContent: 'center' }}>{sample(s.scale, color)}</View>
              <Text style={{ color, fontSize: fs(12), fontWeight: '600', textAlign: 'center' }}>{s.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
