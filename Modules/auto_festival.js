// ══════════════════════════════════════════════════════
//  MODULE: AutoFestival v1.0.0
//  Porta o "Auto Festival de Recursos" para o MultBot.
//
//  O que faz:
//   • Lista cidades com Academia ≥ 30
//   • Prioriza cidades SEM festival ativo
//   • Envia recursos de doadores (cidades com sobra)
//   • Rastreia recursos pendentes (atuais + pendentes)
//   • Quando atinge 🪵15k 🪨18k ⚙15k → inicia festival (party)
//   • Auto-para quando não há mais cidades precisando
// ══════════════════════════════════════════════════════
var AutoFestival = class extends MultUtil {
    VERSION = '1.0.0';
    PREFIX = '[AutoFestival]';

    CONFIG = Object.freeze({
        cost: { wood: 15000, stone: 18000, iron: 15000 },
        intervalMs: 30000,
        pendingTimeoutMs: 120000,
        donorMinResource: 500,
        donorFraction: 0.6,
        minSendTotal: 100,
        logLimit: 80,
        academyMinLevel: 30,
    });

    STORAGE_KEY_PENDING = 'festival_pending';
    STORAGE_KEY_ACTIVE  = 'festival_active';
    STORAGE_KEY_LOGS    = 'festival_logs';

    _active = false;
    _intervalId = null;
    _sendingQueue = {};
    _lastStatusUpdate = 0;

    constructor(c, s) {
        super(c, s);
        if (this.storage.load(this.STORAGE_KEY_ACTIVE, false)) {
            setTimeout(() => { if (!this._active) this.start(); }, 3000);
        }
    }

    // ══════════════════════════════════════════════════
    //  UI
    // ══════════════════════════════════════════════════

    settings = () => {
        requestAnimationFrame(() => this._refreshUI());
        return (
            '<div class="game_border" style="margin-bottom:20px;">' +
            '<div class="game_border_top"></div><div class="game_border_bottom"></div>' +
            '<div class="game_border_left"></div><div class="game_border_right"></div>' +
            '<div class="game_border_corner corner1"></div><div class="game_border_corner corner2"></div>' +
            '<div class="game_border_corner corner3"></div><div class="game_border_corner corner4"></div>' +
            this.getTitleHtml('ff_title', 'Auto Festival de Recursos', this.toggle, '', this._active) +
            '<div style="padding:5px 10px;font-size:11px;color:#5a3a0a;line-height:1.5;">' +
            'Lista cidades com <b>Academia ≥ 30</b>. Envia recursos automaticamente para a primeira cidade que precisa, ' +
            'priorizando cidades <b>sem festival ativo</b>. Rastreia recursos enviados para evitar envios em excesso. ' +
            'Quando a cidade atinge <b>🪵15k 🪨18k ⚙15k</b> (atuais + enviados), o festival é iniciado. Para sozinho quando ' +
            'não há mais cidades precisando.' +
            '</div>' +
            '<div id="ff_status" style="padding:4px 10px;font-size:11px;color:#5a3a0a;font-weight:bold;">' +
            this._buildStatusHtml() +
            '</div>' +
            '<div class="dg-section-title" style="margin:4px 10px 0;">Cidades elegíveis (recursos atuais / pendentes)</div>' +
            '<div id="ff_town_list" style="padding:2px 10px;max-height:180px;overflow-y:auto;font-size:11px;">' +
            this._buildTownListHtml() +
            '</div>' +
            '<div class="dg-section-title" style="margin:6px 10px 0;">Registo</div>' +
            '<div id="ff_log" style="padding:4px 10px 8px;font-size:11px;color:#5a3a0a;max-height:100px;overflow-y:auto;line-height:1.5;">' +
            this._buildLogHtml() +
            '</div>' +
            '</div>'
        );
    };

    toggle = () => {
        if (this._active) this.stop();
        else this.start();
    };

    start() {
        if (this._active) return;
        this._active = true;
        this.storage.save(this.STORAGE_KEY_ACTIVE, true);
        this._log('🎉 Iniciado. A monitorizar cidades para festivais...');
        this._refreshUI();
        this._main();
        this._intervalId = setInterval(() => {
            this._main().catch(e => this._log(`Erro ciclo: ${e?.message ?? e}`));
        }, this.CONFIG.intervalMs);
    }

    stop() {
        if (!this._active) return;
        this._active = false;
        this.storage.save(this.STORAGE_KEY_ACTIVE, false);
        if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
        this._log('Parado.');
        this._refreshUI();
    }

    _refreshUI() {
        requestAnimationFrame(() => {
            const filter = this._active ? 'brightness(100%) saturate(186%) hue-rotate(241deg)' : '';
            try { uw.$('#ff_title').css('filter', filter); } catch (e) {}

            const $status = uw.$('#ff_status');
            if ($status.length) $status.html(this._buildStatusHtml());

            const $list = uw.$('#ff_town_list');
            if ($list.length) $list.html(this._buildTownListHtml());

            const $log = uw.$('#ff_log');
            if ($log.length) $log.html(this._buildLogHtml());
        });
    }

    _log(message, level = 'info') {
        try { this.console.log(`${this.PREFIX} ${message}`); } catch (e) {}

        try {
            const logs = this.storage.load(this.STORAGE_KEY_LOGS, []);
            logs.unshift({ at: Date.now(), level, message });
            this.storage.save(this.STORAGE_KEY_LOGS, logs.slice(0, this.CONFIG.logLimit));
        } catch (e) {}

        try {
            const $log = uw.$('#ff_log');
            if ($log.length) $log.html(this._buildLogHtml());
        } catch (e) {}
    }

    _buildLogHtml() {
        const logs = this.storage.load(this.STORAGE_KEY_LOGS, []);
        if (!logs.length) return '<div style="color:#888;font-size:10px;text-align:center;padding:4px;">Sem registos.</div>';
        const colors = { error: '#8B0000', warn: '#8B6914', ok: '#2E5A1C', info: '#5a3a0a' };
        return logs.map(e => {
            const d = new Date(e.at);
            const ts = ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2)+':'+('0'+d.getSeconds()).slice(-2);
            const color = colors[e.level] || colors.info;
            const msg = String(e.message).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
            return `<div style="color:${color};"><span style="color:#888;">${ts}</span> ${msg}</div>`;
        }).join('');
    }

    _buildStatusHtml() {
        const towns = this._scanTowns();
        const total = towns.length;
        const active = towns.filter(t => this._hasActiveFestival(t.id)).length;
        const ready = towns.filter(t => !this._hasActiveFestival(t.id) && this._hasEnoughResources(t.id)).length;
        const waiting = towns.filter(t => !this._hasActiveFestival(t.id) && !this._hasEnoughResources(t.id)).length;
        const pending = this._loadPending();
        const pendingCount = Object.keys(pending).filter(tid =>
            this._canDoFestival(tid) && !this._hasActiveFestival(tid)
        ).length;

        const state = this._active
            ? '<span style="color:#2E5A1C;font-weight:bold;">Ativo</span>'
            : '<span style="color:#888;">Parado</span>';

        return state +
            ` · <span style="color:#2E5A1C;">${total}</span> elegíveis` +
            ` · <span style="color:#1E3A5F;">${active}</span> c/ festival` +
            ` · <span style="color:#2E5A1C;">${ready}</span> prontas` +
            ` · <span style="color:#8B6914;">${waiting}</span> a aguardar` +
            ` · <span style="color:#1E3A5F;">${pendingCount}</span> pendentes`;
    }

    _buildTownListHtml() {
        const towns = this._scanTowns();
        if (!towns.length) {
            return '<div style="color:#888;font-size:10px;text-align:center;padding:8px;">Nenhuma cidade com Academia ≥ 30.</div>';
        }

        return towns.map(t => {
            const tid = t.id;
            const hasActive = this._hasActiveFestival(tid);
            const totalRes = this._getTotalResources(tid);
            const currentRes = this._getResources(tid);
            const pending = this._loadPending()[tid];

            const hasResources = totalRes && totalRes.wood >= this.CONFIG.cost.wood &&
                                 totalRes.stone >= this.CONFIG.cost.stone &&
                                 totalRes.iron >= this.CONFIG.cost.iron;

            const status = hasActive
                ? { text: '🎉 Festival Ativo', color: '#1E3A5F', bg: '#B8D4F0', border: '#3A5A8A' }
                : hasResources
                    ? { text: '✅ Pronto', color: '#2E5A1C', bg: '#C8E6C9', border: '#4A8A3A' }
                    : { text: '⏳ Precisa recursos', color: '#8B6914', bg: '#FFE0A0', border: '#B8860B' };

            const resText = currentRes
                ? `🪵${Math.floor(currentRes.wood)} 🪨${Math.floor(currentRes.stone)} ⚙${Math.floor(currentRes.iron)}`
                : '—';
            const pendingText = pending
                ? ` <span style="color:#888;">(+${Math.floor(pending.wood)}/${Math.floor(pending.stone)}/${Math.floor(pending.iron)} env)</span>`
                : '';
            const star = (!hasActive && !hasResources) ? '⭐ ' : '';
            const safe = String(t.name).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));

            return '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 4px;border-bottom:1px solid #E8D4A0;font-size:11px;">' +
                '<div><span style="color:#B8860B;font-weight:900;">' + star + '</span>' +
                '<span style="color:#3D2B1F;font-weight:700;">' + safe + '</span></div>' +
                '<div style="display:flex;align-items:center;gap:6px;">' +
                '<span style="color:#6B5B4F;font-size:10px;">' + resText + pendingText + '</span>' +
                '<span style="font-size:9px;color:' + status.color + ';background:' + status.bg + ';border:1px solid ' + status.border + ';padding:1px 6px;border-radius:3px;">' + status.text + '</span>' +
                '</div>' +
                '</div>';
        }).join('');
    }

    // ══════════════════════════════════════════════════
    //  PERSISTÊNCIA
    // ══════════════════════════════════════════════════

    _loadPending() { return this.storage.load(this.STORAGE_KEY_PENDING, {}); }
    _savePending(p) { this.storage.save(this.STORAGE_KEY_PENDING, p); }

    // ══════════════════════════════════════════════════
    //  GREPOLIS HELPERS
    // ══════════════════════════════════════════════════

    _getAllTowns() {
        try {
            const models = uw.MM.getOnlyCollectionByName('Town').models;
            return models.map(m => ({
                id: String(m.attributes.id),
                name: m.attributes.name || ('Cidade ' + m.attributes.id),
            }));
        } catch (e) { return []; }
    }

    _canDoFestival(tid) {
        try {
            const town = uw.ITowns.towns[tid];
            if (!town) return false;
            const buildings = town.getBuildings().attributes;
            return Boolean(buildings.academy && buildings.academy >= this.CONFIG.academyMinLevel);
        } catch (e) { return false; }
    }

    _hasActiveFestival(tid) {
        try {
            const celebrations = uw.MM.getModels().Celebration;
            if (!celebrations) return false;
            for (const k in celebrations) {
                const c = celebrations[k].attributes;
                if (c.celebration_type === 'party' && String(c.town_id) === String(tid)) return true;
            }
            return false;
        } catch (e) { return false; }
    }

    _getResources(tid) {
        try {
            const town = uw.ITowns.towns[tid];
            if (!town) return null;
            const r = town.resources();
            return { wood: r.wood || 0, stone: r.stone || 0, iron: r.iron || 0 };
        } catch (e) { return null; }
    }

    _getTotalResources(tid) {
        const current = this._getResources(tid);
        if (!current) return null;
        const pending = this._loadPending()[tid] || { wood: 0, stone: 0, iron: 0 };
        return {
            wood: current.wood + pending.wood,
            stone: current.stone + pending.stone,
            iron: current.iron + pending.iron,
        };
    }

    _hasEnoughResources(tid) {
        const t = this._getTotalResources(tid);
        if (!t) return false;
        const c = this.CONFIG.cost;
        return t.wood >= c.wood && t.stone >= c.stone && t.iron >= c.iron;
    }

    _checkAndClearPending(tid) {
        const current = this._getResources(tid);
        if (!current) return false;
        const c = this.CONFIG.cost;
        if (current.wood >= c.wood && current.stone >= c.stone && current.iron >= c.iron) {
            const pending = this._loadPending();
            if (pending[tid]) {
                this._log('✓ ' + this.getTownName(tid) + ' recebeu tudo. Pendências limpas.', 'ok');
                delete pending[tid];
                this._savePending(pending);
            }
            return true;
        }
        return false;
    }

    _cleanPending() {
        const pending = this._loadPending();
        const now = Date.now();
        let dirty = false;
        for (const tid in pending) {
            if (now - (pending[tid].timestamp || 0) > this.CONFIG.pendingTimeoutMs) {
                this._log('⏰ Pendências de ' + this.getTownName(tid) + ' expiradas.');
                delete pending[tid];
                dirty = true;
            }
        }
        if (dirty) this._savePending(pending);
    }

    // ══════════════════════════════════════════════════
    //  TRIAGEM / ORDENAÇÃO
    // ══════════════════════════════════════════════════

    _anyCityNeedsResources() {
        const all = this._getAllTowns();
        for (const t of all) {
            if (!this._canDoFestival(t.id)) continue;
            if (this._hasActiveFestival(t.id)) continue;
            if (this._hasEnoughResources(t.id)) continue;
            return true;
        }
        return false;
    }

    _scanTowns() {
        this._cleanPending();
        const all = this._getAllTowns();
        const eligible = all.filter(t => this._canDoFestival(t.id));

        eligible.sort((a, b) => {
            const aScore = this._hasActiveFestival(a.id) ? 2 : (this._hasEnoughResources(a.id) ? 1 : 0);
            const bScore = this._hasActiveFestival(b.id) ? 2 : (this._hasEnoughResources(b.id) ? 1 : 0);
            if (aScore !== bScore) return aScore - bScore;
            return a.name.localeCompare(b.name);
        });
        return eligible;
    }

    _getTargetTown() {
        const towns = this._scanTowns();
        const pending = this._loadPending();
        let dirty = false;

        for (const t of towns) {
            const tid = t.id;
            if (this._hasActiveFestival(tid)) {
                if (pending[tid]) { delete pending[tid]; dirty = true; }
                continue;
            }
            if (this._checkAndClearPending(tid)) continue;
            if (this._hasEnoughResources(tid)) continue;
            if (this._sendingQueue[tid]) continue;
            if (dirty) this._savePending(pending);
            return tid;
        }
        if (dirty) this._savePending(pending);
        return null;
    }

    _getDonorTowns(targetId) {
        const all = this._getAllTowns();
        const donors = [];
        for (const t of all) {
            const tid = t.id;
            if (tid === targetId) continue;
            if (this._hasActiveFestival(tid)) continue;
            if (this._canDoFestival(tid) && !this._hasEnoughResources(tid)) continue;

            const res = this._getResources(tid);
            if (!res) continue;
            if (res.wood < this.CONFIG.donorMinResource &&
                res.stone < this.CONFIG.donorMinResource &&
                res.iron < this.CONFIG.donorMinResource) continue;
            donors.push(tid);
        }
        return donors;
    }

    // ══════════════════════════════════════════════════
    //  AJAX
    // ══════════════════════════════════════════════════

    _sendResources(fromTownId, toTownId, amount) {
        return new Promise(resolve => {
            const data = {
                id: parseInt(toTownId, 10),
                wood: amount.wood || 0,
                stone: amount.stone || 0,
                iron: amount.iron || 0,
                town_id: parseInt(fromTownId, 10),
                nl_init: true,
            };
            const timer = setTimeout(() => resolve(false), 15000);
            try {
                uw.gpAjax.ajaxPost('town_info', 'trade', data, false,
                    (res) => {
                        clearTimeout(timer);
                        resolve(Boolean(res && !res.error));
                    },
                    () => { clearTimeout(timer); resolve(false); }
                );
            } catch (e) { clearTimeout(timer); resolve(false); }
        });
    }

    // ══════════════════════════════════════════════════
    //  MAIN
    // ══════════════════════════════════════════════════

    async _main() {
        if (!this._active) return;
        if (uw.$('.botcheck').length || uw.$('#recaptcha_window').length) return;

        try {
            // 1) Limpa pendências em todas as cidades
            const allTowns = this._getAllTowns();
            for (const t of allTowns) this._checkAndClearPending(t.id);

            // 2) Verifica se ainda há cidades precisando
            if (!this._anyCityNeedsResources()) {
                this._log('🎉 Todas as cidades elegíveis têm festival ativo ou recursos suficientes. A parar.');
                this._refreshUI();
                this.stop();
                return;
            }

            const targetId = this._getTargetTown();
            if (!targetId) {
                this._log('Nenhuma cidade precisa de recursos neste momento.');
                this._refreshUI();
                return;
            }

            const targetName = this.getTownName(targetId);
            const totalRes = this._getTotalResources(targetId);
            const deficit = {
                wood: Math.max(0, this.CONFIG.cost.wood - totalRes.wood),
                stone: Math.max(0, this.CONFIG.cost.stone - totalRes.stone),
                iron: Math.max(0, this.CONFIG.cost.iron - totalRes.iron),
            };
            let totalDeficit = deficit.wood + deficit.stone + deficit.iron;

            if (totalDeficit <= 0) {
                this._log(targetName + ' já tem recursos suficientes.', 'ok');
                const pending = this._loadPending();
                if (pending[targetId]) { delete pending[targetId]; this._savePending(pending); }
                this._refreshUI();
                return;
            }

            this._sendingQueue[targetId] = true;

            const donors = this._getDonorTowns(targetId);
            if (!donors.length) {
                this._log('Sem cidades com recursos para enviar para ' + targetName, 'error');
                delete this._sendingQueue[targetId];
                this._refreshUI();
                return;
            }

            donors.sort(() => Math.random() - 0.5);

            let sent = false;
            const totalSent = { wood: 0, stone: 0, iron: 0 };

            for (const donorId of donors) {
                if (totalDeficit <= 0) break;

                const donorRes = this._getResources(donorId);
                if (!donorRes) continue;

                // Recalcula déficit
                const currentTotal = this._getTotalResources(targetId);
                deficit.wood = Math.max(0, this.CONFIG.cost.wood - currentTotal.wood);
                deficit.stone = Math.max(0, this.CONFIG.cost.stone - currentTotal.stone);
                deficit.iron = Math.max(0, this.CONFIG.cost.iron - currentTotal.iron);
                totalDeficit = deficit.wood + deficit.stone + deficit.iron;
                if (totalDeficit <= 0) break;

                const sendAmount = {
                    wood: Math.min(Math.floor(donorRes.wood * this.CONFIG.donorFraction), deficit.wood),
                    stone: Math.min(Math.floor(donorRes.stone * this.CONFIG.donorFraction), deficit.stone),
                    iron: Math.min(Math.floor(donorRes.iron * this.CONFIG.donorFraction), deficit.iron),
                };
                const totalSend = sendAmount.wood + sendAmount.stone + sendAmount.iron;
                if (totalSend < this.CONFIG.minSendTotal) continue;

                const ok = await this._sendResources(donorId, targetId, sendAmount);
                if (ok) {
                    const pending = this._loadPending();
                    if (!pending[targetId]) {
                        pending[targetId] = { wood: 0, stone: 0, iron: 0, timestamp: Date.now() };
                    }
                    pending[targetId].wood += sendAmount.wood;
                    pending[targetId].stone += sendAmount.stone;
                    pending[targetId].iron += sendAmount.iron;
                    pending[targetId].timestamp = Date.now();
                    this._savePending(pending);

                    totalSent.wood += sendAmount.wood;
                    totalSent.stone += sendAmount.stone;
                    totalSent.iron += sendAmount.iron;

                    this._log(`✓ ${this.getTownName(donorId)} → ${targetName} | 🪵${sendAmount.wood} 🪨${sendAmount.stone} ⚙${sendAmount.iron}`, 'ok');
                    sent = true;

                    await this._randomDelay(800, 400);
                } else {
                    this._log('✗ Falha ao enviar de ' + this.getTownName(donorId), 'error');
                }
            }

            // Verifica resultado final
            const finalTotal = this._getTotalResources(targetId);
            if (finalTotal && finalTotal.wood >= this.CONFIG.cost.wood &&
                finalTotal.stone >= this.CONFIG.cost.stone &&
                finalTotal.iron >= this.CONFIG.cost.iron) {
                this._log('🎯 ' + targetName + ' tem recursos suficientes! A aguardar chegada.', 'ok');
            } else if (sent) {
                this._log(`📦 Enviados para ${targetName}: 🪵${totalSent.wood} 🪨${totalSent.stone} ⚙${totalSent.iron}`);
            }

            delete this._sendingQueue[targetId];
            this._refreshUI();

        } catch (e) {
            this._log('Erro no ciclo: ' + (e?.message ?? e), 'error');
            for (const tid in this._sendingQueue) delete this._sendingQueue[tid];
        }
    }

    _randomDelay(base, variation) {
        const ms = base + (Math.random() * variation * 2 - variation);
        return new Promise(r => setTimeout(r, Math.max(50, ms)));
    }
};