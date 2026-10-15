#!/system/bin/sh
# TA Enhanced Diag4: asynchronous manual keybox fetch worker.
# No downloaded key content appears in stdout/logs. Temp files are mode 0600.
# Does not modify Rust backend or automatic-fetch settings.
umask 077
PATH=/data/adb/magisk:/data/adb/ksu/bin:/data/adb/ap/bin:/system/bin:/system/xbin:$PATH
MODDIR="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)" || exit 2
BASE=/data/adb/tricky_store/ta-enhanced/proxy-fetch
URL_YURIKEY='https://raw.githubusercontent.com/Yurii0307/yurikey/main/key'
URL_UPSTREAM='https://raw.githubusercontent.com/KOWX712/Tricky-Addon-Update-Target-List/keybox/.extra'
URL_DAREDEVIL='https://raw.githubusercontent.com/dare-devil-ex/keyboxxBot/main/keybox.xml'
URL_MEOWDUMP='https://raw.githubusercontent.com/MeowDump/MeowDump/refs/heads/main/Megatron'
mkdir -p "$BASE/jobs" || { echo '无法创建任务目录'; exit 2; }
chmod 700 "$BASE" "$BASE/jobs" 2>/dev/null

fail_input() { echo "参数错误：$1"; exit 2; }
valid_prefix() {
    [ -n "$1" ] || return 1
    [ "${#1}" -le 200 ] || return 1
    case "$1" in https://*) ;; *) return 1 ;; esac
    # Forbid username/password, query, fragment, shell metacharacters and whitespace.
    case "$1" in *[!a-zA-Z0-9._~:/%+-]*|*'//'/*|*'..'* ) return 1 ;; esac
    # URL may contain a path to a reverse-proxy base route.
    host=${1#https://}; host=${host%%/*}
    [ -n "$host" ] || return 1
    case "$host" in *.*|*:*|localhost) ;; *) return 1 ;; esac
    return 0
}
settings() {
    MODE=direct
    PREFIX=https://gh-proxy.org/
    SELECTED=auto
    if [ -f "$BASE/settings" ]; then
        read -r MODE < "$BASE/settings" || true
        PREFIX=$(sed -n '2p' "$BASE/settings")
        SELECTED=$(sed -n '3p' "$BASE/settings")
        case "$MODE" in direct|proxy|multi) ;; *) MODE=direct ;; esac
        case "$SELECTED" in auto|yurikey|upstream|daredevil|meowdump) ;; *) SELECTED=auto ;; esac
        valid_prefix "$PREFIX" || PREFIX=https://gh-proxy.org/
    fi
}
write_state() {
    # state|source|stage|message (message must not contain raw private key data)
    printf '%s|%s|%s|%s\n' "$1" "$2" "$3" "$4" > "$JOB/state.next" && mv -f "$JOB/state.next" "$JOB/state"
}
log_error() {
    # Truncate logging; print errors, never the decoded keybox or response body.
    [ -f "$JOB/error" ] || return 0
    sed -n '1,8p' "$JOB/error" | cut -c1-240 >> "$JOB/log"
}
abi_binary() {
    case "$(uname -m)" in
        aarch64) ABI=arm64-v8a ;;
        armv7*|armv8l) ABI=armeabi-v7a ;;
        x86_64) ABI=x86_64 ;;
        i?86) ABI=x86 ;;
        *) return 1 ;;
    esac
    BIN="$MODDIR/bin/$ABI/ta-enhanced"
    COMPAT="$MODDIR/bin/$ABI/ta-key-compat"
    [ -x "$BIN" ]
}
get_source_name() { case "$1" in yurikey) echo Yurikey ;; upstream) echo KOWX712 ;; daredevil) echo DareDevilEx ;; meowdump) echo MeowDump ;; *) echo "$1" ;; esac; }
fetch_download() {
    URL="$1"; DEST="$2"
    : > "$JOB/error"
    printf '?\n' > "$JOB/http-code"
    if command -v curl >/dev/null 2>&1; then
        # curl -f is important: HTTP 404 and 5xx must never reach the XML parser.
        curl -fLsS --connect-timeout 8 --max-time 35 --retry 0 \
            --proto '=https' --proto-redir '=https' \
            --write-out '%{http_code}\n' -o "$DEST" "$URL" > "$JOB/http-code" 2> "$JOB/error"
        return $?
    fi
    if command -v wget >/dev/null 2>&1; then
        wget -q -T 35 -O "$DEST" "$URL" 2> "$JOB/error"
        return $?
    fi
    if command -v busybox >/dev/null 2>&1 && busybox --list 2>/dev/null | grep -qx wget; then
        busybox wget -q -T 35 -O "$DEST" "$URL" 2> "$JOB/error"
        return $?
    fi
    echo '缺少 curl / wget / BusyBox wget。请安装下载工具或选择原生直连。' > "$JOB/error"
    return 127
}
decode_file() {
    SRC="$1"; F="$2"; OUT="$3"
    : > "$JOB/error"
    if [ ! -x "$COMPAT" ]; then
        echo '缺少当前架构的 ta-key-compat 解码/兼容工具' > "$JOB/error"
        return 127
    fi
    "$COMPAT" decode "$SRC" "$F" "$OUT" > "$JOB/tmp/decode-result" 2> "$JOB/error"
}
normalize_file() {
    # Never weaken chain verification. Normalize only EC SEC1 and RSA PKCS#1 PEM encoding.
    : > "$JOB/error"
    "$COMPAT" normalize - "$JOB/tmp/keybox.xml" "$JOB/tmp/normalized.xml" \
        > "$JOB/tmp/normalize-result" 2> "$JOB/error" || return $?
    [ -s "$JOB/tmp/normalized.xml" ] || return 1
    mv -f "$JOB/tmp/normalized.xml" "$JOB/tmp/keybox.xml" || return 1
    if grep -q '^converted=[1-9]' "$JOB/tmp/normalize-result"; then
        echo 'compat: legacy EC/RSA PEM -> equivalent PKCS#8 (certificates unchanged)' >> "$JOB/log"
    fi
}
try_source() {
    SOURCE="$1"; LABEL=$(get_source_name "$SOURCE")
    case "$SOURCE" in yurikey) RAW="$URL_YURIKEY" ;; upstream) RAW="$URL_UPSTREAM" ;; daredevil) RAW="$URL_DAREDEVIL" ;; meowdump) RAW="$URL_MEOWDUMP" ;; *) return 1 ;; esac
    if [ "$MODE" = proxy ]; then URL="${PREFIX%/}/$RAW"; else URL="$RAW"; fi
    write_state running "$LABEL" 下载 "正在连接${MODE}源（单次最长 35 秒）"
    : > "$JOB/tmp/download"; : > "$JOB/tmp/keybox.xml"
    if ! fetch_download "$URL" "$JOB/tmp/download"; then
        http=$(cat "$JOB/http-code" 2>/dev/null)
        echo "keybox source $SOURCE failed: download failed (HTTP ${http:-?})" >> "$JOB/log"; log_error
        return 1
    fi
    bytes=$(wc -c < "$JOB/tmp/download" | tr -d ' ')
    if [ "$bytes" -le 0 ] || [ "$bytes" -gt 4194304 ]; then
        http=$(cat "$JOB/http-code" 2>/dev/null)
        echo "keybox source $SOURCE failed: HTTP ${http:-?}; 响应为空或过大（${bytes}B）" >> "$JOB/log"
        return 1
    fi
    http=$(cat "$JOB/http-code" 2>/dev/null)
    write_state running "$LABEL" 解码 "HTTP ${http:-?}; 下载 ${bytes} 字节，正在解码数据"
    if ! decode_file "$SOURCE" "$JOB/tmp/download" "$JOB/tmp/keybox.xml"; then
        echo "keybox source $SOURCE failed: base64/hex decode failed" >> "$JOB/log"; log_error
        return 1
    fi
    decoded_bytes=$(wc -c < "$JOB/tmp/keybox.xml" | tr -d ' ')
    if [ "$decoded_bytes" -le 20 ] || [ "$decoded_bytes" -gt 1048576 ]; then
        echo "keybox from $SOURCE parse failed: 解码文件大小异常（${decoded_bytes}B）" >> "$JOB/log"
        return 1
    fi
    write_state running "$LABEL" 格式兼容 '正在转换传统 EC/RSA PEM（不修改证书）'
    if ! normalize_file; then
        echo "keybox from $SOURCE rejected: legacy key encoding normalization failed" >> "$JOB/log"; log_error
        return 1
    fi
    write_state running "$LABEL" 校验 '使用原版 Rust 后端校验证书链、私钥匹配和吊销状态' 
    if ! RUST_LOG=info "$BIN" keybox validate "$JOB/tmp/keybox.xml" > "$JOB/tmp/validate-output" 2> "$JOB/error"; then
        if grep -Eqi 'keybox XML parse failed|not valid UTF-8|no <Keybox>|no <Key>|parse error' "$JOB/error"; then
            echo "keybox from $SOURCE parse failed: invalid XML / UTF-8" >> "$JOB/log"
        else
            echo "keybox from $SOURCE rejected: certificate/key validation failed" >> "$JOB/log"
        fi
        log_error
        if grep -q 'chain verification failed' "$JOB/tmp/validate-output"; then
            echo 'certificate validation stage: certificate chain signature/issuer mismatch (NOT an XML parse failure)' >> "$JOB/log"
        fi
        if grep -q 'private key present but unparseable' "$JOB/tmp/validate-output"; then
            echo 'certificate validation stage: private-key parsing failed even after legacy PEM normalization' >> "$JOB/log"
        fi
        # Only report validation error strings (never log downloaded XML or private keys).
        awk '/"errors"[[:space:]]*:[[:space:]]*\[/ { inside=1; next }
             inside && /\]/ { inside=0; next }
             inside && /"/ {
                gsub(/^[[:space:]]*"/, ""); gsub(/",?[[:space:]]*$/, "");
                if (length($0) < 300) print "certificate validation detail: " $0
             }' "$JOB/tmp/validate-output" | head -n 8 >> "$JOB/log"
        return 1
    fi
    # Avoid rewriting/rotating backups when the downloaded content is identical.
    if [ -f /data/adb/tricky_store/keybox.xml ] && cmp -s "$JOB/tmp/keybox.xml" /data/adb/tricky_store/keybox.xml; then
        echo "keybox fetched from $SOURCE (identical; no rewrite)" >> "$JOB/log"
        write_state success "$LABEL" 完成 '与已安装密钥一致，未进行写入或备份轮换'
        return 0
    fi
    write_state running "$LABEL" 安装 '已通过校验，正在备份并写入新密钥'
    if ! RUST_LOG=info "$BIN" keybox set-custom "$JOB/tmp/keybox.xml" > "$JOB/tmp/install-output" 2> "$JOB/error"; then
        echo "keybox source $SOURCE failed: install failed (backup/write)" >> "$JOB/log"; log_error
        # Installing failed: do not try another keybox (preserve previous backup/state).
        write_state failed "$LABEL" 安装 '写入/备份失败，停止重试；详情见错误日志'
        return 2
    fi
    echo "keybox fetched from $SOURCE (proxy helper)" >> "$JOB/log"
    write_state success "$LABEL" 完成 '校验通过，原版后端已完成安装'
    return 0
}
worker() {
    JOB="$BASE/jobs/$1"
    [ -d "$JOB" ] || exit 2
    MODE=$(sed -n '1p' "$JOB/request")
    PREFIX=$(sed -n '2p' "$JOB/request")
    SOURCE=$(sed -n '3p' "$JOB/request")
    case "$SOURCE" in auto|yurikey|upstream|daredevil|meowdump) ;; *) SOURCE=auto ;; esac
    chmod 700 "$JOB" 2>/dev/null
    mkdir -p "$JOB/tmp" || exit 3
    chmod 700 "$JOB/tmp" 2>/dev/null
    trap 'rm -rf "$JOB/tmp"; rm -f "$BASE/busy/job" "$BASE/busy/pid"; rmdir "$BASE/busy" 2>/dev/null' EXIT
    if ! abi_binary; then
        echo 'Error: 找不到适合当前架构的 ta-enhanced 程序' >> "$JOB/log"
        write_state failed 无 初始化 '未找到 Rust 后端'
        exit 1
    fi
    if [ "$MODE" = direct ] && [ "$SOURCE" = auto ]; then
        write_state running 原生直连 下载 '已在独立后台进程启动原版 keybox fetch'
        if RUST_LOG=info "$BIN" keybox fetch > "$JOB/tmp/rust-stdout" 2> "$JOB/error"; then
            sed -n '1,45p' "$JOB/error" >> "$JOB/log"
            sed -n '1,12p' "$JOB/tmp/rust-stdout" >> "$JOB/log"
            if grep -q 'keybox fetched from existing' "$JOB/tmp/rust-stdout"; then
                write_state kept 原生直连 回退 '远程获取失败，原版程序保留已有密钥'
            else
                write_state success 原生直连 完成 '原版后端返回成功'
            fi
        else
            sed -n '1,45p' "$JOB/error" >> "$JOB/log"
            write_state failed 原生直连 下载/校验/安装 '原版后端返回失败；查看详细日志确定步骤'
        fi
        exit 0
    fi
    if [ "$MODE" = proxy ]; then
        valid_prefix "$PREFIX" || { write_state failed 代理 配置 '前置代理地址不符合 HTTPS 规则'; exit 1; }
    fi
    # Every downloader run is strictly sequential. Selected source is first;
    # all remaining sources are tried only on download/decode/validation failures.
    if [ "$SOURCE" = auto ]; then
        ORDER='yurikey upstream daredevil meowdump'
    else
        ORDER="$SOURCE"
        for candidate in yurikey upstream daredevil meowdump; do
            [ "$candidate" = "$SOURCE" ] || ORDER="$ORDER $candidate"
        done
    fi
    total=4
    attempt=0
    for candidate in $ORDER; do
        attempt=$((attempt + 1))
        write_state running "$(get_source_name "$candidate")" "来源 $attempt/$total" '正在准备下一来源；此前失败不会覆盖现有密钥'
        try_source "$candidate"; RC=$?
        if [ "$RC" -eq 0 ] || [ "$RC" -eq 2 ]; then exit 0; fi
    done
    write_state failed 全部来源 获取 '四个来源均失败，现有 keybox.xml 未修改'
    echo 'Error: all 4 keybox sources failed (multi-source fetch)' >> "$JOB/log"

}
case "$1" in
    load)
        settings
        printf '%s\n%s\n%s\n' "$MODE" "$PREFIX" "$SELECTED"
        ;;
    save)
        case "$2" in direct|proxy|multi) ;; *) fail_input '模式必须是 direct / proxy / multi' ;; esac
        case "$4" in auto|yurikey|upstream|daredevil|meowdump) ;; *) fail_input '密钥源无效' ;; esac
        valid_prefix "$3" || fail_input '代理前缀必须是 HTTPS URL（例如 https://gh-proxy.org/）'
        printf '%s\n%s\n%s\n' "$2" "${3%/}/" "$4" > "$BASE/settings.tmp.$$" || exit 1
        mv -f "$BASE/settings.tmp.$$" "$BASE/settings" || exit 1
        printf 'SAVED\n'
        ;;
    start)
        case "$2" in auto|yurikey|upstream|daredevil|meowdump) ;; *) fail_input '未知密钥源' ;; esac
        settings
        # A previous worker may have been force-killed; release only a stale lock.
        if [ -d "$BASE/busy" ]; then
            old_pid=$(cat "$BASE/busy/pid" 2>/dev/null)
            case "$old_pid" in *[!0-9]*|'') old_pid='' ;; esac
            if [ -n "$old_pid" ] && ! kill -0 "$old_pid" 2>/dev/null; then
                old_job=$(cat "$BASE/busy/job" 2>/dev/null)
                case "$old_job" in *[!0-9-]*|'') old_job='' ;; esac
                if [ -n "$old_job" ] && [ -f "$BASE/jobs/$old_job/state" ]; then
                    JOB="$BASE/jobs/$old_job"
                    state=$(sed -n '1p' "$JOB/state")
                    case "$state" in running'|'*) write_state failed 后台 异常 '前一个下载任务意外退出' ;; esac
                fi
                rm -f "$BASE/busy/pid" "$BASE/busy/job"
                rmdir "$BASE/busy" 2>/dev/null || true
            fi
        fi
        if ! mkdir "$BASE/busy" 2>/dev/null; then
            # Never spawn duplicate concurrent keybox updates.
            echo "BUSY:$(cat "$BASE/busy/job" 2>/dev/null)"
            exit 3
        fi
        id="$(date +%s)-$$"
        JOB="$BASE/jobs/$id"
        if ! mkdir "$JOB" 2>/dev/null; then rmdir "$BASE/busy"; exit 4; fi
        printf '%s\n%s\n%s\n' "$MODE" "$PREFIX" "$2" > "$JOB/request"
        : > "$JOB/log"
        write_state running 初始化 启动 '正在创建后台下载任务'
        printf '%s\n' "$id" > "$BASE/busy/job"
        sh "$0" worker "$id" </dev/null >/dev/null 2>&1 &
        printf '%s\n' "$!" > "$BASE/busy/pid"
        printf 'STARTED:%s\n' "$id"
        ;;
    worker)
        case "$2" in *[!0-9-]*|'') exit 2 ;; esac
        worker "$2"
        ;;
    status)
        case "$2" in *[!0-9-]*|'') fail_input '任务 ID 不合法' ;; esac
        JOB="$BASE/jobs/$2"
        [ -f "$JOB/state" ] || { echo 'MISSING|无|查询|任务不存在'; exit 4; }
        cat "$JOB/state"
        printf '__LOG_START__\n'
        tail -n 55 "$JOB/log" 2>/dev/null | cut -c1-250
        ;;
    current)
        [ -r "$BASE/busy/job" ] && cat "$BASE/busy/job"
        ;;
    *) echo 'usage: load|save MODE PREFIX SOURCE|start SOURCE|status ID|current'; exit 2 ;;
esac