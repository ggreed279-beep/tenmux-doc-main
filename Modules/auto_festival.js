
// ══════════════════════════════════════════════════════
//  MODULE: AutoFestival v1.2.0 (Cyberpunk Edition - Fixed)
// ══════════════════════════════════════════════════════
var AutoFestival = class extends MultUtil {
    VERSION = '1.2.0';
    PREFIX = '[AutoFestival]';

    CONFIG = Object.freeze({
        cost: { wood: 15000, stone: 18000, iron: 15000 },
        intervalMs: 30000,
        pendingTimeoutMs: 120000,
        donorMinResource: 500,
        fixedSendAmount: 500, // O valor que tu queres!
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
            .mbhudf-header { text-align: center; padding: 4px 0 12px; border-bottom: 1px solid rgba(34,211,238,0.2); margin-bottom: 12px; position: relative; z-index: 1; }
            .mbhudf-header h2 { margin: 0; font-size: 14px; letter-spacing: 6px; text-transform: uppercase; color: #22d3ee; text-shadow: 0 0 12px rgba(34,211,238,0.7); font-weight: 700; }
            .mbhudf-section { background: rgba(10,16,32,0.6); border: 1px solid rgba(34,211,238,0.2); border-radius: 4px; padding: 10px 12px; margin-bottom: 10px; position: relative; z-index: 1; }
            .mbhudf-label { display: block; font-size: 9px; letter-spacing: 2.5px; text-transform: uppercase; color: #22d3ee; margin-bottom: 8px; font-weight: 700; }
            .mbhudf-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 6px; }
            .mbhudf-stat { background: rgba(0,0,0,0.35); border: 1px solid rgba(34,211,238,0.18); border-radius: 4px; padding: 6px 8px; text-align: center; }
            .mbhudf-stat .n { font-size: 18px; font-weight: 700; color: #22d3ee; }
            .mbhudf-stat .t { font-size: 8px; color: #5a6a7a; text-transform: uppercase; margin-top: 2px; }
            .mbhudf-townlist { max-height: 200px; overflow-y: auto; background: rgba(0,0,0,0.25); border: 1px solid rgba(34,211,238,0.12); padding: 2px; }
            .mbhudf-town { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid rgba(34,211,238,0.08); font-size: 11px; }
            .mbhudf-pill { padding: 3px 9px; border-radius: 12px; font-size: 8px; font-weight: 700; text-transform: uppercase; border: 1px solid; }
            .mbhudf-pill.ready { background: rgba(0,255,136,0.12); border-color: rgba(0,255,136,0.5); color: #00ff88; }
            .mbhudf-pill.active { background: rgba(34,211,238,0.14); border-color: rgba(34,211,238,0.55); color: #22d3ee; animation: mbhudf-pulse 2s infinite; }
            .mbhudf-log { font-size: 10px; max-height: 120px; overflow-y: auto; background: rgba(0,0,0,0.35); padding: 6px 8px; }
            .mbhudf-log .ln { display: flex; gap: 6px; margin-bottom: 2px; }
            .mbhudf-log .ts { color: #4a5a6a; flex-shrink: 0; }
            .mbhudf-log .ok { color: #00ff88; }
            .mbhudf-log .error { color: #f87171; }
        `;
        uw.$('<style id="mbhud-festival-styles">').text(css).appendTo('head');
    }

    settings = () => {
        this._injectStyles();
        return '<div class="mbhudf-root">' +
               '<div class="mbhudf-header"><h2>◆ FESTIVAL ENGINE ◆</h2></div>' +
               '<div class="mbhudf-section"><span class="mbhudf-label">Protocolo</span><div class="mbhudf-desc" style="font-size:10px; color:#6a7a8a;">Alvo: 🪵15k 🪨18k ⚙15k. Envio Lote: 500.</div></div>' +
               '<div class="mbhudf-section"><span class="mbhudf-label">Telemetria</span><div class="mbhudf-stats" id="ff_status"></div></div>' +
               '<div class="mbhudf-section"><span class="mbhudf-label">Cidades Elegíveis</span><div class="mbhudf-townlist" id="ff_town_list"></div></div>' +
               '<div class="mbhudf-section"><span class="mbhudf-label">Registo</span><div class="mbhudf-log" id="ff_log"></div></div>' +
               '</div>';
    };

    toggle = () => { this._active ? this.stop() : this.start(); };

    start() {
        if (this._active) return;
        this._active = true;
        this.storage.save(this.STORAGE_KEY_ACTIVE, true);
        this._log('🎉 Iniciado.', 'ok');
        this._main();
        this._intervalId = setInterval(() => this._main(), this.CONFIG.intervalMs);
    }

    stop() {
        this._active = false;
        this.storage.save(this.STORAGE_KEY_ACTIVE, false);
        if (this._intervalId) clearInterval(this._intervalId);
        this._log('Parado.');
    }

    _log(message, level = 'info') {
        const logs = this.storage.load(this.STORAGE_KEY_LOGS, []);
        logs.unshift({ at: Date.now(), level, message });
        this.storage.save(this.STORAGE_KEY_LOGS, logs.slice(0, this.CONFIG.logLimit));
        this._refreshUI();
    }

    _refreshUI() {
        uw.$('#ff_status').html(this._buildStatusHtml());
        uw.$('#ff_town_list').html(this._buildTownListHtml());
        uw.$('#ff_log').html(this._buildLogHtml());
    }

    _buildStatusHtml() {
        const towns = this._scanTowns();
        return `<div class="mbhudf-stat"><div class="n">${towns.length}</div><div class="t">Elegíveis</div></div>`;
    }

    _buildTownListHtml() {
        const towns = this._scanTowns();
        if (!towns.length) return '<div style="font-size:10px;">Nenhuma cidade.</div>';
        return towns.map(t => `<div class="mbhudf-town"><span>${t.name}</span><span class="mbhudf-pill ready">Monitor</span></div>`).join('');
    }

    _buildLogHtml() {
        const logs = this.storage.load(this.STORAGE_KEY_LOGS, []);
        return logs.map(e => {
            const d = new Date(e.at);
            const ts = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
            return `<div class="ln ${e.level}"><span class="ts">${ts}</span><span>${e.message}</span></div>`;
        }).join('');
    }

    // --- LOGICA DE ENVIO CORRIGIDA ---

    async _main() {
        if (!this._active) return;
        try {
            const targetId = this._getTargetTown();
            if (!targetId) {
                this._log('Nenhuma cidade precisa de recursos.', 'info');
                return;
            }

            const targetName = this.getTownName(targetId);
            const donors = this._getDonorTowns(targetId);

            if (!donors.length) {
                this._log('Sem doadores para ' + targetName, 'error');
                return;
            }

            for (const donorId of donors) {
                const currentTotal = this._getTotalResources(targetId);
                const deficit = {
                    wood: Math.max(0, this.CONFIG.cost.wood - currentTotal.wood),
                    stone: Math.max(0, this.CONFIG.cost.stone - currentTotal.stone),
                    iron: Math.max(0, this.CONFIG.cost.iron - currentTotal.iron),
                };

                if (deficit.wood + deficit.stone + deficit.iron <= 0) break;

                const donorRes = this._getResources(donorId);
                
                // AQUI ESTÁ O SEU 500 FIXO!
                const sendAmount = {
                    wood: Math.min(Math.floor(donorRes.wood), deficit.wood, this.CONFIG.fixedSendAmount),
                    stone: Math.min(Math.floor(donorRes.stone), deficit.stone, this.CONFIG.fixedSendAmount),
                    iron: Math.min(Math.floor(donorRes.iron), deficit.iron, this.CONFIG.fixedSendAmount),
                };

                if (sendAmount.wood + sendAmount.stone + sendAmount.iron < this.CONFIG.minSendTotal) continue;

                const ok = await this._sendResources(donorId, targetId, sendAmount);
                if (ok) {
                    this._log(`✓ ${this.getTownName(donorId)} → ${targetName} | 🪵${sendAmount.wood} 🪨${sendAmount.stone} ⚙${sendAmount.iron}`, 'ok');
                    await new Promise(r => setTimeout(r, 1000));
                } else {
                    this._log('✗ Falha ao enviar de ' + this.getTownName(donorId), 'error');
                }
            }
        } catch (e) {
            this._log('Erro: ' + e, 'error');
        }
    }

    _getTargetTown() {
        const towns = this._scanTowns();
        for (const t of towns) {
            if (this._hasActiveFestival(t.id)) continue;
            if (this._hasEnoughResources(t.id)) continue;
            return t.id;
        }
        return null;
    }

    _getDonorTowns(targetId) {
        const all = this._getAllTowns();
        return all.filter(t => t.id !== targetId && !this._hasActiveFestival(t.id) && this._getResources(t.id) > 500 ? t.id : false);
    }

    _getResources(tid) {
        const town = uw.ITowns.towns[tid];
        if (!town) return { wood: 0, stone: 0, iron: 0 };
        const r = town.resources();
        return { wood: r.wood || 0, stone: r.stone || 0, iron: r.iron || 0 };
    }

    _getTotalResources(tid) {
        const current = this._getResources(tid);
        const pending = this._loadPending()[tid] || { wood: 0, stone: 0, iron: 0 };
        return { wood: current.wood + pending.wood, stone: current.stone + pending.stone, iron: current.iron + pending.iron };
    }

    _hasEnoughResources(tid) {
        const t = this._getTotalResources(tid);
        return t.wood >= this.CONFIG.cost.wood && t.stone >= this.CONFIG.cost.stone && t.iron >= this.CONFIG.cost.iron;
    }

    _getAllTowns() {
        try {
            return uw.MM.getOnlyCollectionByName('Town').models.map(m => ({ id: String(m.attributes.id), name: m.attributes.name }));
        } catch (e) { return []; }
    }

    _canDoFestival(tid) {
        try {
            const town = uw.ITowns.towns[tid];
            return town && town.getBuildings().attributes.academy >= this.CONFIG.academyMinLevel;
        } catch (e) { return false; }
    }

    _hasActiveFestival(tid) {
        try {
            const celebrations = uw.MM.getModels().Celebration;
            for (const k in celebrations) {
                if (celebrations[k].attributes.celebration_type === 'party' && String(celebrations[k].attributes.town_id) === String(tid)) return true;
            }
            return false;
        } catch (e) { return false; }
    }

    _loadPending() { return this.storage.load(this.STORAGE_KEY_PENDING, {}); }
    _savePending(p) { this.storage.save
