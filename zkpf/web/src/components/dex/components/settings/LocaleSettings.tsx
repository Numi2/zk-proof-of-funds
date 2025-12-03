import { FC } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { i18n, parseI18nLang } from "@orderly.network/i18n";
import "./LocaleSettings.css";

// Available locales based on the public/locales directory
const LOCALES = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "zh", name: "中文", flag: "🇨🇳" },
  { code: "ja", name: "日本語", flag: "🇯🇵" },
  { code: "ko", name: "한국어", flag: "🇰🇷" },
  { code: "de", name: "Deutsch", flag: "🇩🇪" },
  { code: "es", name: "Español", flag: "🇪🇸" },
  { code: "fr", name: "Français", flag: "🇫🇷" },
  { code: "it", name: "Italiano", flag: "🇮🇹" },
  { code: "pt", name: "Português", flag: "🇧🇷" },
  { code: "ru", name: "Русский", flag: "🇷🇺" },
  { code: "tr", name: "Türkçe", flag: "🇹🇷" },
  { code: "vi", name: "Tiếng Việt", flag: "🇻🇳" },
  { code: "id", name: "Bahasa Indonesia", flag: "🇮🇩" },
  { code: "nl", name: "Nederlands", flag: "🇳🇱" },
  { code: "pl", name: "Polski", flag: "🇵🇱" },
  { code: "uk", name: "Українська", flag: "🇺🇦" },
];

export const LocaleSettings: FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentLocale = parseI18nLang(i18n.language);

  const handleLocaleChange = (localeCode: string) => {
    // Change language in i18n
    i18n.changeLanguage(localeCode);

    // Update URL to reflect new locale
    const currentPath = location.pathname;
    // Match pattern: /dex/{locale}/...
    const localeMatch = currentPath.match(/^\/dex\/([a-z]{2})(\/.*)?$/);
    
    if (localeMatch) {
      const restOfPath = localeMatch[2] || "";
      const newPath = `/dex/${localeCode}${restOfPath}`;
      navigate(newPath, { replace: true });
    }
  };

  return (
    <div className="locale-settings">
      <div className="locale-settings-header">
        <span className="locale-settings-icon">🌐</span>
        <div className="locale-settings-title-group">
          <h3 className="locale-settings-title">Language</h3>
          <p className="locale-settings-description">
            Select your preferred language for the interface
          </p>
        </div>
      </div>
      
      <div className="locale-grid">
        {LOCALES.map((locale) => (
          <button
            key={locale.code}
            className={`locale-option ${currentLocale === locale.code ? "locale-option-active" : ""}`}
            onClick={() => handleLocaleChange(locale.code)}
          >
            <span className="locale-flag">{locale.flag}</span>
            <span className="locale-name">{locale.name}</span>
            {currentLocale === locale.code && (
              <span className="locale-check">✓</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

export default LocaleSettings;

