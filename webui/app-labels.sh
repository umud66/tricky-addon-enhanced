#!/system/bin/sh
# UTF-8 TSV application labels fallback for KernelSU WebUI.
abi="$(getprop ro.product.cpu.abi)"
case "$abi" in arm64-v8a|armeabi-v7a|x86|x86_64) ;; *) exit 0 ;; esac
aapt=''
for root in /data/adb/modules/TA_enhanced /data/adb/modules/.TA_enhanced; do
  if [ -x "$root/bin/$abi/aapt" ]; then aapt="$root/bin/$abi/aapt"; break; fi
done
[ -n "$aapt" ] || aapt="$(command -v aapt 2>/dev/null)"
[ -n "$aapt" ] || exit 0
lang="$(getprop persist.sys.locale)"
for pkg in "$@"; do
  case "$pkg" in ''|*[!a-zA-Z0-9._]*) continue ;; esac
  apk="$(pm path "$pkg" 2>/dev/null | sed -n '1s/^package://p')"
  [ -r "$apk" ] || continue
  info="$("$aapt" dump badging "$apk" 2>/dev/null)" || continue
  label=''
  case "$lang" in
    zh*)
      label="$(printf '%s\n' "$info" | sed -n "s/^application-label-zh-CN:'\(.*\)'$/\1/p" | head -n 1)"
      [ -n "$label" ] || label="$(printf '%s\n' "$info" | sed -n "s/^application-label-zh:'\(.*\)'$/\1/p" | head -n 1)"
      ;;
  esac
  [ -n "$label" ] || label="$(printf '%s\n' "$info" | sed -n "s/^application-label:'\(.*\)'$/\1/p" | head -n 1)"
  [ -n "$label" ] || continue
  label="$(printf '%s' "$label" | tr '\t\r\n' '   ')"
  printf '%s\t%s\n' "$pkg" "$label"
done
