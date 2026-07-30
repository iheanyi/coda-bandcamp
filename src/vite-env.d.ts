interface ImportMetaEnv {
  readonly VITE_CODA_APP_NAME?: string;
  readonly VITE_CODA_MOTION_VIEW_TRANSITIONS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
