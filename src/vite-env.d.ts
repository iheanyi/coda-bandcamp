interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly MODE: string;
  readonly VITE_CODA_APP_NAME?: string;
  readonly VITE_CODA_UPDATER_ENABLED: "0" | "1";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
