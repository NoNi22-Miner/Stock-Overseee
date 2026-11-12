import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { Button, Card, Chip, Field, styles, Text } from '../components/ui';
import { getTeamBrand, saveTeamBrand } from '../lib/api';
import { useRole } from '../lib/auth';
import { useBrand } from '../lib/brand';
import { logoColors, MAX_LOGO_CHARS, prepareLogo } from '../lib/logo';
import { can } from '../lib/roles';
import {
  colors,
  contrast,
  DEFAULT_COLOR,
  defaultHome,
  fs,
  HOME_SECTIONS,
  homeSections,
  paletteFor,
  parseHex,
  toHex,
  type Density,
  type HomeSection,
  type Mode,
  type NavPosition,
  type Palette,
  type TeamTheme,
} from '../lib/theme';

const SWATCHES = [
  '#1565C0',
  '#0D47A1',
  '#00838F',
  '#2E7D32',
  '#558B2F',
  '#F9A825',
  '#EF6C00',
  '#C62828',
  '#AD1457',
  '#6A1B9A',
  '#4E342E',
  '#37474F',
];

const MODES: { key: Mode; label: string }[] = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];
const NAVS: { key: NavPosition; label: string }[] = [
  { key: 'left', label: 'Side panel left' },
  { key: 'right', label: 'Side panel right' },
  { key: 'bottom', label: 'Tabs at the bottom' },
];
const DENSITIES: { key: Density; label: string }[] = [
  { key: 'compact', label: 'Compact' },
  { key: 'normal', label: 'Normal' },
  { key: 'roomy', label: 'Roomy' },
];

const sectionLabel = (k: string) => HOME_SECTIONS.find((s) => s.key === k)?.label ?? k;

