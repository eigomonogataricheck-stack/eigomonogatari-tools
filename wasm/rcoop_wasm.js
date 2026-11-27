let wasm_bindgen = (function(exports) {
    let script_src;
    if (typeof document !== 'undefined' && document.currentScript !== null) {
        script_src = new URL(document.currentScript.src, location.href).toString();
    }

    class CoopWasm {
        __destroy_into_raw() {
            const ptr = this.__wbg_ptr;
            this.__wbg_ptr = 0;
            CoopWasmFinalization.unregister(this);
            return ptr;
        }
        free() {
            const ptr = this.__destroy_into_raw();
            wasm.__wbg_coopwasm_free(ptr, 0);
        }
        /**
         * 全キャラ × 7属性敵の 0T 攻撃プロファイル一括計算 (4.2 項目1 検証用)
         * 戻り値: [perHit, hits, all(0/1)] * 7 * char_count の Int32Array
         * @param {number} damage_base
         * @returns {Int32Array}
         */
        all_turn_zero_profiles(damage_base) {
            const ret = wasm.coopwasm_all_turn_zero_profiles(this.__wbg_ptr, damage_base);
            var v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v1;
        }
        /**
         * スキルタイムライン構築結果 JSON (4.2 項目2 検証用)
         * @param {string} state_json
         * @param {number} last_slot
         * @returns {string}
         */
        build_timeline_json(state_json, last_slot) {
            let deferred4_0;
            let deferred4_1;
            try {
                const val2 = +last_slot;
                const ptr0 = passStringToWasm0(state_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                const len0 = WASM_VECTOR_LEN;
                const ret = wasm.coopwasm_build_timeline_json(this.__wbg_ptr, ptr0, len0, val2);
                var ptr3 = ret[0];
                var len3 = ret[1];
                if (ret[3]) {
                    ptr3 = 0; len3 = 0;
                    throw takeFromExternrefTable0(ret[2]);
                }
                deferred4_0 = ptr3;
                deferred4_1 = len3;
                return getStringFromWasm0(ptr3, len3);
            } finally {
                wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
            }
        }
        /**
         * @returns {number}
         */
        char_count() {
            const ret = wasm.coopwasm_char_count(this.__wbg_ptr);
            return ret >>> 0;
        }
        /**
         * 全キャラのキー配列 JSON (JS 側で Map<key, idx> を 1 回構築する用)
         * @returns {string}
         */
        char_keys_json() {
            let deferred1_0;
            let deferred1_1;
            try {
                const ret = wasm.coopwasm_char_keys_json(this.__wbg_ptr);
                deferred1_0 = ret[0];
                deferred1_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
            }
        }
        /**
         * Worker stage バッチ評価 (フラット Int32Array 版: ゼロ JSON パース・最速)
         * prefix_flat: 長さ = count * 5 (各要素は char_idx, -1 は null)
         * cand_idx: 長さ = count (各要素は char_idx, -1 は null)
         * 戻り値: 通過したペアのインデックス (0..count) の Uint32Array
         * @param {Int32Array | number[]} prefix_flat
         * @param {Int32Array | number[]} cand_idx
         * @param {number} slot
         * @param {number} total_decks
         * @returns {Uint32Array}
         */
        eval_stage_batch_idx(prefix_flat, cand_idx, slot, total_decks) {
            const val3 = +slot;
            const val4 = +total_decks;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passArray32ToWasm0(prefix_flat, wasm.__wbindgen_malloc);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passArray32ToWasm0(cand_idx, wasm.__wbindgen_malloc);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 4, 4); }
                if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 4, 4); }
                throw e;
            }
            const ret = wasm.coopwasm_eval_stage_batch_idx(this.__wbg_ptr, ptr0, len0, ptr1, len1, val3, val4);
            var v5 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v5;
        }
        /**
         * Worker stage バッチ評価 (JSON 版: 汎用)
         * @param {string} pairs_json
         * @param {number} slot
         * @param {number} total_decks
         * @returns {Uint32Array}
         */
        eval_stage_batch_json(pairs_json, slot, total_decks) {
            const val2 = +slot;
            const val3 = +total_decks;
            const ptr0 = passStringToWasm0(pairs_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.coopwasm_eval_stage_batch_json(this.__wbg_ptr, ptr0, len0, val2, val3);
            if (ret[3]) {
                throw takeFromExternrefTable0(ret[2]);
            }
            var v4 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v4;
        }
        /**
         * 手動判定 (calculateCoop / layerOutcome 中核)
         * @param {string} state_json
         * @returns {string}
         */
        evaluate_manual_json(state_json) {
            let deferred3_0;
            let deferred3_1;
            try {
                const ptr0 = passStringToWasm0(state_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                const len0 = WASM_VECTOR_LEN;
                const ret = wasm.coopwasm_evaluate_manual_json(this.__wbg_ptr, ptr0, len0);
                var ptr2 = ret[0];
                var len2 = ret[1];
                if (ret[3]) {
                    ptr2 = 0; len2 = 0;
                    throw takeFromExternrefTable0(ret[2]);
                }
                deferred3_0 = ptr2;
                deferred3_1 = len2;
                return getStringFromWasm0(ptr2, len2);
            } finally {
                wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
            }
        }
        /**
         * 候補プール生成 (1枠目)
         * @returns {Uint32Array}
         */
        first_candidates_all_idx() {
            const ret = wasm.coopwasm_first_candidates_all_idx(this.__wbg_ptr);
            var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v1;
        }
        /**
         * @param {number} idx
         * @returns {string}
         */
        idx_to_key(idx) {
            let deferred1_0;
            let deferred1_1;
            try {
                const ret = wasm.coopwasm_idx_to_key(this.__wbg_ptr, idx);
                deferred1_0 = ret[0];
                deferred1_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
            }
        }
        /**
         * @param {string} key
         * @returns {number}
         */
        key_to_idx(key) {
            const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.coopwasm_key_to_idx(this.__wbg_ptr, ptr0, len0);
            return ret;
        }
        /**
         * @param {string} chars_json
         */
        constructor(chars_json) {
            const ptr0 = passStringToWasm0(chars_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.coopwasm_new(ptr0, len0);
            if (ret[2]) {
                throw takeFromExternrefTable0(ret[1]);
            }
            this.__wbg_ptr = ret[0];
            CoopWasmFinalization.register(this, this.__wbg_ptr, this);
            return this;
        }
        /**
         * 候補プール生成 (2〜5枠目)
         * @param {number} slot
         * @returns {Uint32Array}
         */
        pool_all_idx(slot) {
            const ret = wasm.coopwasm_pool_all_idx(this.__wbg_ptr, slot);
            var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v1;
        }
        /**
         * エンドツーエンド総当たり (4.2 項目5 検証・一括実行用)
         * @param {string} state_json
         * @param {number} total_decks
         * @returns {string}
         */
        run_bruteforce_end_to_end_json(state_json, total_decks) {
            let deferred4_0;
            let deferred4_1;
            try {
                const val2 = +total_decks;
                const ptr0 = passStringToWasm0(state_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                const len0 = WASM_VECTOR_LEN;
                const ret = wasm.coopwasm_run_bruteforce_end_to_end_json(this.__wbg_ptr, ptr0, len0, val2);
                var ptr3 = ret[0];
                var len3 = ret[1];
                if (ret[3]) {
                    ptr3 = 0; len3 = 0;
                    throw takeFromExternrefTable0(ret[2]);
                }
                deferred4_0 = ptr3;
                deferred4_1 = len3;
                return getStringFromWasm0(ptr3, len3);
            } finally {
                wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
            }
        }
        /**
         * @param {string} state_json
         */
        set_state(state_json) {
            const ptr0 = passStringToWasm0(state_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.coopwasm_set_state(this.__wbg_ptr, ptr0, len0);
            if (ret[1]) {
                throw takeFromExternrefTable0(ret[0]);
            }
        }
    }
    if (Symbol.dispose) CoopWasm.prototype[Symbol.dispose] = CoopWasm.prototype.free;
    exports.CoopWasm = CoopWasm;

    /**
     * @param {string} effect_json
     * @returns {number}
     */
    function skill_amt_json(effect_json) {
        const ptr0 = passStringToWasm0(effect_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.skill_amt_json(ptr0, len0);
        return ret;
    }
    exports.skill_amt_json = skill_amt_json;

    /**
     * @param {string} s
     * @returns {string}
     */
    function skill_canon(s) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passStringToWasm0(s, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.skill_canon(ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    exports.skill_canon = skill_canon;

    /**
     * @param {string} value
     * @returns {string}
     */
    function skill_condition_attribute(value) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.skill_condition_attribute(ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    exports.skill_condition_attribute = skill_condition_attribute;

    /**
     * @param {string} s
     * @returns {string}
     */
    function skill_en(s) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passStringToWasm0(s, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.skill_en(ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    exports.skill_en = skill_en;

    /**
     * @param {string} cur
     * @param {string} req
     * @returns {boolean}
     */
    function skill_matches(cur, req) {
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(cur, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(req, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.skill_matches(ptr0, len0, ptr1, len1);
        return ret !== 0;
    }
    exports.skill_matches = skill_matches;

    /**
     * @param {string} s
     * @returns {string}
     */
    function skill_norm(s) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passStringToWasm0(s, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.skill_norm(ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    exports.skill_norm = skill_norm;

    /**
     * @param {string} val_json
     * @returns {number}
     */
    function skill_raw_json(val_json) {
        const ptr0 = passStringToWasm0(val_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.skill_raw_json(ptr0, len0);
        return ret;
    }
    exports.skill_raw_json = skill_raw_json;

    /**
     * @param {string} effect_json
     * @param {string} opponent
     * @returns {boolean}
     */
    function skill_target_matches_json(effect_json, opponent) {
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(effect_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(opponent, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.skill_target_matches_json(ptr0, len0, ptr1, len1);
        return ret !== 0;
    }
    exports.skill_target_matches_json = skill_target_matches_json;
    function __wbg_get_imports() {
        const import0 = {
            __proto__: null,
            __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
                throw new Error(getStringFromWasm0(arg0, arg1));
            },
            __wbindgen_generic_0000000000000001: function(arg0, arg1) {
                // Cast intrinsic for `Ref(String) -> Externref`.
                const ret = getStringFromWasm0(arg0, arg1);
                return ret;
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
            "./rcoop_wasm_bg.js": import0,
        };
    }

    const CoopWasmFinalization = (typeof FinalizationRegistry === 'undefined')
        ? { register: () => {}, unregister: () => {} }
        : new FinalizationRegistry(ptr => wasm.__wbg_coopwasm_free(ptr, 1));

    function getArrayI32FromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
    }

    function getArrayU32FromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
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

    function takeFromExternrefTable0(idx) {
        const value = wasm.__wbindgen_externrefs.get(idx);
        wasm.__externref_table_dealloc(idx);
        return value;
    }

    let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
    cachedTextDecoder.decode();
    function decodeText(bytes) {
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

        if (module_or_path === undefined && script_src !== undefined) {
            module_or_path = script_src.replace(/\.js$/, "_bg.wasm");
        }
        const imports = __wbg_get_imports();

        if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
            module_or_path = fetch(module_or_path);
        }

        const { instance, module } = await __wbg_load(await module_or_path, imports);

        return __wbg_finalize_init(instance, module);
    }

    return Object.assign(__wbg_init, { initSync }, exports);
})({ __proto__: null });
