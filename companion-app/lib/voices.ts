// Voice styles a creator can pick for a companion. They change the pace and
// tone of the device's built in voice; they don't copy anyone's real voice.
export const VOICES = {
  natural: { label: "Natural", hint: "Clear and easy", rate: 1, pitch: 1 },
  warm: { label: "Warm", hint: "Relaxed and friendly", rate: 0.96, pitch: 0.9 },
  deep: { label: "Deep and calm", hint: "Low and steady", rate: 0.92, pitch: 0.72 },
  bright: { label: "Bright", hint: "Light and cheerful", rate: 1.04, pitch: 1.18 },
  energetic: { label: "Energetic", hint: "Fast and upbeat", rate: 1.15, pitch: 1.08 },
  gentle: { label: "Gentle", hint: "Slow and soft", rate: 0.84, pitch: 1.02 },
  wise: { label: "Wise elder", hint: "Slow and low", rate: 0.82, pitch: 0.82 },
} as const;

export type VoiceKey = keyof typeof VOICES;
export const VOICE_KEYS = Object.keys(VOICES) as VoiceKey[];

export function voiceStyle(key: string | null | undefined) {
  const v = key && key in VOICES ? VOICES[key as VoiceKey] : null;
  return v ? { rate: v.rate, pitch: v.pitch } : undefined;
}
