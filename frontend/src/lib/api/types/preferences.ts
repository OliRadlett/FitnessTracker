export type UnitSystem = 'metric' | 'imperial';
export type DateLocale = 'en-GB' | 'en-US';
export type TimeFormat = '24h' | '12h';

export interface UserPreferences {
  unit_system: UnitSystem;
  locale: DateLocale;
  time_format: TimeFormat;
}

export interface UserPreferencesUpdate extends Partial<UserPreferences> {}