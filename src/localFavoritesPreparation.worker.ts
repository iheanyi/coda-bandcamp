import {
  localFavoritesInputMatchesPrepared,
  parseLocalFavoritesPreparationRequest,
  serializeValidatedLocalFavorites,
  type LocalFavoritesPreparationResponse,
} from "./localFavoritesPreparation";
import {
  parseLocalFavoritesSerialized,
} from "./localFavorites";

function respond(response: LocalFavoritesPreparationResponse): void {
  globalThis.postMessage(response);
}

globalThis.addEventListener(
  "message",
  ({ data }: MessageEvent<unknown>) => {
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
      const prepared = serializeValidatedLocalFavorites(request.favorites);
      const inputMatches = localFavoritesInputMatchesPrepared(
        request.sourceFavorites,
        prepared,
      );
      const response: LocalFavoritesPreparationResponse = {
        kind: "local-favorites-serialized",
        requestId: request.requestId,
        prepared: {
          serialized: prepared.serialized,
        },
      };
      if (!inputMatches) response.prepared.favorites = prepared.favorites;
      respond(response);
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
  },
);
