/* @ts-self-types="./rcompat_wasm.d.ts" */

export class WasmDeckOpt {
    static __wrap(ptr) {
        const obj = Object.create(WasmDeckOpt.prototype);
        obj.__wbg_ptr = ptr;
        WasmDeckOptFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmDeckOptFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmdeckopt_free(ptr, 0);
    }
    /**
     * @param {number} n
     * @param {number} k2
     * @param {Float64Array | number[]} e
     * @returns {WasmDeckOpt}
     */
    static prepare(n, k2, e) {
        const val2 = +n;
        const val3 = +k2;
        const ptr0 = passArrayF64ToWasm0(e, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmdeckopt_prepare(val2, val3, ptr0, len0);
        return WasmDeckOpt.__wrap(ret);
    }
    /**
     * @param {Float64Array | number[]} l
     * @param {Int32Array | number[]} cost
     * @param {Uint8Array | number[]} leg
     * @param {Uint8Array | number[]} ok
     * @param {number} cap
     * @param {number} top
     * @param {number} starts
     * @param {Uint32Array | number[]} seeds_flat
     * @returns {string}
     */
    solve(l, cost, leg, ok, cap, top, starts, seeds_flat) {
        let deferred9_0;
        let deferred9_1;
        try {
            const val6 = +cap;
            const val7 = +top;
            const val8 = +starts;
            let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4;
            try {
                ptr0 = passArrayF64ToWasm0(l, wasm.__wbindgen_malloc);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passArray32ToWasm0(cost, wasm.__wbindgen_malloc);
                len1 = WASM_VECTOR_LEN;
                ptr2 = passArray8ToWasm0(leg, wasm.__wbindgen_malloc);
                len2 = WASM_VECTOR_LEN;
                ptr3 = passArray8ToWasm0(ok, wasm.__wbindgen_malloc);
                len3 = WASM_VECTOR_LEN;
                ptr4 = passArray32ToWasm0(seeds_flat, wasm.__wbindgen_malloc);
                len4 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr4) { wasm.__wbindgen_free(ptr4, len4 * 4, 4); }
                if (ptr3) { wasm.__wbindgen_free(ptr3, len3 * 1, 1); }
                if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
                if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 4, 4); }
                if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 8, 8); }
                throw e;
            }
            const ret = wasm.wasmdeckopt_solve(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, val6, val7, val8, ptr4, len4);
            deferred9_0 = ret[0];
            deferred9_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred9_0, deferred9_1, 1);
        }
    }
}
if (Symbol.dispose) WasmDeckOpt.prototype[Symbol.dispose] = WasmDeckOpt.prototype.free;

