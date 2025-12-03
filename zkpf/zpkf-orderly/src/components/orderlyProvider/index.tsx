import { Outlet } from "react-router";
import {
  LocaleCode,
  LocaleEnum,
  LocaleProvider,
  removeLangPrefix,
} from "@orderly.network/i18n";
import { OrderlyAppProvider } from "@orderly.network/react-app";
import { WalletConnectorProvider } from "@orderly.network/wallet-connector";
import { useNav } from "../../hooks/useNav";
import { useOrderlyConfig } from "../../hooks/useOrderlyConfig";
import { usePageTitle } from "../../hooks/usePageTitle";

export const OrderlyProvider = () => {
  const config = useOrderlyConfig();
  const { onRouteChange } = useNav();
  usePageTitle();

  const onLanguageChanged = async (lang: LocaleCode) => {
    const path = removeLangPrefix(window.location.pathname);
    window.history.replaceState({}, "", `/${lang}${path}`);
  };

  const loadPath = (lang: LocaleCode) => {
    if (lang === LocaleEnum.en) {
      // because en is built-in, we need to load the en extend only
      return `/locales/extend/${lang}.json`;
    }
    return [`/locales/${lang}.json`, `/locales/extend/${lang}.json`];
  };

  return (
    <LocaleProvider
      onLanguageChanged={onLanguageChanged}
      backend={{ loadPath }}
    >
      <WalletConnectorProvider>
        <OrderlyAppProvider
          brokerId="orderly"
          brokerName="Orderly"
          networkId="testnet"
          appIcons={config.orderlyAppProvider.appIcons}
          onRouteChange={onRouteChange}
        >
          <Outlet />
        </OrderlyAppProvider>
      </WalletConnectorProvider>
    </LocaleProvider>
  );
};
