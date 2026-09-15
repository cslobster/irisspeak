// The places a conversation can happen. Saved in the profile, written into the model prompt, and used to
// pick the question bank (public/questions.json).
export interface SettingOption { value: string; label: string; short: string; icon: string }
export const SETTINGS: SettingOption[] = [
  { value: 'home', label: 'Home', short: 'Home', icon: '🏠' },
  { value: 'school', label: 'School', short: 'School', icon: '🏫' },
  { value: 'restaurant', label: 'Restaurant / shop', short: 'Restaurant', icon: '🍽️' },
  { value: 'doctor', label: 'Doctor / clinic', short: 'Doctor', icon: '🩺' },
  { value: 'play', label: 'Play / outdoors', short: 'Play', icon: '🪁' },
  { value: 'transport', label: 'Transport', short: 'Transport', icon: '🚌' },
  { value: 'selfcare', label: 'Bedtime / self-care', short: 'Bedtime', icon: '🛏️' },
  { value: 'unknown', label: 'Somewhere else', short: 'Other', icon: '📍' },
];
