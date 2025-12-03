import {
  i18n,
  parseI18nLang,
  getLocalePathFromPathname,
} from "@orderly.network/i18n";

export function generatePageTitle(title: string, suffix = "Orderly") {
  return `${title} | ${suffix}`;
}

export function formatSymbol(symbol: string, format = "base-type") {
  const arr = symbol.split("_");
  const type = arr[0];
  const base = arr[1];
  const quote = arr[2];

  return format
    .replace("type", type)
    .replace("base", base)
    .replace("quote", quote);
}

/**
 * Generate path with locale
 * @param path - path to generate (should start with /dex)
 * @returns path with locale
 */
export function generateLocalePath(path: string) {
  // Ensure path starts with /dex
  const normalizedPath = path.startsWith('/dex') ? path : `/dex${path}`;
  let localePath = getLocalePathFromPathname(normalizedPath);

  // if path already has locale, return it
  if (localePath) {
    return normalizedPath;
  }

  localePath = parseI18nLang(i18n.language);

  // if path doesn't have locale, add it
  // Path should be like /dex/en/perp/...
  return `/dex/${localePath}${normalizedPath.replace(/^\/dex/, '')}`;
}