/** Team Leader: the company look (logo, name, colors, light / dark) and layout for the whole team. */
export default function BrandingScreen() {
  const isLeader = can.manageUsers(useRole());
  const brand = useBrand();
  const [teamId, setTeamId] = useState<string | null>(brand.teamId);
  const [name, setName] = useState(brand.companyName ?? '');
  const [draft, setDraft] = useState<TeamTheme>(() => ({ ...brand.theme, home: homeSections(brand.theme.home) }));
  const [logoChoices, setLogoChoices] = useState<string[]>([]);
  const [hex, setHex] = useState(brand.theme.color ?? '');
  const [busy, setBusy] = useState<string | null>(null);

  // The saved look from the server (another phone may have changed it).
  useEffect(() => {
    getTeamBrand()
      .then((t) => {
        if (!t) return;
        setTeamId(t.id);
        setName(t.name);
        setDraft({ ...(t.theme ?? {}), home: homeSections(t.theme?.home) });
        setHex(t.theme?.color ?? '');
        if (t.theme?.logo)
          logoColors(t.theme.logo)
            .then(setLogoChoices)
            .catch(() => {});
      })
      .catch(() => {});
  }, []);

  const preview = useMemo(() => paletteFor(draft), [draft]);
  const set = (patch: Partial<TeamTheme>) => setDraft((d) => ({ ...d, ...patch }));
  const home = draft.home ?? defaultHome();

  async function pickLogo() {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['image/png', 'image/jpeg', 'image/webp'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      setBusy('logo');
      const logo = await prepareLogo(res.assets[0].uri);
      if (logo.length > MAX_LOGO_CHARS) throw new Error('This image is too big. Use a simpler logo (PNG).');
      const found = await logoColors(logo).catch(() => [] as string[]);
      setLogoChoices(found);
      // A new logo brings its color, unless a color was picked by hand.
      const color = draft.colorFrom === 'manual' && draft.color ? draft.color : (found[0] ?? draft.color ?? null);
      set({ logo, color, colorFrom: draft.colorFrom === 'manual' ? 'manual' : 'logo' });
      if (color) setHex(color);
    } catch (e) {
      Alert.alert('Could not use this logo', (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function chooseColor(c: string, from: 'logo' | 'manual') {
    set({ color: c, colorFrom: from });
    setHex(c);
  }

  function moveSection(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= home.length) return;
    const next = [...home];
    [next[i], next[j]] = [next[j], next[i]];
    set({ home: next });
  }

  async function save() {
    if (!teamId) return;
    setBusy('save');
    try {
      const theme: TeamTheme = {
        logo: draft.logo ?? null,
        color: draft.color ?? null,
        colorFrom: draft.colorFrom ?? (draft.logo ? 'logo' : 'manual'),
        mode: draft.mode ?? 'light',
        nav: draft.nav ?? 'left',
        density: draft.density ?? 'normal',
        home,
      };
      await saveTeamBrand(teamId, name || brand.companyName || 'My Team', theme);
      brand.applyBrand({ teamId, companyName: name.trim() || brand.companyName, theme }, '/branding');
      Alert.alert('Saved', 'Everyone in the team gets this look the next time they open the app.');
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    Alert.alert('Back to the standard look?', 'Removes the logo and colors, and resets the layout.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () => {
          setDraft({ home: defaultHome() });
          setLogoChoices([]);
          setHex('');
        },
      },
    ]);
  }

  if (!isLeader) {
    return (
      <View style={[styles.screen, styles.pad]}>
        <Text style={styles.title}>Only the Team Leader can change the theme and layout.</Text>
      </View>
    );
  }

  const hexOk = !!parseHex(hex);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.pad, { paddingBottom: 40 }]}>
      <Preview palette={preview} name={name} logo={draft.logo ?? null} nav={draft.nav ?? 'left'} />

      <Text style={styles.title}>Company</Text>
      <Card style={{ gap: 10 }}>
        <Field
          label="Company name (shown in the app and on the login screen)"
          value={name}
          onChangeText={setName}
          maxLength={60}
        />
        <Text style={styles.label}>Logo</Text>
        <View style={[styles.row, { gap: 12 }]}>
          <View
            style={{
              width: 96,
              height: 60,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: preview.mode === 'dark' ? '#FFFFFF' : preview.card,
            }}
          >
            {draft.logo ? (
              <Image source={{ uri: draft.logo }} style={{ width: 88, height: 52 }} resizeMode="contain" />
            ) : (
              <Text style={styles.muted}>No logo</Text>
            )}
          </View>
          <View style={{ flex: 1, gap: 8 }}>
            <Button title={draft.logo ? 'Change logo' : 'Choose logo'} onPress={pickLogo} loading={busy === 'logo'} />
            {draft.logo && (
              <Button
                title="Remove logo"
                variant="outline"
                color={colors.out}
                onPress={() => {
                  set({ logo: null, colorFrom: 'manual' });
                  setLogoChoices([]);
                }}
              />
            )}
          </View>
        </View>
        <Text style={styles.muted}>
          PNG with a clear background works best. It is made small (256 px) and kept for offline use.
        </Text>
      </Card>

      <Text style={styles.title}>Main color</Text>
      <Card style={{ gap: 10 }}>
        {logoChoices.length > 0 && (
          <>
            <Text style={styles.label}>From the logo</Text>
            <View style={styles.chipRow}>
              {logoChoices.map((c) => (
                <Swatch key={c} color={c} active={draft.color === c} onPress={() => chooseColor(c, 'logo')} />
              ))}
            </View>
          </>
        )}
        <Text style={styles.label}>Or pick one</Text>
        <View style={styles.chipRow}>
          {SWATCHES.map((c) => (
            <Swatch
              key={c}
              color={c}
              active={draft.color?.toUpperCase() === c && draft.colorFrom !== 'logo'}
              onPress={() => chooseColor(c, 'manual')}
            />
          ))}
        </View>
        <View style={[styles.row, { alignItems: 'flex-end' }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Color code</Text>
            <TextInput
              style={styles.input}
              value={hex}
              onChangeText={setHex}
              placeholder={DEFAULT_COLOR}
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={7}
            />
          </View>
          <Button
            title="Use"
            variant="outline"
            disabled={!hexOk}
            onPress={() => chooseColor(toHex(parseHex(hex)!), 'manual')}
          />
        </View>
        <Text style={styles.muted}>
          Light colors are made a little darker so text on buttons stays readable
          {draft.color && preview.primary !== draft.color.toUpperCase() ? ` (used: ${preview.primary})` : ''}.
        </Text>
      </Card>

      <Text style={styles.title}>Look</Text>
      <Card style={{ gap: 10 }}>
        <Text style={styles.label}>Mode</Text>
        <View style={styles.chipRow}>
          {MODES.map((m) => (
            <Chip
              key={m.key}
              label={m.label}
              active={(draft.mode ?? 'light') === m.key}
              onPress={() => set({ mode: m.key })}
            />
          ))}
        </View>
        <Text style={styles.label}>Menu</Text>
        <View style={styles.chipRow}>
          {NAVS.map((m) => (
            <Chip
              key={m.key}
              label={m.label}
              active={(draft.nav ?? 'left') === m.key}
              onPress={() => set({ nav: m.key })}
            />
          ))}
        </View>
        <Text style={styles.label}>Spacing</Text>
        <View style={styles.chipRow}>
          {DENSITIES.map((m) => (
            <Chip
              key={m.key}
              label={m.label}
              active={(draft.density ?? 'normal') === m.key}
              onPress={() => set({ density: m.key })}
            />
          ))}
        </View>
        <Text style={styles.muted}>Compact fits more on a tablet; Roomy gives bigger buttons.</Text>
      </Card>

      <Text style={styles.title}>Home page</Text>
      <Card style={{ gap: 4 }}>
        <Text style={styles.muted}>Turn sections on or off and move them up or down.</Text>
        {home.map((s: HomeSection, i) => (
          <View
            key={s.key}
            style={[styles.row, { paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }]}
          >
            <Switch
              value={s.on}
              onValueChange={(on) => set({ home: home.map((x) => (x.key === s.key ? { ...x, on } : x)) })}
            />
            <Text style={{ flex: 1, color: s.on ? colors.text : colors.muted }}>{sectionLabel(s.key)}</Text>
            <Pressable onPress={() => moveSection(i, -1)} hitSlop={8} disabled={i === 0} accessibilityLabel="Move up">
              <Text style={{ fontSize: fs(20), color: i === 0 ? colors.border : colors.primary, paddingHorizontal: 6 }}>
                ↑
              </Text>
            </Pressable>
            <Pressable
              onPress={() => moveSection(i, 1)}
              hitSlop={8}
              disabled={i === home.length - 1}
              accessibilityLabel="Move down"
            >
              <Text
                style={{
                  fontSize: fs(20),
                  color: i === home.length - 1 ? colors.border : colors.primary,
                  paddingHorizontal: 6,
                }}
              >
                ↓
              </Text>
            </Pressable>
          </View>
        ))}
      </Card>

      <Button title="Save for the whole team" onPress={save} loading={busy === 'save'} disabled={!!busy || !teamId} />
      <Button title="Back to the standard look" variant="outline" color={colors.muted} onPress={reset} />
    </ScrollView>
  );
}

