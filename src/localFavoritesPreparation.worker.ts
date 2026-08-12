import {
  localFavoritesInputMatchesPrepared,
  parseLocalFavoritesPreparationRequest,
  parseLocalFavoritesSerialized,
  serializeLocalFavorites,
  type LocalFavoritesPreparationResponse,
} from "./localFavoritesPreparation";

function respond(response: LocalFavoritesPreparationResponse): void {
  globalThis.postMessage(response);
}

globalThis.addEventListener("message", ({ data }: MessageEvent<unknown>) => {
  const request = parseLocalFavoritesPreparationRequest(data);
  if (!request) return;
  try {
    if (request.kind === "parse-local-favorites") {
      respond({
        kind: "local-favorites-parsed",
        requestId: request.requestId,
        favorites: parseLocalFavoritesSerialized(request.serialized),
      });
      return;
    }
    const prepared = serializeLocalFavorites(request.favorites);
    const inputMatches = localFavoritesInputMatchesPrepared(
      typeof data === "object" && data !== null && "favorites" in data
        ? data.favorites
        : undefined,
      prepared,
    );
    respond({
      kind: "local-favorites-serialized",
      requestId: request.requestId,
      prepared: {
        serialized: prepared.serialized,
        ...(inputMatches ? {} : { favorites: prepared.favorites }),
      },
    });
  } catch (cause) {
    const error = cause instanceof Error
      ? cause
      : new Error("Local Favorites are invalid and were not saved.");
    respond({
      kind: "local-favorites-error",
      requestId: request.requestId,
      errorName: error.name,
      errorMessage: error.message,
    });
  }
});
