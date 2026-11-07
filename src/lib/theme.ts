// The app's look. A team's branding (set by the Team Leader) changes these values for everyone in
// the team: main color (from the logo or picked by hand), light / dark mode, side panel position,
// spacing and the Home page sections. Screens read the live objects below; when the theme changes
// they are updated in place and the app is drawn again (see lib/brand.tsx).

export type Mode = 'light' | 'dark';
export type NavPosition = 'left' | 'right' | 'bottom';
export type Density = 'compact' | 'normal' | 'roomy';

export const HOME_SECTIONS = [
  { key: 'tiles', label: 'Summary tiles (movements, items moved, low stock)' },
  { key: 'top', label: 'Top 5 most moving' },
  { key: 'least', label: 'Top 5 least moving' },
  { key: 'category', label: 'Movement by category' },
  { key: 'daily', label: 'Daily movement, all items' },
  { key: 'items', label: 'Daily movement per item' },
] as const;
export type HomeKey = (typeof HOME_SECTIONS)[number]['key'];
export type HomeSection = { key: HomeKey; on: boolean };

/** What a team saves (teams.theme). Every field is optional; missing ones use the defaults. */
export type TeamTheme = {
  /** Logo as a small PNG data URL. */
  logo?: string | null;
  /** Main color, e.g. "#1565C0". */
  color?: string | null;
  /** Where the color came from: picked from the logo, or by hand. */
  colorFrom?: 'logo' | 'manual';
  mode?: Mode;
  nav?: NavPosition;
  density?: Density;
  home?: HomeSection[];
};

export const DEFAULT_COLOR = '#1565C0';

// Color math ---------------------------------------------------------------------------------------

type RGB = [number, number, number];

export function parseHex(hex: string | null | undefined): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

export const toHex = ([r, g, b]: RGB) =>
  `#${[r, g, b]
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`.toUpperCase();