function Swatch({ color, active, onPress }: { color: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Color ${color}`}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: color,
        borderWidth: active ? 3 : 1,
        borderColor: active ? colors.text : colors.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {active && (
        <Text
          style={{
            color: contrast(parseHex(color)!, [255, 255, 255]) >= 2.5 ? '#FFFFFF' : '#000000',
            fontWeight: '900',
          }}
        >
          ✓
        </Text>
      )}
    </Pressable>
  );
}

/** A small picture of the app in the chosen look (before saving). */
function Preview({
  palette: p,
  name,
  logo,
  nav,
}: {
  palette: Palette;
  name: string;
  logo: string | null;
  nav: NavPosition;
}) {
  const rail = (
    <View style={{ width: 44, backgroundColor: p.card, borderColor: p.border, gap: 6, padding: 6 }}>
      {[true, false, false, false].map((on, i) => (
        <View
          key={i}
          style={{
            height: 24,
            borderRadius: 6,
            backgroundColor: on ? p.primarySoft : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: on ? p.primary : p.muted }} />
        </View>
      ))}
    </View>
  );
  return (
    <View
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
        backgroundColor: p.bg,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          padding: 10,
          backgroundColor: p.card,
          borderBottomWidth: 1,
          borderBottomColor: p.border,
        }}
      >
        {logo && (
          <View style={p.mode === 'dark' ? { backgroundColor: '#FFFFFF', borderRadius: 6, padding: 3 } : undefined}>
            <Image source={{ uri: logo }} style={{ width: 44, height: 26 }} resizeMode="contain" />
          </View>
        )}
        <Text style={{ color: p.text, fontWeight: '800', fontSize: fs(16) }} numberOfLines={1}>
          {name || 'Company name'}
        </Text>
      </View>
      <View style={{ flexDirection: nav === 'right' ? 'row-reverse' : 'row', minHeight: 150 }}>
        {nav !== 'bottom' && rail}
        <View style={{ flex: 1, padding: 10, gap: 8 }}>
          <View
            style={{
              backgroundColor: p.card,
              borderColor: p.border,
              borderWidth: 1,
              borderRadius: 10,
              padding: 10,
              gap: 6,
            }}
          >
            <Text style={{ color: p.text, fontWeight: '700' }}>Top 5 most moving</Text>
            {[1, 0.7, 0.45].map((w) => (
              <View key={w} style={{ height: 8, width: `${w * 100}%`, borderRadius: 4, backgroundColor: p.primary }} />
            ))}
            <Text style={{ color: p.muted, fontSize: fs(12) }}>{"PLAT BESI · SS400 · 10mm × 4' × 8'"}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ backgroundColor: p.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 }}>
              <Text style={{ color: p.primaryText, fontWeight: '700' }}>Stock In</Text>
            </View>
            <View
              style={{
                borderColor: p.primary,
                borderWidth: 1.5,
                borderRadius: 999,
                paddingHorizontal: 12,
                paddingVertical: 6,
              }}
            >
              <Text style={{ color: p.primary, fontWeight: '600' }}>WRH</Text>
            </View>
          </View>
        </View>
      </View>
      {nav === 'bottom' && (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-around',
            padding: 8,
            backgroundColor: p.card,
            borderTopWidth: 1,
            borderTopColor: p.border,
          }}
        >
          {[true, false, false, false, false].map((on, i) => (
            <View
              key={i}
              style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: on ? p.primary : p.muted }}
            />
          ))}
        </View>
      )}
    </View>
  );
}
