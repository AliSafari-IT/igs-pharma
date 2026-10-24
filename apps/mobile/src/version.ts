import * as Application from "expo-application";
import Constants from "expo-constants";

export const appVersion =
  Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "?";
/** The Play version code; EAS raises it on every production build. */
export const buildNumber = Application.nativeBuildVersion;

/** "v1.0.0 (3)": testers see at once which build they have. */
export const versionLabel = `v${appVersion}${buildNumber ? ` (${buildNumber})` : ""}`;

/** The day EAS made this build (app.config.js), "2026-10-24". */
export const buildDate = Constants.expoConfig?.extra?.buildDate as string | undefined;
