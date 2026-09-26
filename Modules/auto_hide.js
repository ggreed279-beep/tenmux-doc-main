// ══════════════════════════════════════════════════════
//  MODULE: AutoHide
//  Guarda prata (iron nos resources) automaticamente no
//  esconderijo. DOIS MODOS à escolha nas definições:
//
//  OPÇÃO 1 — GOTAS (novo):
//     Envia 1000 de ferro (prata) para o esconderijo a cada
//     1 minuto, em todas as cidades elegíveis. Simples e
//     constante.
//
//  OPÇÃO 2 — LÓGICA INTELIGENTE (comportamento original):
//     1. FERRO FIXO: cidade com mais de 15.000 de ferro guarda
//        STORE_AMOUNT fixo no esconderijo.
//     2. PRATA 90%: quando a prata (iron) bate 90% do armazém
//        (storage), guarda 10% do armazém imediatamente —
//        válvula de alívio para não perder prata em ataques.
//     NOTA: no Grepolis, "iron" nos resources() é PRATA —
//     o campo de recursos usa o nome interno "iron" para
//     representar prata (recurso raro do jogo).
//
//  Endpoint confirmado via captura real de rede:
//  frontend_bridge/execute, model_url: "BuildingHide",
//  action_name: "storeIron", arguments: { iron_to_store: N }
// ══════════════════════════════════════════════════════
var AutoHide = class extends MultUtil {
    // ── Modo 1 (gotas) ──
    DRIP_AMOUNT = 1000;          // ferro enviado por cidade por ciclo
    DRIP_INTERVAL_MS = 60000;    // 1 minuto entre ciclos

    // ── Modo 2 (inteligente) ──
    STORE_AMOUNT = 10000;        // quantidade fixa guardada por vez (ferro fixo)
    SILVER_THRESHOLD = 0.9;      // gatilho: 90% do armazém
    SILVER_STORE_PCT = 0.1;      // guarda 10% do armazém quando dispara
    SMART_INTERVAL_MS = 5000;    // ciclo de 5s

    constructor(c, s) {
        super(c, s);
        this._active     = this.storage.load('autohide_active', false);
        this._mode       = this.storage.load('autohide_mode', 'smart'); // 'drip' | 'smart'
        this._intervalId = null;
        // Controla quais cidades já foram tratadas neste ciclo de
        // prata, para não guardar múltiplas vezes seguidas enquanto
        // o armazém ainda está alto (o jogo demora a atualizar o
        // valor após o storeIron)
        this._silverCooldown = new Set();

        if (this._active) {
            setTimeout(() => this.start(), 2500);
        }
    }

    settings = () => {
        requestAnimationFrame(() => {
            this._updateTitle();
            this._renderStatus();
            this._bindModeOptions();
        });

        return `
        <div class="game_border" style="margin-bottom: 20px">
            <div class="game_border_top"></div><div class="game_border_bottom"></div>
            <div class="game_border_left"></div><div class="game_border_right"></div>
            <div class="game_border_corner corner1"></div><div class="game_border_corner corner2"></div>
            <div class="game_border_corner corner3"></div><div class="game_border_corner corner4"></div>
            ${this.getTitleHtml('auto_cave_title', this.t('ah_title'), this.toggle, '', this._active)}
            <div style="padding: 5px; font-weight: 600">
                ${this.t('ah_desc', { amount: this.STORE_AMOUNT })}
            </div>
            <div style="padding: 2px 10px 6px; font-size: 11px; color: #5a3a0a;">
                Escolhe o modo de funcionamento (a opção ativa fica destacada a verde):
            </div>
            <div id="ah_mode_drip" style="margin:0 10px 6px;padding:7px 10px;border:2px solid;border-radius:6px;font-size:11.5px;cursor:pointer;${this._mode === 'drip' ? this._modeSelectedStyle() : this._modeUnselectedStyle()}">
                <b>📍 OPÇÃO 1 — Gotas constantes</b><br>
                <span style="font-size:10.5px;">Envia <b>1000 de ferro</b> para o esconderijo <b>a cada 1 minuto</b>, em todas as cidades elegíveis.</span>
            </div>
            <div id="ah_mode_smart" style="margin:0 10px 8px;padding:7px 10px;border:2px solid;border-radius:6px;font-size:11.5px;cursor:pointer;${this._mode === 'smart' ? this._modeSelectedStyle() : this._modeUnselectedStyle()}">
                <b>🛡️ OPÇÃO 2 — Lógica inteligente</b><br>
                <span style="font-size:10.5px;">${this.t('ah_silver_desc')}</span>
            </div>
            <div id="ah_status" style="padding:2px 10px 8px;font-size:11px;color:#5a3a0a;"></div>
        </div>
        `;
    };

    _modeSelectedStyle() {
        return 'border-color:#1a6b2a;background:rgba(26,107,42,0.12);color:#1a6b2a;';
    }

    _modeUnselectedStyle() {
        return 'border-color:rgba(163,128,63,0.45);background:rgba(0,0,0,0.025);color:#5a3a0a;';
    }

    /* Liga os cliques nas caixas de opção após o HTML ser injetado */
    _bindModeOptions() {
        try {
            const $drip = uw.$('#ah_mode_drip');
            const $smart = uw.$('#ah_mode_smart');
            if ($drip.length) $drip.off('click').on('click', () => this.setMode('drip'));
            if ($smart.length) $smart.off('click').on('click', () => this.setMode('smart'));
        } catch (e) {}
    }

    /* Muda o modo: grava, atualiza visual e reajusta o intervalo
       se o módulo estiver ativo (drip = 60s, smart = 5s) */
    setMode = (mode) => {
        if (mode !== 'drip' && mode !== 'smart') return;
        if (this._mode === mode) return;
        this._mode = mode;
        this.storage.save('autohide_mode', mode);

        const label = mode === 'drip'
            ? 'OPÇÃO 1 — Gotas (1000 ferro a cada 1 minuto)'
            : 'OPÇÃO 2 — Lógica inteligente (90% prata + ferro fixo)';
        this.console.log('[AutoHide] Modo alterado para: ' + label);

        // Reajusta o intervalo imediatamente se estiver ativo
        if (this._active && this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = this.createGuardedInterval(
                () => this.main(),
                this._mode === 'drip' ? this.DRIP_INTERVAL_MS : this.SMART_INTERVAL_MS
            );
        }

        // Atualiza o visual das caixas
        try {
            const $drip = uw.$('#ah_mode_drip');
            const $smart = uw.$('#ah_mode_smart');
            if ($drip.length) $drip.attr('style', 'margin:0 10px 6px;padding:7px 10px;border:2px solid;border-radius:6px;font-size:11.5px;cursor:pointer;' + (this._mode === 'drip' ? this._modeSelectedStyle() : this._modeUnselectedStyle()));
            if ($smart.length) $smart.attr('style', 'margin:0 10px 8px;padding:7px 10px;border:2px solid;border-radius:6px;font-size:11.5px;cursor:pointer;' + (this._mode === 'smart' ? this._modeSelectedStyle() : this._modeUnselectedStyle()));
        } catch (e) {}
    };

    toggle = () => {
        if (this._active) this.stop();
        else this.start();
    };

    start() {
        if (this._active) return;
        this._active = true;
        this.storage.save('autohide_active', true);
        this._updateTitle();
        const modeLabel = this._mode === 'drip' ? 'gotas (1000/min)' : 'inteligente (90% prata)';
        this.console.log('[AutoHide] ' + this.t('ar_started') + ' Modo: ' + modeLabel + '.');
        this.main();
        this._intervalId = this.createGuardedInterval(
            () => this.main(),
            this._mode === 'drip' ? this.DRIP_INTERVAL_MS : this.SMART_INTERVAL_MS
        );
    }

    stop() {
        this._active = false;
        this.storage.save('autohide_active', false);
        if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
        this._silverCooldown.clear();
        this._updateTitle();
        this.console.log('[AutoHide] ' + this.t('ar_stopped_log'));
    }

    _updateTitle() {
        uw.$('#auto_cave_title').css('filter', this._active
            ? 'brightness(100%) saturate(186%) hue-rotate(241deg)' : '');
    }

    /* Cidades elegíveis: esconderijo nível 10 (requisito mínimo
       confirmado no código original). */
    _getEligibleTowns() {
        try {
            return Object.values(uw.ITowns.towns).filter(t => {
                try { return t.buildings().attributes.hide === 10; } catch (e) { return false; }
            });
        } catch (e) {
            return [];
        }
    }

    _renderStatus() {
        try {
            const eligible = this._getEligibleTowns();
            const modeLabel = this._mode === 'drip'
                ? 'OPÇÃO 1 · 1000 ferro a cada 1 min'
                : 'OPÇÃO 2 · lógica inteligente';
            uw.$('#ah_status').html(
                '<b>' + modeLabel + '</b>' +
                (this._active ? ' · <span style="color:#1a6b2a;font-weight:bold;">● ATIVO</span>' : ' · <span style="color:#c0392b;font-weight:bold;">● PARADO</span>') +
                ' · ' + this.t('ah_eligible_count', { count: eligible.length })
            );
        } catch (e) {}
    }

    main = async () => {
        if (!this._active) return;

        const eligible = this._getEligibleTowns();
        this._renderStatus();

        // ── OPÇÃO 1: gotas — 1000 ferro a cada 1 minuto ──────
        if (this._mode === 'drip') {
            for (const town of eligible) {
                try {
                    const res = town.resources();
                    const iron = res.iron; // prata no Grepolis
                    // Só envia se a cidade tiver ferro suficiente
                    if (iron >= this.DRIP_AMOUNT) {
                        await this.storeIron(town.id, this.DRIP_AMOUNT);
                    }
                } catch (e) {
                    this.console.log('[AutoHide] ' + this.t('ah_store_error', { msg: e?.message ?? e }));
                }
            }
            return;
        }

        // ── OPÇÃO 2: lógica inteligente (original) ────────────
        for (const town of eligible) {
            try {
                const res     = town.resources();
                const iron    = res.iron;    // prata no Grepolis
                const storage = res.storage;

                // Modo prata 90%: gatilho prioritário
                // Quando a prata bate 90% do armazém, guarda 10%
                // imediatamente. Cooldown de 60s por cidade para evitar
                // guardar múltiplas vezes enquanto o jogo não atualiza
                // o valor do recurso após o storeIron.
                const silverThreshold = Math.floor(storage * this.SILVER_THRESHOLD);
                const townKey = String(town.id);

                if (iron >= silverThreshold && !this._silverCooldown.has(townKey)) {
                    // Guarda 10% da capacidade total do armazém.
                    // Usa Math.max(1, ...) para garantir que nunca
                    // manda iron_to_store: 0 para o servidor.
                    const toStore = Math.max(1, Math.floor(storage * this.SILVER_STORE_PCT));

                    this.console.log('[AutoHide] ' + this.t('ah_silver_trigger_log', {
                        town: town.getName(),
                        iron: iron,
                        pct: Math.round(iron / storage * 100),
                        amount: toStore,
                    }));

                    // Cooldown ANTES do await — evita que outro ciclo
                    // de 5s dispare um segundo storeIron enquanto o
                    // primeiro ainda está em flight
                    this._silverCooldown.add(townKey);
                    setTimeout(() => this._silverCooldown.delete(townKey), 60000);

                    await this.storeIron(town.id, toStore);
                    continue; // pula o check de ferro fixo nesse ciclo
                }

                // Modo ferro fixo (comportamento original)
                if (iron > 15000) {
                    await this.storeIron(town.id, this.STORE_AMOUNT);
                }
            } catch (e) {
                this.console.log('[AutoHide] ' + this.t('ah_store_error', { msg: e?.message ?? e }));
            }
        }
    }

    /* Confirmado via captura real de rede:
       frontend_bridge/execute, BuildingHide/storeIron,
       arguments: { iron_to_store: N }, town_id, nl_init:true. */
    storeIron = async (town_id, count) => {
        try {
            const res = await this.ajaxPostWithTimeout('frontend_bridge', 'execute', {
                model_url:   'BuildingHide',
                action_name: 'storeIron',
                captcha:     null,
                arguments:   { iron_to_store: count },
                town_id:     town_id,
                nl_init:     true,
            });
            if (res && !res.error) {
                const name = uw.ITowns.towns[town_id]?.getName?.() ?? ('#' + town_id);
                this.console.log('[AutoHide] ' + this.t('ah_stored_log', { town: name, amount: count }));
            } else {
                this.console.log('[AutoHide] ' + this.t('ah_store_error', { msg: res?.error ?? '?' }));
            }
        } catch (e) {
            this.console.log('[AutoHide] ' + this.t('ah_store_error', { msg: e?.message ?? e }));
        }
    }
};
