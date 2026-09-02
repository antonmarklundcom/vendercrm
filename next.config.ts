import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // mysql2 (and better-auth's node-crypto-heavy internals) use dynamic
  // `require()` of Node builtins that Next's webpack server build can't
  // statically bundle — keep them as real Node require calls instead of
  // trying to inline them. Needed as soon as any server module reaches the
  // db client (worker/instrumentation.ts already did in 1A; 1B adds many
  // more server components/actions that import it transitively).
  serverExternalPackages: ["mysql2", "better-auth", "@aws-sdk/client-s3"],
  experimental: {
    // Next defaults its build workers to `os.cpus().length - 1`, which on
    // Hostinger's shared box is the physical core count of the host, not
    // this account's share. Each worker is a Node process with ~11 threads,
    // all counted against the account-wide 200 "Max Processes" cap that the
    // running sites already share. One worker keeps a deploy from tipping
    // the account over the cap (and failing its own build).
    cpus: 1,
  },
  webpack: (config, { nextRuntime, webpack }) => {
    // 1B adds middleware.ts (edge runtime), which makes Next build an Edge
    // variant of instrumentation.ts's register() too — even though its own
    // `NEXT_RUNTIME !== "nodejs"` guard means the worker import never
    // actually *executes* on Edge, webpack still tries to statically bundle
    // that branch, dragging in mysql2 (Node-only natives: crypto/tls/etc,
    // unsupported on Edge). Swap the worker entry point (and mysql2 itself,
    // reached transitively via db/client.ts) for Edge-safe stubs — safe
    // because the guard above prevents either from ever running there.
    if (nextRuntime === "edge") {
      config.resolve.alias = {
        ...config.resolve.alias,
        mysql2: false,
      };
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /[\\/]src[\\/]worker[\\/]index(\.ts)?$/,
          path.resolve(__dirname, "src/worker/edge-stub.ts"),
        ),
      );
    }
    return config;
  },
};

// Sentry's plugin uploads source maps at build time — it's a no-op unless
// SENTRY_AUTH_TOKEN (plus org/project) is set, so this is safe to wrap
// unconditionally (PLAN.md §10 1H #4).
export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  disableLogger: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
