interface ImportMetaEnv {
  readonly VITE_CODA_APP_NAME?: string;
  readonly VITE_CODA_MOTION_VIEW_TRANSITIONS?: string;
  readonly VITE_CODA_UPDATER_ENABLED: "0" | "1";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
