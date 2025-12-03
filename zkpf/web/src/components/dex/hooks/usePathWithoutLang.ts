import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { removeLangPrefix } from "@orderly.network/i18n";

/**
 * Get the pathname without the language prefix
 * /dex/en/perp/PERP_BTC_USDC => /dex/perp/PERP_BTC_USDC
 * /dex/en/markets => /dex/markets
 */
export function usePathWithoutLang() {
  const location = useLocation();
  const pathname = location.pathname;

  return useMemo(() => {
    // Remove /dex prefix, process locale, then add it back
    const pathWithoutDex = pathname.replace(/^\/dex/, '');
    const pathWithoutLang = removeLangPrefix(pathWithoutDex);
    // Ensure result starts with /dex
    return pathWithoutLang.startsWith('/dex') ? pathWithoutLang : `/dex${pathWithoutLang}`;
  }, [pathname]);
}

