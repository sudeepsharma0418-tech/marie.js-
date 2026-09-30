import { Alert } from 'react-native';
import { useAppStore } from '../state/AppStore';
import { confirmSensitiveAction } from '../services/biometrics';
import type { TrustedDevice } from '../types';

/** Confirm, re-authenticate, then revoke. Shared by the list and detail screens. */
export function useRemoveDevice() {
  const { state, actions } = useAppStore();
  return (d: TrustedDevice, onDone?: () => void) =>
    Alert.alert(
      `Remove ${d.name}?`,
      'This ends any current session and revokes access immediately. The device will need a new code and your approval to connect again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove Access',
          style: 'destructive',
          onPress: async () => {
            const ok = await confirmSensitiveAction(
              `Remove ${d.name}`,
              state.settings.biometricForSensitiveActions,
            );
            if (!ok) return;
            await actions.revoke(d.id);
            onDone?.();
          },
        },
      ],
    );
}
