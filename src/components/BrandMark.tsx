import { Image, Text, View } from 'react-native';
import { useBrand } from '../lib/brand';
import { colors } from '../lib/theme';

/** The company logo (and name) from the team's branding. Nothing when there is no logo. */
export function BrandMark({ size = 28, showName = false }: { size?: number; showName?: boolean }) {
  const { theme, companyName } = useBrand();
  if (!theme.logo && !(showName && companyName)) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {theme.logo && (
        // Logos are usually made for white paper: on dark mode they sit on a light plate.
        <View style={colors.mode === 'dark' ? { backgroundColor: '#FFFFFF', borderRadius: 6, padding: 3 } : undefined}>
          <Image
            source={{ uri: theme.logo }}
            style={{ width: size * 1.6, height: size }}
            resizeMode="contain"
            accessibilityLabel={companyName ? `${companyName} logo` : 'Company logo'}
          />
        </View>
      )}
      {showName && companyName && (
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: Math.max(16, size * 0.6) }} numberOfLines={1}>
          {companyName}
        </Text>
      )}
    </View>
  );
}
