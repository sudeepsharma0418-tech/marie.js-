import { useColorScheme } from 'react-native';

const light = {
  bg: '#F5F6F8',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF0F3',
  text: '#11151C',
  textMuted: '#5B6472',
  border: '#DDE1E7',
  primary: '#2F6BFF',
  primaryText: '#FFFFFF',
  success: '#1E9E5A',
  warning: '#C98A00',
  danger: '#D93A3A',
  offline: '#8A93A0',
  sharingBanner: '#D93A3A',
};

const dark: typeof light = {
  bg: '#0E1116',
  surface: '#171B22',
  surfaceAlt: '#20252E',
  text: '#EEF1F5',
  textMuted: '#9AA3B0',
  border: '#2A303A',
  primary: '#5A8BFF',
  primaryText: '#FFFFFF',
  success: '#3DC47E',
  warning: '#E7B23A',
  danger: '#F06262',
  offline: '#6C7582',
  sharingBanner: '#C23030',
};

export type Palette = typeof light;

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
