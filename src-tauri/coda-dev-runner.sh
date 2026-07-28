#!/bin/sh

set -eu

identity="${CODA_DEV_CODESIGN_IDENTITY:-Coda Local Development}"

if [ "${1:-}" = "run" ]; then
  script_path="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/$(basename -- "$0")"
  runner_json="$(node -e 'process.stdout.write(JSON.stringify([process.argv[1]]))' "$script_path")"

  exec cargo \
    --config "target.aarch64-apple-darwin.runner=$runner_json" \
    --config "target.x86_64-apple-darwin.runner=$runner_json" \
    "$@"
fi

case "${1:-}" in
  */coda)
    executable="$1"
    shift
    instance_slug="${CODA_DEV_INSTANCE_SLUG:-}"
    if [ -n "$instance_slug" ]; then
      if ! printf '%s\n' "$instance_slug" | grep -Eq '^[a-z0-9]+(-[a-z0-9]+)*$'; then
        printf 'Coda received an invalid development instance slug "%s".\n' "$instance_slug" >&2
        exit 1
      fi
      instance_executable="$(dirname -- "$executable")/coda-$instance_slug"
      cp -f "$executable" "$instance_executable"
      executable="$instance_executable"
    fi
    identity_hash="$(
      security find-identity -v -p codesigning |
        grep -F "\"$identity\"" |
        awk 'NR == 1 { print $2 }'
    )"

    if ! printf '%s\n' "$identity_hash" | grep -Eq '^[0-9A-F]{40}$'; then
      printf 'Coda could not find the macOS code-signing identity "%s".\n' "$identity" >&2
      exit 1
    fi

    codesign \
      --force \
      --sign "$identity_hash" \
      --timestamp=none \
      --identifier com.coda.bandcamp.dev \
      "$executable"
    codesign --verify --strict "$executable"
    exec "$executable" "$@"
    ;;
  *)
    exec cargo "$@"
    ;;
esac
