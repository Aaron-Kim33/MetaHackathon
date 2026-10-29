import React, { useSyncExternalStore } from 'react';
import { NativeModules, Text as NativeText } from 'react-native';
import type { TextProps } from 'react-native';
import * as FS from 'expo-file-system/legacy';
import { getLanguage, languageFromLocale, setLanguage, subscribeLanguage, t } from './i18n';
import type { Language } from './i18n';
export const useLanguage = () => useSyncExternalStore(subscribeLanguage,getLanguage,getLanguage);
export function LocalizedText({children,...props}: TextProps) {
  useLanguage();
  return <NativeText {...props}>{React.Children.map(children,child=> typeof child==='string' ? t(child) : child)}</NativeText>;
}
const preferenceFile = FS.documentDirectory && `${FS.documentDirectory}editor-language.json`;
let preferenceWrite = Promise.resolve();
export function chooseLanguage(language: Language) {
  setLanguage(language);
  if(preferenceFile)preferenceWrite=preferenceWrite.catch(()=>{}).then(()=>FS.writeAsStringAsync(preferenceFile,JSON.stringify({language})));
  return preferenceWrite;
}
export async function initializeLanguage() {
  let locale='en';
  try {
    const settings=NativeModules.SettingsManager?.settings;
    locale=settings?.AppleLanguages?.[0] || settings?.AppleLocale || NativeModules.I18nManager?.getConstants?.().localeIdentifier || NativeModules.I18nManager?.localeIdentifier || Intl.DateTimeFormat().resolvedOptions().locale;
  }catch{}
  setLanguage(languageFromLocale(locale || 'en'));
  if(preferenceFile)try{const saved=JSON.parse(await FS.readAsStringAsync(preferenceFile));if(saved.language==='ko'||saved.language==='en')setLanguage(saved.language);}catch{}
}
