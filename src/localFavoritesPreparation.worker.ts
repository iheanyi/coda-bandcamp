import {
  parseLocalFavoritesSerialized,
  serializeLocalFavorites,
  type LocalFavoritesPreparationRequest,
  type LocalFavoritesPreparationResponse,
} from "./localFavoritesPreparation";

type LocalFavoritesWorkerScope = {
  onmessage: (
    (event: MessageEvent<LocalFavoritesPreparationRequest>) => void
  ) | null;
  postMessage: (response: LocalFavoritesPreparationResponse) => void;
};

const workerScope = globalThis as unknown as LocalFavoritesWorkerScope;

workerScope.onmessage = ({ data }) => {
  try {
    if (data.kind === "parse-local-favorites") {
      workerScope.postMessage({
        kind: "local-favorites-parsed",
        requestId: data.requestId,
        favorites: parseLocalFavoritesSerialized(data.serialized),
      });
      return;
    }
    workerScope.postMessage({
      kind: "local-favorites-serialized",
      requestId: data.requestId,
      prepared: serializeLocalFavorites(data.favorites),
    });
  } catch (cause) {
    const error = cause instanceof Error
      ? cause
      : new Error("Local Favorites are invalid and were not saved.");
    workerScope.postMessage({
      kind: "local-favorites-error",
      requestId: data.requestId,
      errorName: error.name,
      errorMessage: error.message,
    });
  }
};
