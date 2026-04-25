import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Locale, messages } from './messages';

const LOCALE_STORAGE_KEY = 'twitcanva.locale';

type Params = Record<string, string | number>;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Params) => string;
  formatTime: (value: number | Date) => string;
  formatDate: (value: number | Date) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const resolveInitialLocale = (): Locale => {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (stored === 'en' || stored === 'zh-CN') {
    return stored;
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
};

const injectParams = (template: string, params?: Params): string => {
  if (!params) return template;
  return Object.entries(params).reduce((result, [key, value]) => {
    return result.replaceAll(`{{${key}}}`, String(value));
  }, template);
};

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(() => resolveInitialLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
  }, []);

  const t = useCallback((key: string, params?: Params): string => {
    const localized = messages[locale]?.[key] ?? messages.en[key] ?? key;
    return injectParams(localized, params);
  }, [locale]);

  const formatTime = useCallback((value: number | Date): string => {
    const date = value instanceof Date ? value : new Date(value);
    return new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }, [locale]);

  const formatDate = useCallback((value: number | Date): string => {
    const date = value instanceof Date ? value : new Date(value);
    return new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  }, [locale]);

  const contextValue = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t,
    formatTime,
    formatDate
  }), [locale, setLocale, t, formatTime, formatDate]);

  return <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextValue => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
};
