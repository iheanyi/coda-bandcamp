const SYSTEM_ARTWORK_SIZE = 600;
const MAX_SYSTEM_ARTWORK_DATA_URL_LENGTH = 1024 * 1024;
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

export type SystemArtworkInput = {
  title: string;
  artist: string;
  palette: [string, string];
};

type CanvasFactory = () => HTMLCanvasElement;

function titleInitials(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("") || "C";
}

export function createSystemArtworkDataUrl(
  track: SystemArtworkInput,
  createCanvas: CanvasFactory = () => document.createElement("canvas"),
): string | undefined {
  try {
    const canvas = createCanvas();
    canvas.width = SYSTEM_ARTWORK_SIZE;
    canvas.height = SYSTEM_ARTWORK_SIZE;
    const context = canvas.getContext("2d");
    if (!context) return undefined;

    const background = context.createLinearGradient(
      0,
      0,
      SYSTEM_ARTWORK_SIZE,
      SYSTEM_ARTWORK_SIZE,
    );
    background.addColorStop(0, track.palette[1]);
    background.addColorStop(1, track.palette[0]);
    context.fillStyle = background;
    context.fillRect(0, 0, SYSTEM_ARTWORK_SIZE, SYSTEM_ARTWORK_SIZE);

    context.fillStyle = track.palette[0];
    context.fillRect(54, 72, 186, 10);

    context.fillStyle = "#f7f3e8";
    context.font =
      '600 102px "Segoe UI Variable Display", "Segoe UI", sans-serif';
    context.textBaseline = "top";
    context.fillText(titleInitials(track.title), 54, 144);

    context.font = '700 24px "Segoe UI Variable", "Segoe UI", sans-serif';
    context.fillText(track.artist.trim().toUpperCase(), 54, 552, 492);

    const dataUrl = canvas.toDataURL("image/png");
    if (
      !dataUrl.startsWith(PNG_DATA_URL_PREFIX) ||
      dataUrl.length > MAX_SYSTEM_ARTWORK_DATA_URL_LENGTH
    ) {
      return undefined;
    }
    return dataUrl;
  } catch {
    return undefined;
  }
}
