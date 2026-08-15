#!/usr/bin/env python3
"""Extract cropped frame evidence for manual transition inspection.

Pixel activity is not proof of a shared-element morph. This script requires a
crop, writes activity diagnostics, and produces a contact sheet. A reviewer
must see the shared element between its start and end positions before calling
the transition verified.
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

WIDTH = 160
HEIGHT = 90
FPS = 20
FRAME = WIDTH * HEIGHT
TILE = 16
MOTION_MAD = 4.0


def parse_crop(value: str) -> tuple[int, int, int, int]:
    try:
        x, y, width, height = (int(part) for part in value.split(":"))
    except ValueError as cause:
        raise argparse.ArgumentTypeError(
            "crop must be x:y:width:height in source pixels"
        ) from cause
    if min(x, y) < 0 or min(width, height) <= 0:
        raise argparse.ArgumentTypeError(
            "crop offsets must be non-negative and dimensions positive"
        )
    return x, y, width, height


def video_filter(crop: tuple[int, int, int, int], suffix: str) -> str:
    x, y, width, height = crop
    return f"crop={width}:{height}:{x}:{y},{suffix}"


def extract_gray(
    path: Path,
    crop: tuple[int, int, int, int],
    start: float,
    duration: float,
) -> bytes:
    result = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-ss",
            str(start),
            "-t",
            str(duration),
            "-i",
            str(path),
            "-vf",
            video_filter(
                crop,
                f"fps={FPS},scale={WIDTH}:{HEIGHT},format=gray",
            ),
            "-f",
            "rawvideo",
            "-",
        ],
        check=True,
        stdout=subprocess.PIPE,
    )
    return result.stdout


def write_contact_sheet(
    path: Path,
    output: Path,
    crop: tuple[int, int, int, int],
    start: float,
    duration: float,
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-ss",
            str(start),
            "-t",
            str(duration),
            "-i",
            str(path),
            "-vf",
            video_filter(
                crop,
                "fps=20,scale=320:-1,tile=5x4:padding=4:margin=4",
            ),
            "-frames:v",
            "1",
            str(output),
        ],
        check=True,
    )


def tile_max_mad(left: bytes, right: bytes) -> float:
    best = 0.0
    for top in range(0, HEIGHT, TILE):
        for left_x in range(0, WIDTH, TILE):
            total = 0
            count = 0
            for row in range(top, min(top + TILE, HEIGHT)):
                offset = row * WIDTH
                for column in range(left_x, min(left_x + TILE, WIDTH)):
                    index = offset + column
                    total += abs(left[index] - right[index])
                    count += 1
            if count == 0:
                continue
            mad = total / count
            if mad > best:
                best = mad
    return best


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("--crop", required=True, type=parse_crop)
    parser.add_argument("--start", required=True, type=float)
    parser.add_argument("--duration", required=True, type=float)
    parser.add_argument("--contact-sheet", required=True, type=Path)
    parser.add_argument("--tsv", required=True, type=Path)
    args = parser.parse_args()
    if args.start < 0 or args.duration <= 0:
        parser.error("start must be non-negative and duration must be positive")
    data = extract_gray(args.video, args.crop, args.start, args.duration)
    count = len(data) // FRAME
    if count < 2:
        parser.error("selected window contains fewer than two frames")
    write_contact_sheet(
        args.video,
        args.contact_sheet,
        args.crop,
        args.start,
        args.duration,
    )
    if len(data) % FRAME != 0:
        parser.error("ffmpeg returned an incomplete grayscale frame")
    mads: list[float] = []
    previous = data[0:FRAME]
    for index in range(1, count):
        current = data[index * FRAME : (index + 1) * FRAME]
        mads.append(tile_max_mad(previous, current))
        previous = current
    peak = max(mads)
    active = sum(value >= MOTION_MAD for value in mads)
    print(
        f"video={args.video} crop={args.crop} start={args.start:.3f} "
        f"duration={args.duration:.3f} frames={count} peak_mad={peak:.2f} "
        f"active_diffs={active} verdict=REQUIRES_VISUAL_INSPECTION "
        f"contact_sheet={args.contact_sheet}"
    )
    args.tsv.parent.mkdir(parents=True, exist_ok=True)
    with args.tsv.open("w", encoding="utf-8") as handle:
        handle.write("frame\ttime_seconds\tmax_tile_mad\tactive\n")
        for index, value in enumerate(mads, start=1):
            time_seconds = args.start + index / FPS
            handle.write(
                f"{index}\t{time_seconds:.4f}\t{value:.4f}\t"
                f"{int(value >= MOTION_MAD)}\n"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
