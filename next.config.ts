import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Both drivers are native/ESM packages that resolve their own files at runtime. Bundled by webpack
  // they receive a `URL` where Node's `fs` wants a path, and every API route dies with a 500
  // (`ERR_INVALID_ARG_TYPE`) — which is invisible until the app is actually run.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
};

export default nextConfig;
