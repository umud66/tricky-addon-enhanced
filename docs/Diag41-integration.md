# Diag4.1 manual keybox integration — v5.53.3

This fork integrates the user-provided **TA_enhanced-v5.53.1-Diag4.1-AppSaveFix.zip** into the previously customized v5.53.2 WebUI. Original diagnostics, async progress, manual source precedence and HTTPS proxy configuration are retained. Existing boot_props_mode controls, localized app-label fallback and target auto-save are preserved.

## Features and boundaries

- **Manual fetch only:** direct/auto retains the original Rust two-source fetch; multi and proxy use a background shell worker that tests Yurikey, KOWX712, DareDevilEx and MeowDump in priority order. The daemon's scheduled automatic fetch still uses the unchanged Rust sources.
- The worker downloads to restricted temporary storage; decodes Base64, hex→Base64 and MeowDump's 10×Base64→hex→ROT13; normalizes legacy SEC1 EC / PKCS#1 RSA PEM to semantically equivalent PKCS#8; calls the original `ta-enhanced keybox validate`; then calls `keybox set-custom` **only after verification succeeds**.
- `common/keybox-proxy-fetch.sh` controls settings, background jobs, polling, diagnostics and installation; WebUI uses `webui/assets/keybox-proxy-ui.js` and `keybox-diagnostics.js`. No downloaded private key is returned to JavaScript or printed into logs.
- `tools/ta-key-compat` is a new Go stdlib-only source implementation of the uploaded ZIP's binary interface. CI compiles four ABIs and includes the binaries in the flashable ZIP. Go tests cover four decoders, PEM EC normalization, idempotence and non-XML rejection. **Actual 32-bit Android execution has not been verified.**
- Requirements: a working curl, wget or busybox wget; module installed with its Rust CLI binary. Use a trusted HTTPS prefix. The keybox and certificate chain must pass the original Rust validator regardless of the selected source.

## Recovery / diagnostics

- UI: More → Keybox Automation → Manual keybox download, choose source and mode → Save → Fetch Key.
- Config file: `/data/adb/tricky_store/ta-enhanced/proxy-fetch/settings`.
- Job state: `/data/adb/tricky_store/ta-enhanced/proxy-fetch/jobs/` (temporary private materials are cleaned at end).
- Debug probe (read-only): `sh /data/adb/modules/TA_enhanced/common/keybox-netdiag.sh`.
- This feature does not fix invalid certificates, revoked roots, inaccessible servers or Android KeyMint/TEE issues. Do not share plaintext private-key XML when reporting errors.
