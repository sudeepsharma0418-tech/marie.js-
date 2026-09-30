import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Asks for Face ID / Touch ID / Android biometrics (falling back to the device
 * passcode) before a sensitive action such as trusting or removing a device.
 * If the phone has no biometrics enrolled we let the action through, because
 * the user is already past the lock screen.
 */
export async function confirmSensitiveAction(reason: string, enabled: boolean): Promise<boolean> {
  if (!enabled) return true;
  try {
    const [hasHardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    if (!hasHardware || !enrolled) return true;
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return false;
  }
}
