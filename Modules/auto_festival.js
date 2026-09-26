// ═══════════════════════════════════════════════════════
// MODULE: AutoFestival v1.4.2 (Correção Crítica: Bloqueio de Doação por Recetores)
// ═══════════════════════════════════════════════════════

var AutoFestival = class extends MultUtil {
    VERSION = '1.4.2';
    PREFIX = '[AutoFestival]';

    CONFIG = Object.freeze({
        cost: { wood: 15000, stone: 18000, iron: 15000 },
        intervalMs: 30000,
        pendingTimeoutMs: 120000,
        donorMinResource: 100,      // Mínimo absoluto para considerar como doador
        donorFixedAmount: 500,      // ENVIA EXATAMENTE ATÉ 500 de cada recurso por viagem
        minSendTotal: 150,          // Mínimo total de recursos por envio (evita viagens inúteis)
        logLimit: 80,
        academyMinLevel: 30,
    });

    STORAGE_KEY_PENDING = 'festival_pending';
    STORAGE_KEY_ACTIVE  = 'festival_active';
    STORAGE_KEY_LOGS    = 'festival_logs';

    _active = false;
    _intervalId = null;
    _sendingQueue = {};

    constructor(c, s) {
        super(c, s);
        if (this.storage.load(this.STORAGE_KEY_ACTIVE, false)) {
            setTimeout(() => { if (!this._active) this.start(); }, 3000);
        }
    }

    _injectStyles() {
        if (uw.$('#mbhud-festival-styles').length) return;
        const css = `
            @keyframes mbhudf-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.55; transform: scale(1.25); } }
            @keyframes mbhudf-scan { 0% { background-position: 200% 0%; } 100% { background-position: -200% 0%; } }
            @keyframes mbhudf-fade { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: translateY(0); } }
            .mbhudf-root { background: linear-gradient(135deg, #060816 0%, #0a1020 50%, #060816 100%); border: 1px solid rgba(34,211,238,0.35); border-radius: 6px; padding: 12px; font-family: 'SF Mono','Consolas',monospace; color: #a8b8d0; box-shadow: 0 0 24px rgba(34,211,238,0.15); position: relative; overflow: hidden; animation: mbhudf-fade 0.35s ease; margin-bottom: 20px; }
            .mbhudf-root::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, transparent, #22d3ee, transparent); background-size: 200% 100%; animation: mbhudf-scan 3.5s linear infinite; pointer-events: none; }
            .mbhudf-header { text-align: center; padding: 4px 0 12px; border-bottom: 1px solid rgba(34,211,238,0.2); margin-bottom: 12px; }
            .mbhudf-header h2 { margin: 0; font-size: 14px; letter-spacing: 6px; text-transform: uppercase; color: #22d3ee; text-shadow: 0 0 12px rgba(34,211,238,0.7); font-weight: 700; }
            .mbhudf-header .sub { font-size: 9px; color: #4a5a6a; letter-spacing: 3px; margin-top: 5px; text-transform: uppercase; }
            .mbhudf-header .sub .live { color: #00ff88; text-shadow: 0 0 8px rgba(0,255,136,0.6); font-variant-numeric: tabular-nums; }
            .mbhudf-section { background: rgba(10,16,32,0.6); border: 1px solid rgba(34,211,238,0.2); border-radius: 4px; padding: 10px 12px; margin-bottom: 10px; }
            .mbhudf-label { display: block; font-size: 9px; letter-spacing: 2.5px; text-transform: uppercase; color: #22d3ee; margin-bottom: 8px; font-weight: 700; }
            .mbhudf-label::before { content: '▸ '; opacity: 0.7; }
            .mbhudf-desc { font-size: 10px; color: #6a7a8a; line-height: 1.7; }
            .mbhudf-desc b { color: #22d3ee; font-weight: 700; }
            .mbhudf-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 6px; }
            .mbhudf-stat { background: rgba(0,0,0,0.35); border: 1px solid rgba(34,211,238,0.18); border-radius: 4px; padding: 6px 8px; text-align: center; }
            .mbhudf-stat .n { font-size: 18px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; text-shadow: 0 0 8px currentColor; }
            .mbhudf-stat .t { font-size: 8px; letter-spacing: 2px; text-transform: uppercase; color: #5a6a7a; margin-top: 2px; }
            .mbhudf-stat.on .n { color: #00ff88; } .mbhudf-stat.info .n { color: #22d3ee; } .mbhudf-stat.warn .n { color: #ffb020; } .mbhudf-stat.pend .n { color: #a78bfa; }
            .mbhudf-townlist { max-height: 220px; overflow-y: auto; border-radius: 4px; background: rgba(0,0,0,0.25); border: 1px solid rgba(34,211,238,0.12); padding: 2px; }
            .mbhudf-town { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid rgba(34,211,238,0.08); font-size: 11px; }
            .mbhudf-town:last-child { border-bottom: none; }
            .mbhudf-town .star { color: #ffb020; font-size: 12px; width: 12px; text-align: center; flex-shrink: 0; }
            .mbhudf-town .name { color: #e8f0ff; font-weight: 700; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .mbhudf-town .res { color: #6a7a8a; font-size: 10px; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .mbhudf-town .res .pend { color: #a78bfa; margin-left: 3px; }
            .mbhudf-pill { padding: 3px 9px; border-radius: 12px; font-size: 8px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; border: 1px solid; white-space: nowrap; flex-shrink: 0; }
            .mbhudf-pill.ready { background: rgba(0,255,136,0.12); border-color: rgba(0,255,136,0.5); color: #00ff88; }
            .mbhudf-pill.active { background: rgba(34,211,238,0.14); border-color: rgba(34,211,238,0.55); color: #22d3ee; animation: mbhudf-pulse 2s ease-in-out infinite; }
            .mbhudf-pill.waiting { background: rgba(255,176,32,0.10); border-color: rgba(255,176,32,0.45); color: #ffb020; }
            .mbhudf-led { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.08); }
            .mbhudf-led.ready { background: #00ff88; box-shadow: 0 0 8px #00ff88; animation: mbhudf-pulse 2s ease-in-out infinite; }
            .mbhudf-led.active { background: #22d3ee; box-shadow: 0 0 8px #22d3ee; animation: mbhudf-pulse 1.4s ease-in-out infinite; }
            .mbhudf-led.waiting { background: #ffb020; box-shadow: 0 0 8px #ffb020; animation: mbhudf-pulse 1.8s ease-in-out infinite; }
            .mbhudf-log { font-size: 10px; line-height: 1.7; max-height: 120px; overflow-y: auto; background: rgba(0,0,0,0.35); border: 1px solid rgba(34,211,238,0.12); border-radius: 4px; padding: 6px 8px; }
            .mbhudf-log .ln { display: flex; gap: 6px; }
            .mbhudf-log .ts { color: #4a5a6a; font-variant-numeric: tabular-nums; flex-shrink: 0; }
            .mbhudf-log .msg { flex: 1; word-break: break-word; }
            .mbhudf-log .ln.info .msg { color: #a8b8d0; }
            .mbhudf-log .ln.ok .msg { color: #00ff88; }
            .mbhudf-log .ln.warn .msg { color: #ffb020; }
            .mbhudf-log .ln.error .msg { color: #f87171; }
            .mbhudf-empty { text-align: center; color: #4a5a6a; font-size: 10px; padding: 12px 8px; font-style: italic; }
        `;
        uw.$('<style id="mbhud-festival-styles">').text(css).appendTo('head');
    }

    settings = () => {
        this._injectStyles();
        requestAnimationFrame(() => this._refreshUI());
        return (
            '<div class="game_border" style="margin-bottom:20px;">' +
            '<div class="game_border_top"></div><div class="game_border_bottom"></div>' +
            '<div class="game_border_left"></div><div class="game_border_right"></div>' +
            '<div class="game_border_corner corner1"></div><div class="game_border_corner corner2"></div>' +
            '<div class="game_border_corner corner3"></div><div class="game_border_corner corner4"></div>' +
            this.getTitleHtml('ff_title', 'Auto Festival de Recursos', this.toggle, '', this._active) +
            '<div class="mbhudf-root">' +
                '<div class="mbhudf-header">' +
                    '<h2>◆ FESTIVAL ENGINE ◆</h2>' +
                    '<div class="sub">500 FIXOS POR VIAGEM · <span class="live" id="ff-live-sync">--:--:--</span></div>' +
                '</div>' +
                '<div class="mbhudf-section">' +
                    '<span class="mbhudf-label">Protocolo de Prioridade Única</span>' +
                    '<div class="mbhudf-desc">' +
                        '1. Foca na <b>1ª cidade</b> da fila sem festival e sem recursos.<br>' +
                        '2. <b>Todas as doadoras</b> enviam remessas de <b>até 500 fixos</b>.<br>' +
                        '3. <b>PROTEÇÃO ANTI-LOOP:</b> Cidades que recebem recursos estão <b>BLOQUEADAS</b> para doar.<br>' +
                        '4. Só avança para a 2ª cidade quando a 1ª atingir <b>🪵15k · 🪨18k · ⚙15k</b>.<br>' +
                        '5. Limpeza automática de pendências ao atingir a meta.' +
                    '</div>' +
                '</div>' +
                '<div class="mbhudf-section">' +
                    '<span class="mbhudf-label">Telemetria</span>' +
                    '<div class="mbhudf-stats" id="ff_status">' + this._buildStatusHtml() + '</div>' +
                '</div>' +
                '<div class="mbhudf-section">' +
                    '<span class="mbhudf-label">Cidades Elegíveis</span>' +
                    '<div class="mbhudf-townlist" id="ff_town_list">' + this._buildTownListHtml() + '</div>' +
                '</div>' +
                '<div class="mbhudf-section">' +
                    '<span class="mbhudf-label">Registo de Operações</span>' +
                    '<div class="mbhudf-log" id="ff_log">' + this._buildLogHtml() + '</div>' +
                '</div>' +
            '</div>' +
            '</div>'
        );
    };

    toggle = () => { if (this._active) this.stop(); else this.start(); };

    start() {
        if (this._active) return;
        this._active = true;
        this.storage.save(this.STORAGE_KEY_ACTIVE, true);
        this._log('🎉 Iniciado. Modo de prioridade única (500 fixos + anti-loop) ativado.', 'ok');
        this._refreshUI();
        this._main();
        this._intervalId = setInterval(() => {
            this._main().catch(e => this._log(`Erro ciclo: ${e?.message ?? e}`, 'error'));
        }, this.CONFIG.intervalMs);
    }

    stop() {
        if (!this._active) return;
        this._active = false;
        this.storage.save(this.STORAGE_KEY_ACTIVE, false);
        if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
        this._log('Parado.', 'warn');
        this._refreshUI();
    }

    _refreshUI() {
        requestAnimationFrame(() => {
            const filter = this._active ? 'brightness(100%) saturate(186%) hue-rotate(241deg)' : '';
            try { uw.$('#ff_title').css('filter', filter); } catch (e) {}
            const now = new Date();
            try { uw.$('#ff-live-sync').text(`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`); } catch (e) {}
            const $status = uw.$('#ff_status'); if ($status.length) $status.html(this._buildStatusHtml());
            const $list = uw.$('#ff_town_list'); if ($list.length) $list.html(this._buildTownListHtml());
            const $log = uw.$('#ff_log'); if ($log.length) $log.html(this._buildLogHtml());
        });
    }

    _log(message, level = 'info') {
        try { this.console.log(`${this.PREFIX} ${message}`); } catch (e) {}
        try {
            const logs = this.storage.load(this.STORAGE_KEY_LOGS, []);
            logs.unshift({ at: Date.now(), level, message });
            this.storage.save(this.STORAGE_KEY_LOGS, logs.slice(0, this.CONFIG.logLimit));
        } catch (e) {}
        try { const $log = uw.$('#ff_log'); if ($log.length) $log.html(this._buildLogHtml()); } catch (e) {}
    }

    _buildLogHtml() {
        const logs = this.storage.load(this.STORAGE_KEY_LOGS, []);
        if (!logs.length) return '<div class="mbhudf-empty">// sem registos //</div>';
        return logs.map(e => {
            const d = new Date(e.at);
            const ts = ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2)+':'+('0'+d.getSeconds()).slice(-2);
            const msg = String(e.message).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
            return `<div class="ln ${e.level || 'info'}"><span class="ts">${ts}</span><span class="msg">${msg}</span></div>`;
        }).join('');
    }

    _buildStatusHtml() {
        const towns = this._scanTowns();
        const total = towns.length;
        const active = towns.filter(t => this._hasActiveFestival(t.id)).length;
        const ready = towns.filter(t => !this._hasActiveFestival(t.id) && this._hasEnoughResources(t.id)).length;
        const waiting = towns.filter(t => !this._hasActiveFestival(t.id) && !this._hasEnoughResources(t.id)).length;
        const pending = this._loadPending();
        const pendingCount = Object.keys(pending).filter(tid => this._canDoFestival(tid) && !this._hasActiveFestival(tid)).length;
        const mk = (val, label, cls) => `<div class="mbhudf-stat ${cls}"><div class="n">${val}</div><div class="t">${label}</div></div>`;
        return mk(total, 'Elegíveis', 'on') + mk(active, 'Com Festival', 'info') + mk(ready, 'Prontas', 'on') + mk(waiting, 'Aguardar', 'warn') + mk(pendingCount, 'Pendentes', 'pend');
    }

    _buildTownListHtml() {
        const towns = this._scanTowns();
        if (!towns.length) return '<div class="mbhudf-empty">// nenhuma cidade com academia ≥ 30 //</div>';
        const pendingAll = this._loadPending();
        return towns.map(t => {
            const tid = t.id;
            const hasActive = this._hasActiveFestival(tid);
            const currentRes = this._getResources(tid);
            const pending = pendingAll[tid];
            const hasResources = this._hasEnoughResources(tid);
            let statusKey = hasActive ? 'active' : (hasResources ? 'ready' : 'waiting');
            let statusText = hasActive ? '🎉 Ativo' : (hasResources ? '✅ Pronto' : '⏳ Precisa');
            const resText = currentRes ? `🪵${Math.floor(currentRes.wood)} 🪨${Math.floor(currentRes.stone)} ⚙${Math.floor(currentRes.iron)}` : '—';
            const pendingText = pending ? `<span class="pend">+${Math.floor(pending.wood)}/${Math.floor(pending.stone)}/${Math.floor(pending.iron)}</span>` : '';
            const star = (!hasActive && !hasResources) ? '⭐' : '';
            const safe = String(t.name).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
            return `<div class="mbhudf-town"><span class="star">${star}</span><span class="mbhudf-led ${statusKey}"></span><span class="name">${safe}</span><span class="res">${resText}${pendingText}</span><span class="mbhudf-pill ${statusKey}">${statusText}</span></div>`;
        }).join('');
    }

    _loadPending() { return this.storage.load(this.STORAGE_KEY_PENDING, {}); }
    _savePending(p) { this.storage.save(this.STORAGE_KEY_PENDING, p); }

    _getAllTowns() {
        try {
            return uw.MM.getOnlyCollectionByName('Town').models.map(m => ({ id: String(m.attributes.id), name: m.attributes.name || ('Cidade ' + m.attributes.id) }));
        } catch (e) { return []; }
    }

    _canDoFestival(tid) {
        try {
            const town = uw.ITowns.towns[tid];
            return Boolean(town && town.getBuildings().attributes.academy >= this.CONFIG.academyMinLevel);
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
        return { wood: current.wood + pending.wood, stone: current.stone + pending.stone, iron: current.iron + pending.iron };
    }

    _hasEnoughResources(tid) {
        const t = this._getTotalResources(tid);
        if (!t) return false;
        return t.wood >= this.CONFIG.cost.wood && t.stone >= this.CONFIG.cost.stone && t.iron >= this.CONFIG.cost.iron;
    }

    _checkAndClearPending(tid) {
        if (this._hasEnoughResources(tid)) {
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
                this._log('⏰ Pendências de ' + this.getTownName(tid) + ' expiradas.', 'warn');
                delete pending[tid];
                dirty = true;
            }
        }
        if (dirty) this._savePending(pending);
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
            if (this._hasEnoughResources(tid)) {
                if (pending[tid]) { delete pending[tid]; dirty = true; }
                continue;
            }
            if (this._sendingQueue[tid]) continue;
            
            if (dirty) this._savePending(pending);
            return tid; // RETORNA A PRIMEIRA QUE PRECISA (PRIORIDADE MÁXIMA)
        }
        if (dirty) this._savePending(pending);
        return null;
    }

    _getDonorTowns(targetId) {
        const all = this._getAllTowns();
        const donors = [];
        const pending = this._loadPending();

        for (const t of all) {
            const tid = t.id;
            
            // 1. Não pode doar para si mesma
            if (tid === targetId) continue;
            
            // 2. Não doar se já tem festival ativo
            if (this._hasActiveFestival(tid)) continue;

            // 3. 🚫 BLOQUEIO CRÍTICO: Não doar se esta cidade está atualmente na fila de envio (é um alvo ativo)
            if (this._sendingQueue[tid]) continue;

            // 4. 🚫 BLOQUEIO CRÍTICO: Não doar se esta cidade já tem recursos pendentes a chegar (já é uma recetora)
            if (pending[tid]) continue;

            // 5. Não doar se já tem recursos suficientes (deveria estar a fazer o seu próprio festival)
            if (this._hasEnoughResources(tid)) continue;

            const res = this._getResources(tid);
            if (!res) continue;

            if (res.wood < this.CONFIG.donorMinResource && res.stone < this.CONFIG.donorMinResource && res.iron < this.CONFIG.donorMinResource) continue;

            try {
                const town = uw.ITowns.towns[tid];
                const cap = town.getAvailableTradeCapacity ? town.getAvailableTradeCapacity() : 99999;
                if (cap < 100) continue; 
            } catch(e) {}

            donors.push(tid);
        }
        return donors;
    }

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

    async _main() {
        if (!this._active) return;
        if (uw.$('.botcheck').length || uw.$('#recaptcha_window').length) return;

        try {
            const allTowns = this._getAllTowns();
            for (const t of allTowns) this._checkAndClearPending(t.id);

            const targetId = this._getTargetTown();
            if (!targetId) {
                this._log('✅ Todas as cidades elegíveis estão abastecidas ou com festival ativo.', 'ok');
                this._refreshUI();
                this.stop();
                return;
            }

            const targetName = this.getTownName(targetId);
            this._sendingQueue[targetId] = true;

            if (this._hasEnoughResources(targetId)) {
                this._log(`🎯 ${targetName} já está completa. Passando para a próxima...`, 'ok');
                this._checkAndClearPending(targetId);
                delete this._sendingQueue[targetId];
                this._refreshUI();
                return;
            }

            this._log(`🎯 FOCO ATUAL: ${targetName}. Enviando remessas de até 500 de cada recurso...`, 'info');

            const donors = this._getDonorTowns(targetId);
            if (!donors.length) {
                this._log(`⚠ Sem doadores válidos para ${targetName} (verifica comerciantes/recursos).`, 'warn');
                delete this._sendingQueue[targetId];
                this._refreshUI();
                return;
            }

            donors.sort(() => Math.random() - 0.5);

            let sent = false;
            const totalSent = { wood: 0, stone: 0, iron: 0 };

            for (const donorId of donors) {
                const currentTotal = this._getTotalResources(targetId);
                const currentDeficit = {
                    wood: Math.max(0, this.CONFIG.cost.wood - currentTotal.wood),
                    stone: Math.max(0, this.CONFIG.cost.stone - currentTotal.stone),
                    iron: Math.max(0, this.CONFIG.cost.iron - currentTotal.iron),
                };
                const totalDeficit = currentDeficit.wood + currentDeficit.stone + currentDeficit.iron;

                if (totalDeficit <= 0) {
                    this._log(`🎯 Meta atingida em ${targetName}! Próxima cidade na fila.`, 'ok');
                    break;
                }

                const donorRes = this._getResources(donorId);
                if (!donorRes) continue;

                const sendAmount = {
                    wood: Math.min(this.CONFIG.donorFixedAmount, currentDeficit.wood, donorRes.wood),
                    stone: Math.min(this.CONFIG.donorFixedAmount, currentDeficit.stone, donorRes.stone),
                    iron: Math.min(this.CONFIG.donorFixedAmount, currentDeficit.iron, donorRes.iron),
                };

                const totalSend = sendAmount.wood + sendAmount.stone + sendAmount.iron;
                if (totalSend < this.CONFIG.minSendTotal) continue;

                const ok = await this._sendResources(donorId, targetId, sendAmount);
                if (ok) {
                    const pending = this._loadPending();
                    if (!pending[targetId]) pending[targetId] = { wood: 0, stone: 0, iron: 0, timestamp: Date.now() };
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
                }
            }

            this._checkAndClearPending(targetId);
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
