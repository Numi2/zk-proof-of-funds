import * as wasm from "./zkpf_wasm_bg.wasm";
export * from "./zkpf_wasm_bg.js";
import { __wbg_set_wasm } from "./zkpf_wasm_bg.js";
__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
