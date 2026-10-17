// ══════════════════════════════════════════════════════
//  MODULE: AutoHide
//  Guarda prata (iron nos resources) automaticamente no
//  esconderijo. TRÊS MODOS à escolha nas definições:
//
//  OPÇÃO 1 — GOTAS RÁPIDAS:
//     Envia 1000 de prata para o esconderijo a cada 1 minuto.
//
//  OPÇÃO 2 — LÓGICA INTELIGENTE (comportamento original):
//     1. FERRO FIXO: cidade com mais de 15.000 de ferro guarda
//        STORE_AMOUNT fixo no esconderijo.
//     2. PRATA 90%: quando a prata (iron) bate 90% do armazém
//        (storage), guarda 10% do armazém imediatamente.
//
//  OPÇÃO 3 — GOTAS LENTAS (NOVO):
//     Envia 1000 de prata para o esconderijo a cada 50 minutos.
//
//  NOTA: no Grepolis, "iron" nos resources() é PRATA.
//  Endpoint confirmado: frontend_bridge/execute, model_url: "BuildingHide",
//  action_name: "storeIron", arguments: { iron_to_store: N }
// ══════════════════════════════════════════════════════
var AutoHide = class extends MultUtil {
    // ── Modo 1 (gotas rápidas) ──
    DRIP_AMOUNT = 1000;          
    DRIP_INTERVAL_MS = 60000;    // 1 minuto

    // ── Modo 2 (inteligente) ──
    STORE_AMOUNT = 10000;        
    SILVER_THRESHOLD = 0.9;      
    SILVER_STORE_PCT = 0.1;      
    SMART_INTERVAL_MS = 5000;    

    // ── Modo 3 (gotas lentas) ──
    SLOW_DRIP_AMOUNT = 1000;          
    SLOW_DRIP_INTERVAL_MS = 50 * 60 * 1000; // 50 minutos

    constructor(c, s) {
        super(c, s);
        this._active     = this.storage.load('autohide_active', false);
        this._mode       = this.storage.load('autohide_mode', 'smart'); // 'drip' | 'smart' | 'slow_drip'
        this._intervalId = null;
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
                <b>⚡ OPÇÃO 1 — Gotas rápidas</b><br>
                <span style="font-size:10.5px;">Envia <b>1000 de prata</b> para o esconderijo <b>a cada 1 minuto</b>.</span>
            </div>
            <div id="ah_mode_smart" style="margin:0 10px 6px;padding:7px 10px;border:2px solid;border-radius:6px;font-size:11.5px;cursor:pointer;${this._mode === 'smart' ? this._modeSelectedStyle() : this._modeUnselectedStyle()}">
                <b>🛡️ OPÇÃO 2 — Lógica inteligente</b><br>
                <span style="font-size:10.5px;">${this.t('ah_silver_desc')}</span>
            </div>
            <div id="ah_mode_slow_drip" style="margin:0 10px 8px;padding:7px 10px;border:2px solid;border-radius:6px;font-size:11.5px;cursor:pointer;${this._mode === 'slow_drip' ? this._modeSelectedStyle() : this._modeUnselectedStyle()}">
                <b>🐌 OPÇÃO 3 — Gotas lentas (50 min)</b><br>
                <span style="font-size:10.5px;">Envia <b>1000 de prata</b> para o esconderijo <b>a cada 50 minutos</b>.</span>
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

    _bindModeOptions() {
        try {
            const $drip = uw.$('#ah_mode_drip');
            const $smart = uw.$('#ah_mode_smart');
            const $slowDrip = uw.$('#ah_mode_slow_drip');
            if ($drip.length) $drip.off('click').on('click', () => this.setMode('drip'));
            if ($smart.length) $smart.off('click').on('click', () => this.setMode('smart'));
            if ($slowDrip.length) $slowDrip.off('click').on('click', () => this.setMode('slow_drip'));
        } catch (e) {}
    }

    setMode = (mode) => {
        if (mode !== 'drip' && mode !== 'smart' && mode !== 'slow_drip') return;
        if (this._mode === mode) return;
        this._mode = mode;
        this.storage.save('autohide_mode', mode);

        let label = '';
        if (mode === 'drip') label = 'OPÇÃO 1 — Gotas rápidas (1000 prata a cada 1 min)';
        else if (mode === 'smart') label = 'OPÇÃO 2 — Lógica inteligente (90% prata + ferro fixo)';
        else if (mode === 'slow_drip') label = 'OPÇÃO 3 — Gotas lentas (1000 prata a cada 50 min)';
        
        this.console.log('[AutoHide] Modo alterado para: ' + label);

        if (this._active && this._intervalId) {
            clearInterval(this._intervalId);
            let interval = this.SMART_INTERVAL_MS;
            if (this._mode === 'drip') interval = this.DRIP_INTERVAL_MS;
            else if (this._mode === 'slow_drip') interval = this.SLOW_DRIP_INTERVAL_MS;
            
            this._intervalId = this.createGuardedInterval(
                () => this.main(),
                interval
            );
        }

        try {
            const $drip = uw.$('#ah_mode_drip');
            const $smart = uw.$('#ah_mode_smart');
            const $slowDrip = uw.$('#ah_mode_slow_drip');
            if ($drip.length) $drip.attr('style', 'margin:0 10px 6px;padding:7px 10px;border:2px solid;border-radius:6px;font-size:11.5px;cursor:pointer;' + (this._mode === 'drip' ? this._modeSelectedStyle() : this._modeUnselectedStyle()));
            if ($smart.length) $smart.attr('style', 'margin:0 10px 6px;padding:7px 10px;border:2px solid;border-radius:6px;font-size:11.5px;cursor:pointer;' + (this._mode === 'smart' ? this._modeSelectedStyle() : this._modeUnselectedStyle()));
            if ($slowDrip.length) $slowDrip.attr('style', 'margin:0 10px 8px;padding:7px 10px;border:2px solid;border-radius:6px;font-size:11.5px;cursor:pointer;' + (this._mode === 'slow_drip' ? this._modeSelectedStyle() : this._modeUnselectedStyle()));
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
        
        let modeLabel = '';
        let interval = this.SMART_INTERVAL_MS;
        if (this._mode === 'drip') {
            modeLabel = 'gotas rápidas (1000/min)';
            interval = this.DRIP_INTERVAL_MS;
        } else if (this._mode === 'slow_drip') {
            modeLabel = 'gotas lentas (1000/50min)';
            interval = this.SLOW_DRIP_INTERVAL_MS;
        } else {
            modeLabel = 'inteligente (90% prata)';
        }
        
        this.console.log('[AutoHide] ' + this.t('ar_started') + ' Modo: ' + modeLabel + '.');
        this.main();
        this._intervalId = this.createGuardedInterval(
            () => this.main(),
            interval
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
            let modeLabel = '';
            if (this._mode === 'drip') modeLabel = 'OPÇÃO 1 · 1000 prata a cada 1 min';
            else if (this._mode === 'slow_drip') modeLabel = 'OPÇÃO 3 · 1000 prata a cada 50 min';
            else modeLabel = 'OPÇÃO 2 · lógica inteligente (90% prata)';
            
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

        // ── OPÇÃO 1: gotas rápidas ──────
        if (this._mode === 'drip') {
            for (const town of eligible) {
                try {
                    const res = town.resources();
                    const iron = res.iron; // prata no Grepolis
                    if (iron >= this.DRIP_AMOUNT) {
                        await this.storeIron(town.id, this.DRIP_AMOUNT);
                    }
                } catch (e) {
                    this.console.log('[AutoHide] ' + this.t('ah_store_error', { msg: e?.message ?? e }));
                }
            }
            return;
        }

        // ── OPÇÃO 3: gotas lentas (50 min) ──────
        if (this._mode === 'slow_drip') {
            for (const town of eligible) {
                try {
                    const res = town.resources();
                    const iron = res.iron; // prata no Grepolis
                    if (iron >= this.SLOW_DRIP_AMOUNT) {
                        await this.storeIron(town.id, this.SLOW_DRIP_AMOUNT);
                    }
                } catch (e) {
                    this.console.log('[AutoHide] ' + this.t('ah_store_error', { msg: e?.message ?? e }));
                }
            }
            return;
        }

        // ── OPÇÃO 2: lógica inteligente ────────────
        for (const town of eligible) {
            try {
                const res     = town.resources();
                const iron    = res.iron;    // prata no Grepolis
                const storage = res.storage;

                const silverThreshold = Math.floor(storage * this.SILVER_THRESHOLD);
                const townKey = String(town.id);

                if (iron >= silverThreshold && !this._silverCooldown.has(townKey)) {
                    const toStore = Math.max(1, Math.floor(storage * this.SILVER_STORE_PCT));

                    this.console.log('[AutoHide] ' + this.t('ah_silver_trigger_log', {
                        town: town.getName(),
                        iron: iron,
                        pct: Math.round(iron / storage * 100),
                        amount: toStore,
                    }));

                    this._silverCooldown.add(townKey);
                    setTimeout(() => this._silverCooldown.delete(townKey), 60000);

                    await this.storeIron(town.id, toStore);
                    continue;
                }

                if (iron > 15000) {
                    await this.storeIron(town.id, this.STORE_AMOUNT);
                }
            } catch (e) {
                this.console.log('[AutoHide] ' + this.t('ah_store_error', { msg: e?.message ?? e }));
            }
        }
    }

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
