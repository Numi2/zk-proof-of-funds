import { SettingModule } from "@orderly.network/portfolio";
import { LocaleSettings } from "../../components/settings";

export default function SettingsPage() {
  return (
    <div className="dex-settings-page">
      <LocaleSettings />
      <SettingModule.SettingPage />
    </div>
  );
}

