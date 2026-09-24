// ══════════════════════════════════════════════════════
//  MODULE: StatusPanel (Futuristic HUD v2.1 — BotGrepo)
//  Painel de status em tempo real.
// ══════════════════════════════════════════════════════
var StatusPanel = class extends MultUtil {
    constructor(c, s) {
        super(c, s);
        this._interval = null;
        this._refreshTimeoutId = null;
        this._countdownInterval = null;
        this._nextRefreshAt = null;
        this._refreshMinutes = this.storage.load('refresh_minutes', 0);
        this._styleInjected = false;

        if (this._refreshMinutes > 0) this._scheduleRefresh();
    }

    _injectStyles() {
        if (uw.$('#mbhud-styles').length) { this._styleInjected = true; return; }
        const css = `
            @keyframes mbhud-pulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.55; transform: scale(1.25); }
            }
            @keyframes mbhud-scan {
                0%   { background-position: 200% 0%; }
                100% { background-position: -200% 0%; }
            }
            @keyframes mbhud-fade {
                from { opacity: 0; transform: translateY(-3px); }
                to   { opacity: 1; transform: translateY(0); }
            }
            .mbhud-root{background:linear-gradient(135deg,#060816 0%,#0a1020 50%,#060816 100%);border:1px solid rgba(34,211,238,0.35);border-radius:6px;padding:12px;font-family:'SF Mono','Consolas','Monaco','Menlo',monospace;color:#a8b8d0;box-shadow:0 0 24px rgba(34,211,238,0.15),inset 0 0 60px rgba(34,211,238,0.03);position:relative;overflow:hidden;animation:mbhud-fade 0.35s ease;}
            .mbhud-root::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#22d3ee,transparent);background-size:200% 100%;animation:mbhud-scan 3.5s linear infinite;pointer-events:none;}
            .mbhud-root::after{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(34,211,238,0.035) 1px,transparent 1px),linear-gradient(90deg,rgba(34,211,238,0.035) 1px,transparent 1px);background-size:22px 22px;pointer-events:none;opacity:0.55;}
            .mbhud-header{text-align:center;padding:4px 0 12px;border-bottom:1px solid rgba(34,211,238,0.2);margin-bottom:12px;position:relative;z-index:1;}
            .mbhud-header h2{margin:0;font-size:14px;letter-spacing:6px;text-transform:uppercase;color:#22d3ee;text-shadow:0 0 12px rgba(34,211,238,0.7),0 0 26px rgba(34,211,238,0.3);font-weight:700;font-family:inherit;}
            .mbhud-header .sub{font-size:9px;color:#4a5a6a;letter-spacing:3px;margin-top:5px;text-transform:uppercase;}
            .mbhud-header .sub .live{color:#00ff88;text-shadow:0 0 8px rgba(0,255,136,0.6);font-variant-numeric:tabular-nums;}
            .mbhud-section{background:rgba(10,16,32,0.6);border:1px solid rgba(34,211,238,0.2);border-radius:4px;padding:10px 12px;margin-bottom:10px;position:relative;z-index:1;}
            .mbhud-label{display:block;font-size:9px;letter-spacing:2.5px;text-transform:uppercase;color:#22d3ee;margin-bottom:8px;text-shadow:0 0 8px rgba(34,211,238,0.6);font-weight:700;font-family:inherit;}
            .mbhud-label::before{content:'▸ ';opacity:0.7;margin-right:2px;}
            .mbhud-input{background:rgba(0,0,0,0.55);border:1px solid rgba(34,211,238,0.3);border-radius:3px;color:#e8f0ff;padding:4px 8px;font-family:inherit;font-size:11px;outline:none;transition:all 0.2s;min-width:72px;font-variant-numeric:tabular-nums;}
            .mbhud-input:focus{border-color:#22d3ee;box-shadow:0 0 12px rgba(34,211,238,0.4);background:rgba(0,0,0,0.8);}
            .mbhud-input::-webkit-calendar-picker-indicator{filter:invert(0.75) sepia(1) saturate(6) hue-rotate(140deg);cursor:pointer;}
            .mbhud-btn{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;background:linear-gradient(180deg,rgba(34,211,238,0.14),rgba(34,211,238,0.04));border:1px solid rgba(34,211,238,0.5);border-radius:3px;color:#22d3ee;font-family:inherit;font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;cursor:pointer;transition:all 0.2s;text-shadow:0 0 6px rgba(34,211,238,0.5);user-select:none;outline:none;}
            .mbhud-btn:hover{background:linear-gradient(180deg,rgba(34,211,238,0.3),rgba(34,211,238,0.1));box-shadow:0 0 16px rgba(34,211,238,0.5);transform:translateY(-1px);}
            .mbhud-btn.btn-danger{background:linear-gradient(180deg,rgba(248,113,113,0.14),rgba(248,113,113,0.04));border-color:rgba(248,113,113,0.55);color:#f87171;text-shadow:0 0 6px rgba(248,113,113,0.5);}
            .mbhud-btn.btn-danger:hover{background:linear-gradient(180deg,rgba(248,113,113,0.32),rgba(248,113,113,0.1));box-shadow:0 0 16px rgba(248,113,113,0.5);}
            .mbhud-flex{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
            .mbhud-status{font-size:10px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;font-family:inherit;}
            .mbhud-status.on{color:#00ff88;text-shadow:0 0 8px rgba(0,255,136,0.6);}
            .mbhud-status.off{color:#f87171;text-shadow:0 0 8px rgba(248,113,113,0.4);}
            .mbhud-status.warn{color:#ffb020;text-shadow:0 0 8px rgba(255,176,32,0.6);}
            .mbhud-led{display:inline-block;width:8px;height:8px;border-radius:50%;background:#1a2030;border:1px solid rgba(255,255,255,0.08);vertical-align:middle;flex-shrink:0;}
            .mbhud-led.on{background:#00ff88;box-shadow:0 0 8px #00ff88,0 0 14px rgba(0,255,136,0.55);animation:mbhud-pulse 2s ease-in-out infinite;}
            .mbhud-led.off{background:#2a1a1a;box-shadow:inset 0 0 3px rgba(255,0,0,0.15);}
            .mbhud-led.warn{background:#ffb020;box-shadow:0 0 8px #ffb020;animation:mbhud-pulse 1.2s ease-in-out infinite;}
            .mbhud-row{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-bottom:1px solid rgba(34,211,238,0.08);transition:background 0.2s;gap:7px;}
            .mbhud-row:last-child{border-bottom:none;}
            .mbhud-row:hover{background:rgba(34,211,238,0.045);}
            .mbhud-row-name{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:700;color:#e8f0ff;letter-spacing:0.4px;flex:1;min-width:0;}
            .mbhud-row-name > span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
            .mbhud-row-value{font-size:10px;color:#6a7a8a;letter-spacing:0.3px;text-align:right;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
            .mbhud-row-value.hot{color:#22d3ee;text-shadow:0 0 6px rgba(34,211,238,0.45);}
            .mbhud-pill{padding:3px 10px;border-radius:20px;font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;cursor:pointer;font-family:inherit;transition:all 0.2s;border:1px solid;outline:none;user-select:none;white-space:nowrap;}
            .mbhud-pill.on{background:rgba(0,255,136,0.12);border-color:rgba(0,255,136,0.5);color:#00ff88;box-shadow:0 0 10px rgba(0,255,136,0.2);text-shadow:0 0 6px rgba(0,255,136,0.4);}
            .mbhud-pill.on:hover{background:rgba(0,255,136,0.25);box-shadow:0 0 18px rgba(0,255,136,0.55);}
            .mbhud-pill.off{background:rgba(248,113,113,0.07);border-color:rgba(248,113,113,0.28);color:#7a8a94;}
            .mbhud-pill.off:hover{background:rgba(248,113,113,0.18);border-color:rgba(248,113,113,0.6);color:#f87171;box-shadow:0 0 12px rgba(248,113,113,0.35);}
            .mbhud-countdown{font-size:11px;font-weight:700;color:#22d3ee;text-shadow:0 0 8px rgba(34,211,238,0.5);letter-spacing:1px;font-variant-numeric:tabular-nums;margin-left:auto;padding:3px 9px;border:1px solid rgba(34,211,238,0.3);border-radius:3px;background:rgba(34,211,238,0.05);}
            .mbhud-hint{font-size:9px;color:#4a5a6a;margin-top:6px;line-height:1.6;letter-spacing:0.3px;}
            .mbhud-arrow{font-size:11px;color:#4a5a6a;letter-spacing:1px;font-weight:700;}
        `;
        uw.$('<style id="mbhud-styles">').text(css).appendTo('head');
        this._styleInjected = true;
    }

    settings = () => {
        this._injectStyles();
        requestAnimationFrame(() => this._startVisuals());

        const sleeperEnabled = this.storage.load('sleeper_enabled', false);
        const sleeperStart = this.storage.load('sleeper_start', '23:00');
        const sleeperEnd = this.storage.load('sleeper_end', '07:00');

        return `
        <div class="mbhud-root">
            <div class="mbhud-header">
                <h2>◆ SYSTEM MONITOR ◆</h2>
                <div class="sub">BOTGREPO · LAST SYNC · <span class="live" id="mbhud-last-sync">--:--:--</span></div>
            </div>

            <div class="mbhud-section">
                <span class="mbhud-label">SLEEP CYCLE</span>
                <div class="mbhud-flex">
                    <input id="sleeper_start_input" class="mbhud-input" type="time" value="${sleeperStart}" />
                    <span class="mbhud-arrow">→</span>
                    <input id="sleeper_end_input" class="mbhud-input" type="time" value="${sleeperEnd}" />
                    <button id="btn_set_sleeper" class="mbhud-btn" type="button">${this.t('apply')}</button>
                    ${sleeperEnabled ? `<button id="btn_disable_sleeper" class="mbhud-btn btn-danger" type="button">${this.t('sleeper_disable')}</button>` : ''}
                    <span id="sleeper_status" class="mbhud-status"></span>
                </div>
                <div class="mbhud-hint">${this.t('sleeper_desc')}</div>
            </div>

            <div class="mbhud-section">
                <span class="mbhud-label">AUTO-REFRESH</span>
                <div class="mbhud-flex">
                    <input id="refresh_minutes_input" class="mbhud-input" type="number" min="0" max="999"
                        value="${this._refreshMinutes}" placeholder="min" style="width:60px;min-width:60px;" />
                    <span class="mbhud-hint" style="margin:0;">min</span>
                    <button id="btn_set_refresh" class="mbhud-btn" type="button">${this.t('apply')}</button>
                    <span id="refresh_status" class="mbhud-status"></span>
                    <span id="refresh_countdown" class="mbhud-countdown"></span>
                </div>
            </div>

            <div class="mbhud-section">
                <span class="mbhud-label">ACTIVE MODULES</span>
                <div id="status_rows"></div>
            </div>
        </div>`;
    };

    _applySleeper = () => {
        const start = uw.$('#sleeper_start_input').val();
        const end = uw.$('#sleeper_end_input').val();
        if (!start || !end) {
            uw.$('#sleeper_status').text(this.t('sleeper_invalid')).removeClass('on warn').addClass('off');
            return;
        }
        this.storage.save('sleeper_enabled', true);
        this.storage.save('sleeper_start', start);
        this.storage.save('sleeper_end', end);
        this.console.log(`[Sleeper] ${this.t('sleeper_enabled_log', { start, end })}`);
        this._renderSleeperStatus();
        this._refreshSleeperButtons();
    };

    _disableSleeper = () => {
        this.storage.save('sleeper_enabled', false);
        this.console.log('[Sleeper] ' + this.t('sleeper_disabled_log'));
        this._renderSleeperStatus();
        this._refreshSleeperButtons();
    };

    _refreshSleeperButtons() {
        const enabled = this.storage.load('sleeper_enabled', false);
        const $btn = uw.$('#btn_disable_sleeper');
        if (enabled && $btn.length === 0) {
            uw.$('#btn_set_sleeper').after(
                `<button id="btn_disable_sleeper" class="mbhud-btn btn-danger" type="button">${this.t('sleeper_disable')}</button>`
            );
            uw.$('#btn_disable_sleeper').off('click').on('click', this._disableSleeper);
        } else if (!enabled && $btn.length > 0) {
            $btn.remove();
        }
    }

    _renderSleeperStatus() {
        try {
            const $el = uw.$('#sleeper_status');
            if ($el.length === 0) return;
            const enabled = this.storage.load('sleeper_enabled', false);
            if (!enabled) {
                $el.text(this.t('status_disabled')).removeClass('on warn').addClass('off');
                return;
            }
            const sleeping = this.isSleeping();
            const msg = sleeping ? this.t('sleeper_active_now') : this.t('sleeper_scheduled');
            $el.text(msg).removeClass('on off').addClass(sleeping ? 'warn' : 'on');
        } catch (e) {}
    }

    _applyRefresh = () => {
        const val = parseInt(uw.$('#refresh_minutes_input').val(), 10);
        this._clearRefresh();
        if (!val || val <= 0) {
            this._refreshMinutes = 0;
            this.storage.save('refresh_minutes', 0);
            uw.$('#refresh_status').text(this.t('status_disabled')).removeClass('on warn').addClass('off');
            uw.$('#refresh_countdown').text('');
            return;
        }
        this._refreshMinutes = val;
        this.storage.save('refresh_minutes', val);
        this._scheduleRefresh();
        uw.$('#refresh_status').text(this.t('status_reloads_every', { min: val })).removeClass('off warn').addClass('on');
        this.console.log(`[StatusPanel] Auto Refresh: ${val} minuto(s) (± jitter).`);
    };

    _clearRefresh() {
        if (this._refreshTimeoutId) { clearTimeout(this._refreshTimeoutId); this._refreshTimeoutId = null; }
        this._nextRefreshAt = null;
    }

    _scheduleRefresh() {
        this._clearRefresh();
        if (this._refreshMinutes <= 0) return;
        const base = this._refreshMinutes * 60 * 1000;
        const jitter = (Math.random() * 60000) - 30000;
        const ms = Math.max(base + jitter, 10000);
        this._nextRefreshAt = Date.now() + ms;
        this._refreshTimeoutId = setTimeout(() => location.reload(), ms);
    }

    _startVisuals() {
        if (this._interval) clearInterval(this._interval);
        this._render();
        this._bindButtons();
        this._interval = this.createGuardedInterval(() => this._render(), 3000, false);
        if (this._countdownInterval) clearInterval(this._countdownInterval);
        this._countdownInterval = this.createGuardedInterval(() => this._updateCountdown(), 1000, false);
        if (this._refreshMinutes > 0 && this._nextRefreshAt) {
            uw.$('#refresh_status').text(this.t('status_reloads_every', { min: this._refreshMinutes })).removeClass('off warn').addClass('on');
        } else if (this._refreshMinutes > 0) {
            this._scheduleRefresh();
            uw.$('#refresh_status').text(this.t('status_reloads_every', { min: this._refreshMinutes })).removeClass('off warn').addClass('on');
        }
        this._updateCountdown();
        this._renderSleeperStatus();
    }

    _bindButtons() {
        uw.$('#btn_set_sleeper').off('click').on('click', this._applySleeper);
        uw.$('#btn_disable_sleeper').off('click').on('click', this._disableSleeper);
        uw.$('#btn_set_refresh').off('click').on('click', this._applyRefresh);
    }

    _updateCountdown() {
        const $el = uw.$('#refresh_countdown');
        if ($el.length === 0) return;
        if (!this._nextRefreshAt) { $el.text(''); return; }
        const remaining = Math.max(0, this._nextRefreshAt - Date.now());
        const totalSec = Math.floor(remaining / 1000);
        const mm = Math.floor(totalSec / 60).toString().padStart(2, '0');
        const ss = (totalSec % 60).toString().padStart(2, '0');
        $el.text(`⏱ ${mm}:${ss}`);
    }

    _render() {
        try {
            const bot  = uw.botGrepo || uw.multBot;
            const rows = [];

            const now = new Date();
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            const ss = String(now.getSeconds()).padStart(2, '0');
            uw.$('#mbhud-last-sync').text(`${hh}:${mm}:${ss}`);

            const farmActive    = !!bot.autoFarm?.active;
            const ruralActive   = !!bot.autoRuralLevel?.enable;
            const buildCount    = Object.keys(bot.autoBuild?.towns_buildings ?? {}).length;
            const trainCount    = Object.keys(bot.autoTrain?.city_troops ?? {}).length;
            const partyActive   = !!bot.autoParty?.enable;
            const cel           = this._countCelebrations();
            const celStr        = [cel.party && `${cel.party} ${this.t('label_party')}`, cel.theater && `${cel.theater} ${this.t('label_theater')}`, cel.triumph && `${cel.triumph} ${this.t('label_triumph')}`].filter(Boolean).join(' · ') || '—';
            const gratisActive  = !!bot.autoGratis?.autogratis;
            const cssActive     = !!bot.colonizeShipSender?._running;
            const asrActive     = !!bot.autoSendResources?._active;
            const militiaActive = !!bot.autoMilitia?._active;
            const hideActive    = !!bot.autoHide?._active;
            const questActive   = !!bot.autoQuest?._active;
            const discordActive = !!bot.discordAlert?._active;
            const sniperPending = (bot.sniper?._scheduled ?? []).filter(s => s.status === 'pending').length;
            const attackActive  = !!bot.autoAttack?._active;
            const dodgeActive   = !!bot.autoDodge?._active;
            const aresActive    = !!bot.autoAresSacrifice?._active;
            const researchActive= !!bot.autoResearch?._active;

            rows.push(this._row(this.t('row_farm'),           farmActive,  farmActive  ? this.t('active')               : this.t('stopped'),             'autoFarm',           'toggle'));
            rows.push(this._row(this.t('row_rural'),          ruralActive, ruralActive ? this.t('level_label', { n: bot.autoRuralLevel.rural_level }) : this.t('stopped'), 'autoRuralLevel', 'toggle'));
            rows.push(this._row(this.t('row_build'),          buildCount > 0, buildCount > 0 ? this.t('cities_count', { n: buildCount }) : this.t('no_city'), null, null));
            rows.push(this._row(this.t('row_train'),          trainCount > 0, trainCount > 0 ? this.t('cities_count', { n: trainCount }) : this.t('no_city'), null, null));
            rows.push(this._row(this.t('row_party'),          partyActive, partyActive ? celStr : this.t('stopped'),     'autoParty',          'toggle'));
            rows.push(this._row(this.t('row_free_build'),     gratisActive, gratisActive ? this.t('active') : this.t('stopped'), 'autoGratis',          'toggle'));
            rows.push(this._row(this.t('row_send_resources'), asrActive,   asrActive   ? this.t('active') : this.t('stopped'),   'autoSendResources',  'toggle'));
            rows.push(this._row(this.t('row_militia'),        militiaActive, militiaActive ? this.t('active') : this.t('stopped'), 'autoMilitia', militiaActive ? 'stop' : 'start'));
            rows.push(this._row(this.t('row_colonize_ship'),  cssActive,   cssActive   ? `→ ${this.getTownName(bot.colonizeShipSender.config.targetTownId)}` : this.t('stopped'), 'colonizeShipSender', cssActive ? 'stop' : 'start'));
            rows.push(this._row(this.t('row_attack'),         attackActive,   attackActive   ? this.t('active') : this.t('stopped'), 'autoAttack',        'toggle'));
            rows.push(this._row(this.t('row_dodge'),          dodgeActive,    dodgeActive    ? this.t('active') : this.t('stopped'), 'autoDodge',         'toggle'));
            rows.push(this._row(this.t('row_ares'),           aresActive,     aresActive     ? this.t('active') : this.t('stopped'), 'autoAresSacrifice', 'toggle'));
            rows.push(this._row(this.t('row_research'),       researchActive, researchActive ? this.t('active') : this.t('stopped'), 'autoResearch',      'toggle'));
            rows.push(this._row(this.t('row_hide'),           hideActive,    hideActive    ? this.t('active') : this.t('stopped'),                'autoHide',          'toggle'));
            rows.push(this._row(this.t('row_quest'),          questActive,   questActive   ? this.t('active') : this.t('stopped'),                'autoQuest',         'toggle'));
            rows.push(this._row(this.t('row_discord'),        discordActive, discordActive ? this.t('active') : this.t('stopped'),                'discordAlert',      'toggle'));
            rows.push(this._row(this.t('row_sniper'),         sniperPending > 0, sniperPending > 0 ? this.t('row_sniper_pending', { n: sniperPending }) : this.t('stopped'), null, null));

            uw.$('#status_rows').html(rows.join(''));
            this._renderSleeperStatus();
        } catch(e) {
            uw.$('#status_rows').html(`<div style="padding:8px;color:#f87171;font-size:11px;">${this.t('error')}: ${e.message}</div>`);
        }
    }

    _row(label, active, value, module, method) {
        const onclick = module && method ? `window.botGrepo.${module}.${method}()` : null;
        const ledClass = active ? 'on' : 'off';
        const btnHtml = onclick
            ? `<button class="mbhud-pill ${active ? 'on' : 'off'}" type="button" onclick="${onclick}">${active ? this.t('active') : this.t('stopped')}</button>`
            : `<span class="mbhud-status ${active ? 'on' : 'off'}">${active ? '● ' + this.t('active') : '○ —'}</span>`;
        return `
        <div class="mbhud-row">
            <div class="mbhud-row-name">
                <span class="mbhud-led ${ledClass}"></span>
                <span>${label}</span>
            </div>
            <span class="mbhud-row-value ${active ? 'hot' : ''}">${value}</span>
            ${btnHtml}
        </div>`;
    }

    _countCelebrations() {
        const result = { party: 0, theater: 0, triumph: 0 };
        try {
            const models = uw.MM.getModels().Celebration;
            if (!models) return result;
            for (const key in models) {
                const type = models[key].attributes.celebration_type;
                if (type in result) result[type]++;
            }
        } catch(e) {}
        return result;
    }
};
