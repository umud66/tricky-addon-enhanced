# umud66 WebUI enhancements

- In WebUI open **More → Keybox Automation → Boot-state properties**. Select **Auto / Force / Disable** and Save; the selector atomically writes `/data/adb/tricky_store/boot_props_mode`, consumed by TEESimulator-RS on restart. Auto skips OPPO/Oplus; Force can break vendor fingerprint services. This globally changes reported properties, not the actual hardware bootloader lock. Missing ro.boot.* properties are skipped by current TEESimulator code.
- App cards preserve both application label and package identifier. Where KernelSU does not provide `getPackagesInfo`, a lazy on-screen fallback resolves local APK labels via bundled `aapt` and `pm path`, caching labels for seven days. If a label cannot be resolved, the package name stays visible.
- The original minified WebUI bundle is unchanged; enhancements are in readable `webui/enhancements.js` and `webui/app-labels.sh`. Existing customized target autosave, keybox badge and flags are retained.

No Keybox data or persistent keys are modified by this WebUI feature.
