import { getRequestConfig } from "next-intl/server";

export const locale = "es";

export default getRequestConfig(async () => ({
  locale,
  messages: (await import(`../../messages/${locale}.json`)).default,
}));
