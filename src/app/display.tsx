import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Button, Card, styles, Text } from '../components/ui';
import { useBrand } from '../lib/brand';
import { colors, DEFAULT_DISPLAY, fs, SIZE_STEPS, stepScale, type DisplayPrefs, type SizeStep } from '../lib/theme';

const SAMPLE_ICONS = ['home-outline', 'cube-outline', 'barcode-outline', 'pricetags-outline'] as const;

/**
 * Each person's own text and icon size, kept on this phone for their account (so a shared phone
 * can be comfortable for both young and older eyes). The team's look is set in Theme & layout.
 */
export default function DisplayScreen() {
  const { display, setDisplay } = useBrand();
  const [draft, setDraft] = useState<DisplayPrefs>(display);
  const text = stepScale(draft.text);
  const icon = stepScale(draft.icons);
  const changed = draft.text !== display.text || draft.icons !== display.icons;
  const isDefault = draft.text === DEFAULT_DISPLAY.text && draft.icons === DEFAULT_DISPLAY.icons;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.pad, { paddingBottom: 40 }]}>
      {/* Preview at the sizes picked below (before they are used) */}
      <Card style={{ gap: 10, borderColor: colors.primary }}>
        <Text style={[styles.label, { fontSize: 13 * text }]}>Preview</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          {SAMPLE_ICONS.map((name, i) => (
            <Ionicons
              key={name}
              name={name}
              size={Math.round(20 * icon)}
              color={i === 0 ? colors.primary : colors.muted}
            />
          ))}
        </View>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 17 * text }}>
          {"PLAT BESI · SS400 · 10mm × 4' × 8' · KP"}
        </Text>
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
        onChange={(v) => setDraft({ ...draft, text: v })}
        sample={(scale, color) => (
          <Text style={{ color, fontSize: Math.round(16 * scale), fontWeight: '700' }}>Aa</Text>
        )}
      />
      <SizePicker
        title="Icon size"
        value={draft.icons}
        onChange={(v) => setDraft({ ...draft, icons: v })}
        sample={(scale, color) => <Ionicons name="cube-outline" size={Math.round(20 * scale)} color={color} />}
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
      <View style={{ flexDirection: 'row', gap: 8 }}>
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
                flex: 1,
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