function luminance([r, g, b]: RGB) {
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** WCAG contrast ratio, 1..21. */
export function contrast(a: RGB, b: RGB) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** a blended toward b by t (0..1). */
export const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;

export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb([h, s, l]: [number, number, number]): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

const WHITE: RGB = [255, 255, 255];

/**
 * A brand color made usable as the main color.
 * - Light mode: darkened until white text on it is readable (buttons) and it reads as text on white.
 * - Dark mode: lightened until it reads on the dark background; button text is then dark if needed.
 */
export function usableColor(hex: string | null | undefined, mode: Mode): string {
  const rgb = parseHex(hex) ?? parseHex(DEFAULT_COLOR)!;
  let [h, s, l] = rgbToHsl(rgb);
  let out = rgb;
  if (mode === 'dark') {
    const card = parseHex('#18202A')!;
    for (let i = 0; i < 50 && contrast(out, card) < 4.5; i++) {
      l = Math.min(0.9, l + 0.02);
      out = hslToRgb([h, s, l]);
    }
  } else {
    for (let i = 0; i < 50 && contrast(out, WHITE) < 4.5; i++) {
      l = Math.max(0, l - 0.02);
      out = hslToRgb([h, s, l]);
    }
  }
  return toHex(out);
}

// The palette --------------------------------------------------------------------------------------

const LIGHT = {
  bg: '#F4F6F8',
  card: '#FFFFFF',
  text: '#1B2430',
  muted: '#6B7785',
  border: '#DDE2E8',
  in: '#2E7D32',
  out: '#C62828',
  transfer: '#6A1B9A',
  adjust: '#00838F',
  online: '#2E7D32',
  warn: '#E65100',
  warnBg: '#FFF3E0',
};

const DARK: typeof LIGHT = {
  bg: '#0F141A',
  card: '#18202A',
  text: '#E6EBF0',
  muted: '#98A4B1',
  border: '#2B3540',
  in: '#5CB860',
  out: '#EF6461',
  transfer: '#C084D4',
  adjust: '#3CC4D4',
  online: '#5CB860',
  warn: '#FFA34D',
  warnBg: '#3A2614',
};

export type Palette = typeof LIGHT & {
  mode: Mode;
  primary: string;
  primaryText: string;
  /** A light tint of the main color, for selected rows (or a dark tint on dark mode). */
  primarySoft: string;
};

export function paletteFor(theme: TeamTheme): Palette {
  const mode: Mode = theme.mode === 'dark' ? 'dark' : 'light';
  const base = mode === 'dark' ? DARK : LIGHT;
  const primary = usableColor(theme.color ?? DEFAULT_COLOR, mode);
  const rgb = parseHex(primary)!;
  const soft = mix(rgb, parseHex(base.card)!, mode === 'dark' ? 0.78 : 0.88);
  const primaryText = contrast(rgb, WHITE) >= 4.5 ? '#FFFFFF' : '#0F141A';
  return { ...base, mode, primary, primaryText, primarySoft: toHex(soft) };
}

/** Chart colors for a palette (one hue: the main color). */
export function chartFor(p: Palette) {
  const bar = parseHex(p.primary)!;
  const dark = p.mode === 'dark';
  return {
    bar: p.primary,
    barActive: toHex(dark ? mix(bar, WHITE, 0.3) : mix(bar, [0, 0, 0], 0.25)),
    grid: dark ? '#2A323B' : '#E1E0D9',
    axis: dark ? '#4A5561' : '#C3C2B7',
    ink: dark ? '#EEF1F4' : '#0B0B0B',
    inkSecondary: dark ? '#B4BDC6' : '#52514E',
    inkMuted: dark ? '#87919C' : '#898781',
  };
}

const SPACING = {
  compact: { pad: 12, gap: 8, cardPad: 10, button: 42, inputPad: 7, chipPad: 5, font: 15 },
  normal: { pad: 16, gap: 12, cardPad: 14, button: 48, inputPad: 10, chipPad: 7, font: 16 },
  roomy: { pad: 20, gap: 16, cardPad: 18, button: 56, inputPad: 13, chipPad: 10, font: 17 },
};

export function defaultHome(): HomeSection[] {
  return HOME_SECTIONS.map((s) => ({ key: s.key, on: true }));
}

/** The saved Home order, with any section added later appended (shown). */
export function homeSections(saved: HomeSection[] | undefined): HomeSection[] {
  const known = new Set<string>(HOME_SECTIONS.map((s) => s.key));
  const list = (saved ?? []).filter((s) => known.has(s.key));
  for (const s of HOME_SECTIONS) if (!list.some((x) => x.key === s.key)) list.push({ key: s.key, on: true });
  return list;
}

// Live values (read by every screen) ------------------------------------------------------------------

export const colors: Palette = paletteFor({});
export const chart = chartFor(colors);
export const kindColor = { IN: colors.in, OUT: colors.out, TRANSFER: colors.transfer, ADJUST: colors.adjust };
export const layout = {
  nav: 'left' as NavPosition,
  density: 'normal' as Density,
  space: SPACING.normal,
  home: defaultHome(),
};

const rebuilders = new Set<() => void>();

/**
 * Styles that follow the theme: `make` runs again whenever the theme changes, and the same object is
 * updated in place, so `styles.card` always has the current colors.
 */
export function themed<T extends object>(make: () => T): T {
  const target = {} as T;
  const build = () => {
    for (const k of Object.keys(target)) delete (target as Record<string, unknown>)[k];
    Object.assign(target, make());
  };
  build();
  rebuilders.add(build);
  return target;
}

/** Puts a team's theme into the live values. The caller then draws the app again. */
export function applyTheme(theme: TeamTheme) {
  Object.assign(colors, paletteFor(theme));
  Object.assign(chart, chartFor(colors));
  Object.assign(kindColor, { IN: colors.in, OUT: colors.out, TRANSFER: colors.transfer, ADJUST: colors.adjust });
  const density: Density = theme.density && SPACING[theme.density] ? theme.density : 'normal';
  Object.assign(layout, {
    nav: theme.nav === 'right' || theme.nav === 'bottom' ? theme.nav : 'left',
    density,
    space: SPACING[density],
    home: homeSections(theme.home),
  });
  rebuilders.forEach((b) => b());
}
