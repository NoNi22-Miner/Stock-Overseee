import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, styles } from '../components/ui';
import { useAuth } from '../lib/auth';
import { colors } from '../lib/theme';

/** Signed in, but the account has no role yet or was deactivated. */
export default function NoAccess() {
  const { profile, profileError, reloadProfile, signOut } = useAuth();
  const disabled = profile?.role && !profile.is_active;

  return (
    <SafeAreaView style={[styles.screen, { justifyContent: 'center' }]}>
      <View style={[styles.pad, { gap: 16 }]}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>
          {disabled ? 'Account disabled' : 'No access yet'}
        </Text>
        <Text style={{ color: colors.text, fontSize: 16 }}>
          {profileError
            ? `Could not load your account: ${profileError}`
            : disabled
              ? 'The Owner has disabled this account.'
              : 'This account has no role. Ask the Owner to give you a User ID.'}
        </Text>
        <Button title="Try again" onPress={reloadProfile} />
        <Button title="Sign out" variant="outline" color={colors.out} onPress={signOut} />
      </View>
    </SafeAreaView>
  );
}
