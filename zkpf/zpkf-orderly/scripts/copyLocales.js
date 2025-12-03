import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function copyLocales() {
  await fs.copy(
    path.resolve(
      __dirname,
      "../node_modules/@orderly.network/i18n/dist/locales"
    ),
    path.resolve(__dirname, "../public/locales")
  );
}

copyLocales();
