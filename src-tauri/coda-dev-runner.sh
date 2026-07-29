#!/bin/sh

set -eu

identity="${CODA_DEV_CODESIGN_IDENTITY:-Coda Local Development}"
signing_identifier="com.coda.bandcamp"
fingerprint_schema="coda-dev-native-fingerprint-v2"
script_directory="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
script_path="$script_directory/$(basename -- "$0")"
fingerprint_script="$script_directory/../tools/dev-instance.mjs"

compute_native_fingerprint() {
  node "$fingerprint_script" native-fingerprint
}

write_native_fingerprint() {
  fingerprint_file="$1"
  native_fingerprint="$2"
  fingerprint_temp="$fingerprint_file.tmp.$$"
  printf '%s\n%s\n' "$fingerprint_schema" "$native_fingerprint" >"$fingerprint_temp"
  mv -f "$fingerprint_temp" "$fingerprint_file"
}

cleanup_signing_replacement() {
  unlink "${signing_executable:-}" 2>/dev/null || true
  unlink "${fingerprint_temp:-}" 2>/dev/null || true
}

exit_after_signal() {
  signal_status="$1"
  trap - HUP INT TERM
  exit "$signal_status"
}

find_signing_identity_hash() {
  security find-identity -v -p codesigning |
    grep -F "\"$identity\"" |
    awk 'NR == 1 { print $2 }'
}

same_native_executable() {
  raw_executable="$1"
  signed_executable="$2"
  probe_directory="$(mktemp -d "${TMPDIR:-/tmp}/coda-dev-bootstrap.XXXXXX")"
  raw_probe="$probe_directory/raw"
  signed_probe="$probe_directory/signed"

  cp "$raw_executable" "$raw_probe"
  cp "$signed_executable" "$signed_probe"
  if ! codesign --remove-signature "$raw_probe" >/dev/null 2>&1 ||
    ! codesign --remove-signature "$signed_probe" >/dev/null 2>&1 ||
    ! codesign \
      --force \
      --sign - \
      --timestamp=none \
      --identifier com.coda.bandcamp.bootstrap-probe \
      "$raw_probe" >/dev/null 2>&1 ||
    ! codesign \
      --force \
      --sign - \
      --timestamp=none \
      --identifier com.coda.bandcamp.bootstrap-probe \
      "$signed_probe" >/dev/null 2>&1; then
    unlink "$raw_probe" 2>/dev/null || true
    unlink "$signed_probe" 2>/dev/null || true
    rmdir "$probe_directory" 2>/dev/null || true
    return 1
  fi

  if cmp -s "$raw_probe" "$signed_probe"; then
    matches=true
  else
    matches=false
  fi
  unlink "$raw_probe"
  unlink "$signed_probe"
  rmdir "$probe_directory"
  "$matches"
}

if [ "${1:-}" = "run" ]; then
  if [ -n "${CODA_DEV_EXECUTABLE_SLUG:-}" ]; then
    CODA_DEV_NATIVE_FINGERPRINT="$(compute_native_fingerprint)"
    if ! printf '%s\n' "$CODA_DEV_NATIVE_FINGERPRINT" | grep -Eq '^[0-9a-f]{64}$'; then
      printf 'Coda could not determine a safe native development fingerprint.\n' >&2
      exit 1
    fi
    export CODA_DEV_NATIVE_FINGERPRINT
    executable_slug="$CODA_DEV_EXECUTABLE_SLUG"
    if ! printf '%s\n' "$executable_slug" | grep -Eq '^[a-z0-9]+(-[a-z0-9]+)*$'; then
      printf 'Coda received an invalid development executable slug "%s".\n' "$executable_slug" >&2
      exit 1
    fi
  fi
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
    executable_slug="${CODA_DEV_EXECUTABLE_SLUG:-}"
    native_fingerprint="${CODA_DEV_NATIVE_FINGERPRINT:-}"
    if [ -n "$executable_slug" ]; then
      if ! printf '%s\n' "$executable_slug" | grep -Eq '^[a-z0-9]+(-[a-z0-9]+)*$'; then
        printf 'Coda received an invalid development executable slug "%s".\n' "$executable_slug" >&2
        exit 1
      fi
      if ! printf '%s\n' "$native_fingerprint" | grep -Eq '^[0-9a-f]{64}$'; then
        native_fingerprint="$(compute_native_fingerprint)"
        if ! printf '%s\n' "$native_fingerprint" | grep -Eq '^[0-9a-f]{64}$'; then
          printf 'Coda could not determine a safe native development fingerprint.\n' >&2
          exit 1
        fi
      fi
      instance_executable="$(dirname -- "$executable")/coda-$executable_slug"
    fi
    identity_hash="$(find_signing_identity_hash)"

    if ! printf '%s\n' "$identity_hash" | grep -Eq '^[0-9A-F]{40}$'; then
      printf 'Coda could not find the macOS code-signing identity "%s".\n' "$identity" >&2
      exit 1
    fi

    code_requirement="=identifier \"$signing_identifier\" and certificate leaf = H\"$identity_hash\""
    if [ -n "$executable_slug" ]; then
      fingerprint_file="$instance_executable.native-fingerprint"
      cached_schema=""
      cached_fingerprint=""
      if [ -f "$fingerprint_file" ]; then
        cached_schema="$(sed -n '1p' "$fingerprint_file")"
        cached_fingerprint="$(sed -n '2p' "$fingerprint_file")"
      fi

      if [ "$cached_schema" = "$fingerprint_schema" ] &&
        [ "$cached_fingerprint" = "$native_fingerprint" ] &&
        codesign --verify --strict -R "$code_requirement" "$instance_executable"; then
        exec "$instance_executable" "$@"
      fi

      if {
        [ ! -e "$fingerprint_file" ] ||
          {
            printf '%s\n' "$cached_schema" | grep -Eq '^[0-9a-f]{64}$' &&
              [ -z "$cached_fingerprint" ]
          }
      } &&
        [ -x "$instance_executable" ] &&
        codesign --verify --strict -R "$code_requirement" "$instance_executable" &&
        same_native_executable "$executable" "$instance_executable"; then
        write_native_fingerprint "$fingerprint_file" "$native_fingerprint"
        exec "$instance_executable" "$@"
      fi

      signing_executable="$instance_executable.signing.$$"
      fingerprint_temp="$fingerprint_file.tmp.$$"
      trap cleanup_signing_replacement EXIT
      trap 'exit_after_signal 129' HUP
      trap 'exit_after_signal 130' INT
      trap 'exit_after_signal 143' TERM
      cp "$executable" "$signing_executable"
      codesign \
        --force \
        --sign "$identity_hash" \
        --timestamp=none \
        --identifier "$signing_identifier" \
        "$signing_executable"
      codesign --verify --strict -R "$code_requirement" "$signing_executable"
      printf '%s\n%s\n' \
        "$fingerprint_schema" \
        "$native_fingerprint" >"$fingerprint_temp"
      unlink "$fingerprint_file" 2>/dev/null || true
      mv -f "$signing_executable" "$instance_executable"
      mv -f "$fingerprint_temp" "$fingerprint_file"
      trap - HUP INT TERM
      trap - EXIT
      executable="$instance_executable"
    else
      codesign \
        --force \
        --sign "$identity_hash" \
        --timestamp=none \
        --identifier "$signing_identifier" \
        "$executable"
      codesign --verify --strict -R "$code_requirement" "$executable"
    fi

    exec "$executable" "$@"
    ;;
  *)
    exec cargo "$@"
    ;;
esac
