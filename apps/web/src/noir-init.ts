import initAcvm from "@noir-lang/acvm_js";
import initNoircAbi from "@noir-lang/noirc_abi";
import acvmWasmUrl from "@noir-lang/acvm_js/web/acvm_js_bg.wasm?url";
import noircAbiWasmUrl from "@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm?url";

let ready: Promise<void> | undefined;

/** Load Noir witness WASM with explicit URLs (Vite cannot resolve import.meta.url in deps). */
export async function ensureNoirWasm(): Promise<void> {
  if (!ready) {
    ready = Promise.all([
      initAcvm({ module_or_path: acvmWasmUrl }),
      initNoircAbi({ module_or_path: noircAbiWasmUrl }),
    ]).then(() => undefined);
  }
  return ready;
}
