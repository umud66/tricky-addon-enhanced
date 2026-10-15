#!/system/bin/sh
# Read-only extra probe for built-in *public* keybox endpoints.
# No keyboxes are installed, written, copied or printed by this script.
PATH="/data/adb/magisk:/data/adb/ksu/bin:/data/adb/ap/bin:/system/bin:/system/xbin:$PATH"
probe() {
    label="$1"
    url="$2"
    if command -v curl >/dev/null 2>&1; then
        # HTTP HEAD only; emit HTTP status or curl TLS/DNS/network error.
        res="$(curl -I -L -sS --connect-timeout 6 --max-time 15 -o /dev/null -w 'HTTP:%{http_code}' "$url" 2>&1)"
        rc=$?
        printf '%s / curl / exit=%s / %s\n' "$label" "$rc" "$res"
    elif command -v busybox >/dev/null 2>&1 && busybox --list 2>/dev/null | grep -qx wget; then
        # BusyBox wget outputs headers/errors to stderr. Response body is discarded.
        res="$(busybox wget -S -T 12 -O /dev/null "$url" 2>&1)"
        rc=$?
        last="$(printf '%s\n' "$res" | grep -Ei 'HTTP/|server returned|error|unable|fail|bad address|connection|certificate' | tail -n 5)"
        [ -n "$last" ] || last='无可用 HTTP 错误细节'
        printf '%s / busybox wget / exit=%s / %s\n' "$label" "$rc" "$last"
    else
        printf '%s / 未找到 curl 或 BusyBox wget；跳过 HTTP 复测\n' "$label"
    fi
}
probe 'Yurikey' 'https://raw.githubusercontent.com/Yurii0307/yurikey/main/key'
probe 'KOWX712' 'https://raw.githubusercontent.com/KOWX712/Tricky-Addon-Update-Target-List/keybox/.extra'