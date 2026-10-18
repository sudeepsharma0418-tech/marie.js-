import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import ne from './ne.json';

const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('hp.lang') : null;

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ne: { translation: ne } },
  lng: saved === 'ne' ? 'ne' : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  localStorage.setItem('hp.lang', lng);
});
if (typeof document !== 'undefined') document.documentElement.lang = i18n.language;

export default i18n;
