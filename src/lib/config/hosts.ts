/**
 * Which hostnames this deployment answers on (PLAN.md §14 I2 #3).
 *
 * These used to sit in `lib/site-config.ts` beside the marketing site's phone
 * number and RUC — infrastructure and copy in one file, so `middleware.ts`
 * imported the owner's address to learn which host is the app. They are
 * separate now: hosts here, content there.
 *
 * Deliberately plain `process.env` reads rather than the validated `env`
 * module: `middleware.ts` is the main consumer and runs on the edge runtime,
 * where importing the server env schema (and through it the database client)
 * is not available. The defaults are the production values, so an
 * unconfigured environment behaves exactly as the hardcoded constants did.
 */

export const APEX_HOST = process.env.APEX_HOST || "clientes.com.py";
export const APP_HOST = process.env.APP_HOST || `crm.${APEX_HOST}`;

export const SITE_URL = `https://${APEX_HOST}`;
export const CRM_URL = `https://${APP_HOST}`;
export const CRM_LOGIN_URL = `${CRM_URL}/login`;
