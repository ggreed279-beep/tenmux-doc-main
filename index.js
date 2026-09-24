// ==UserScript==
// @name         BotGrepo
// @author       NotXina
// @description  Automação modular para Grepolis: construção, recrutamento, ataque, defesa, farm e mais.
// @version      1.9.0
// @match        http://*.grepolis.com/game/*
// @match        https://*.grepolis.com/game/*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/ggreed279-beep/tenmux-doc-main/main/index.js
// @downloadURL  https://raw.githubusercontent.com/ggreed279-beep/tenmux-doc-main/main/index.js
// ==/UserScript==

(function () {
    'use strict';

    var uw;
    if (typeof unsafeWindow == 'undefined') { uw = window; }
    else { uw = unsafeWindow; }

    if (uw.__botgrepo_index_running__) {
        console.warn('[BotGrepo] ⚠ index.js já está rodando nesta página — execução duplicada ignorada.');
        return;
    }
    uw.__botgrepo_index_running__ = true;

    const BASE_URL = 'https://raw.githubusercontent.com/ggreed279-beep/tenmux-doc-main/main/Modules';
    const MAX_RETRIES = 2;
    const FETCH_TIMEOUT_MS = 15000;

    const MODULES = [
        'core.js',
        'anti_rage.js',
        'auto_bootcamp.js',
        'auto_build.js',
        'auto_farm.js',
        'auto_gratis.js',
        'auto_hide.js',
        'auto_party.js',
        'auto_rural_level.js',
        'auto_rural_trade.js',
        'auto_trade.js',
        'auto_train.js',
        'status.js',
        'auto_militia.js',
        'auto_dodge.js',
        'auto_attack.js',
        'auto_command_paster.js',
        'auto_spells.js',
        'auto_research.js',
        'auto_send_resources.js',
        'colonize_ship_sender.js',
        'mult_tools.js',
        'auto_quest.js',
        'sniper.js',
        'discord_alert.js',
        'auto_festival.js',
        'multbot.js',
    ];

    const codes = new Array(MODULES.length).fill(null);
    let completed = 0;

    function injectAll() {
        if (uw.__botgrepo_modules_injected__) {
            console.warn('[BotGrepo] ⚠ Módulos já haviam sido injetados nesta página — injeção duplicada bloqueada.');
            return;
        }
        uw.__botgrepo_modules_injected__ = true;

        const fullCode =
            '(function () {\n' +
            '  var __uw = (typeof unsafeWindow == "undefined") ? window : unsafeWindow;\n' +
            '  if (__uw.__botgrepo_classes_declared__) {\n' +
            '    console.warn("[BotGrepo] \\u26a0 Classes ja declaradas nesta pagina - reinjecao abortada.");\n' +
            '    return;\n' +
            '  }\n' +
            '  __uw.__botgrepo_classes_declared__ = true;\n' +
            codes.join('\n\n') +
            '\n})();';

        try {
            const runBundle = new Function(fullCode);
            runBundle();
            console.log('[BotGrepo] ✓ Todos os módulos injetados! (index.js v1.9.0)');
        } catch (e) {
            console.warn('[BotGrepo] ⚠ Falha ao injetar o bundle: ' + (e?.message ?? e));
            console.warn('[BotGrepo] ⚠ Se o bot não carregou, dê um refresh completo (Ctrl+Shift+R).');
        }
    }

    async function fetchModule(index, attempt = 0) {
        const mod = MODULES[index];
        const url = `${BASE_URL}/${mod}?_=${Date.now()}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        try {
            const response = await fetch(url, { method: 'GET', cache: 'no-store', signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) { retryOrFail(index, attempt, `HTTP ${response.status}`); return; }
            const text = await response.text();
            codes[index] = text;
            console.log(`[BotGrepo] ✓ baixado: ${mod}`);
            completed++;
            if (completed === MODULES.length) injectAll();
        } catch (err) {
            clearTimeout(timeoutId);
            const reason = err?.name === 'AbortError' ? 'Timeout' : (err?.message ?? 'Falha de rede');
            retryOrFail(index, attempt, reason);
        }
    }

    function retryOrFail(index, attempt, reason) {
        const mod = MODULES[index];
        if (attempt < MAX_RETRIES) {
            const nextAttempt = attempt + 1;
            console.warn(`[BotGrepo] ⚠ ${reason} ao baixar ${mod} — tentativa ${nextAttempt}/${MAX_RETRIES}`);
            setTimeout(() => fetchModule(index, nextAttempt), 800 * nextAttempt);
        } else {
            codes[index] = `console.error('[BotGrepo] Falha definitiva ao carregar ${mod} após ${MAX_RETRIES} tentativas (${reason})');`;
            console.error(`[BotGrepo] ✗ Desistindo de ${mod} após ${MAX_RETRIES} tentativas: ${reason}`);
            completed++;
            if (completed === MODULES.length) injectAll();
        }
    }

    function waitForGame() {
        if (typeof Game !== 'undefined' && Game.player_id) {
            console.log('[BotGrepo] Game detectado, baixando módulos...');
            MODULES.forEach((_, i) => fetchModule(i));
        } else {
            setTimeout(waitForGame, 500);
        }
    }

    waitForGame();
})();