export class WasmSetScorer {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmSetScorerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmsetscorer_free(ptr, 0);
    }
    /**
     * @returns {Float64Array}
     */
    eval_all() {
        const ret = wasm.wasmsetscorer_eval_all(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Int32Array | number[]} deck_flat
     * @returns {number}
     */
    eval_deck(deck_flat) {
        const ptr0 = passArray32ToWasm0(deck_flat, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsetscorer_eval_deck(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * @param {Int32Array | number[]} fixed_flat
     * @param {number} present_mask
     * @param {number} me
     */
    constructor(fixed_flat, present_mask, me) {
        const val2 = +present_mask;
        const val3 = +me;
        const ptr0 = passArray32ToWasm0(fixed_flat, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsetscorer_new(ptr0, len0, val2, val3);
        this.__wbg_ptr = ret;
        WasmSetScorerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) WasmSetScorer.prototype[Symbol.dispose] = WasmSetScorer.prototype.free;

export class WasmSetSearch {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmSetSearchFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmsetsearch_free(ptr, 0);
    }
    /**
     * @param {Int32Array | number[]} ids
     * @returns {number}
     */
    eval_deck(ids) {
        const ptr0 = passArray32ToWasm0(ids, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsetsearch_eval_deck(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * @param {number} batch
     * @returns {boolean}
     */
    eval_init_step(batch) {
        const ret = wasm.wasmsetsearch_eval_init_step(this.__wbg_ptr, batch);
        return ret !== 0;
    }
    /**
     * @param {number} batch
     * @returns {boolean}
     */
    eval_pending_step(batch) {
        const ret = wasm.wasmsetsearch_eval_pending_step(this.__wbg_ptr, batch);
        return ret !== 0;
    }
    /**
     * @param {string} layouts_json
     * @param {string} cands_json
     * @param {number} cap
     * @param {string} init_json
     * @param {number} top_n
     */
    constructor(layouts_json, cands_json, cap, init_json, top_n) {
        const val4 = +cap;
        const val5 = +top_n;
        let ptr0, len0, ptr1, len1, ptr2, len2;
        try {
            ptr0 = passStringToWasm0(layouts_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(cands_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len1 = WASM_VECTOR_LEN;
            ptr2 = passStringToWasm0(init_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len2 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.wasmsetsearch_new(ptr0, len0, ptr1, len1, val4, ptr2, len2, val5);
        this.__wbg_ptr = ret;
        WasmSetSearchFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Int32Array}
     */
    prepare_expand_raw() {
        const ret = wasm.wasmsetsearch_prepare_expand_raw(this.__wbg_ptr);
        var v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} quick_id
     * @returns {boolean}
     */
    prepare_expand_with_quick(quick_id) {
        const ret = wasm.wasmsetsearch_prepare_expand_with_quick(this.__wbg_ptr, quick_id);
        return ret !== 0;
    }
    /**
     * @param {Int32Array | number[]} top_flat
     */
    set_pending(top_flat) {
        const ptr0 = passArray32ToWasm0(top_flat, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmsetsearch_set_pending(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {string}
     */
    status_json() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmsetsearch_status_json(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) WasmSetSearch.prototype[Symbol.dispose] = WasmSetSearch.prototype.free;

/**
 * @param {number} cap
 * @param {number} allow_mask
 * @param {string} others_json
 * @param {string} start_json
 * @param {number} top
 * @returns {string}
 */
export function compat_best(cap, allow_mask, others_json, start_json, top) {
    let deferred6_0;
    let deferred6_1;
    try {
        const val3 = +cap;
        const val4 = +allow_mask;
        const val5 = +top;
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(others_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(start_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.compat_best(val3, val4, ptr0, len0, ptr1, len1, val5);
        deferred6_0 = ret[0];
        deferred6_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred6_0, deferred6_1, 1);
    }
}

/**
 * @param {string} char_json
 * @param {boolean} theme
 * @returns {Int32Array}
 */
export function feat_of_char(char_json, theme) {
    const val2 = +theme;
    const ptr0 = passStringToWasm0(char_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.feat_of_char(ptr0, len0, val2);
    var v3 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v3;
}

/**
 * @param {number} id
 * @param {boolean} theme
 * @returns {Int32Array}
 */
export function feat_of_id(id, theme) {
    const ret = wasm.feat_of_id(id, theme);
    var v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}

/**
 * @param {number} quick_id
 */
export function free_quick(quick_id) {
    wasm.free_quick(quick_id);
}

/**
 * @param {string} model_json
 * @returns {string}
 */
export function init_set_model(model_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(model_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.init_set_model(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * @param {string} model_json
 * @returns {string}
 */
export function init_vec_model(model_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(model_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.init_vec_model(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * @param {number} quick_id
 * @param {Int32Array | number[]} ids
 * @returns {number}
 */
export function quick_score(quick_id, ids) {
    const val2 = +quick_id;
    const ptr0 = passArray32ToWasm0(ids, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.quick_score(val2, ptr0, len0);
    return ret;
}

/**
 * @param {string} roster_json
 */
export function set_roster(roster_json) {
    const ptr0 = passStringToWasm0(roster_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.set_roster(ptr0, len0);
}

/**
 * @param {string} char_json
 * @param {boolean} theme
 * @returns {Float64Array}
 */
export function vecs_of_char(char_json, theme) {
    const val2 = +theme;
    const ptr0 = passStringToWasm0(char_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.vecs_of_char(ptr0, len0, val2);
    var v3 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v3;
}

/**
 * @param {number} id
 * @param {boolean} theme
 * @returns {Float64Array}
 */
export function vecs_of_id(id, theme) {
    const ret = wasm.vecs_of_id(id, theme);
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./rcompat_wasm_bg.js": import0,
    };
}

const WasmDeckOptFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmdeckopt_free(ptr, 1));
const WasmSetScorerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmsetscorer_free(ptr, 1));
const WasmSetSearchFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmsetsearch_free(ptr, 1));

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayI32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

let cachedInt32ArrayMemory0 = null;
function getInt32ArrayMemory0() {
    if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
        cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat64ArrayMemory0 = null;
    cachedInt32ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('rcompat_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
