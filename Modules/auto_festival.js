// ══════════════════════════════════════════════════════
//  MODULE: AutoFestival v1.2.0 (Fixed Bulk Send)
//  Porta o "Auto Festival de Recursos" para o MultBot.
//  
//  CONFIGURAÇÃO DE ENVIO: 500 recursos por vez.
// ══════════════════════════════════════════════════════
var AutoFestival = class extends MultUtil {
    VERSION = '1.2.0';
    PREFIX = '[AutoFestival]';

    CONFIG = Object.freeze({
        cost: { wood: 15000, stone: 18000, iron: 15000 },
        intervalMs: 30000,
        pendingTimeoutMs: 120000,
        donorMinResource: 500, 
        fixedSendAmount: 500,  // Quantidade fixa de envio
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
            .mbhudf-root { background: #060816; border: 1px solid #22d3ee; border-radius: 6px; padding: 12px; color: #a8b8d0; font-family: monospace; margin-bottom: 20px; }
            .mbhudf-header { text-align: center; border-bottom: 1px solid rgba(34,211,238,0.2); margin-bottom: 12px; padding-bottom: 5px; }
            .mbhudf-header h2 { font-size: 14px; color: #22d3ee; margin: 0; }
            .mbhudf-section { background: rgba(0,0,0,0.2); border-radius: 4px; padding: 8px; margin-bottom: 10px; }
            .mbhudf-label { font-size: 9px; color: #22d3ee; text-transform: uppercase; margin-bottom: 5px; display: block; }
            .mbhudf-townlist { max-height: 150px; overflow-y: auto; font-size: 11px; }
            .mbhudf-town { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
            .mbhudf-log { font-size: 10px; max-height: 100px; overflow-y: auto; color: #8899aa; }
            .mbhudf-log .ln { margin-bottom: 2px; }
            .mbhudf-log .ts { color: #445566; margin-right: 5px; }
            .mbhudf-log .ok { color: #00ff88; }
            .mbhudf-log .error { color: #ff7777; }
            .mbhudf-log .warn { color: #ffb020; }
        `;
        uw.$('<style id="mbhud-festival-styles">').text(css).appendTo('head');
    }

    settings = () => {
        this._injectStyles();
        return '<div class="mbhudf-root">' +
               '<div class="mbhudf-header"><h2>◆ FESTIVAL ENGINE ◆</h2></div>' +
               '<div class="mbhudf-section"><span class="mbhudf-label">Status</span><div id="ff_status">Carregando...</div></div>' +
               '<div class="mbhudf-section"><span class="mbhudf-label">Cidades</span><div class="mbhudf-townlist" id="ff_town_list"></div></div>' +
               '<div class="mbhudf-section"><span class="mbhudf-label">Logs</span><div class="mbhudf-log" id="ff_log"></div></div>' +
               '</div>';
    };

    toggle = () => {
        if (this._active) this.stop();
        else this.start();
    };

    start() {
        if (this._active) return;
        this._active = true;
        this.storage.save(this.STORAGE_KEY_ACTIVE, true);
        this._log('🎉 Iniciado.', 'ok');
        this._main();
        this._intervalId = setInterval(() => {
            this._main().catch(e => this._log(`Erro: ${e}`, 'error'));
        }, this.CONFIG.intervalMs);
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
        return `<div>Ativo: ${this._active ? '<span style="color:#00ff88">SIM</span>' : '<span style="color:#ff7777">NÃO</span>'}</div>`;
    }

    _buildTownListHtml() {
        const towns = this._scanTowns();
        if (!towns.length) return '<div>Nenhuma cidade elegível.</div>';
        return towns.map(t => `<div class="mbhudf-town"><span>${t.name}</span><span>${this._hasActiveFestival(t.id) ? '🎉' : '⏳'}</span></div>`).join('');
    }

    _buildLogHtml() {
        const logs = this.storage.load(this.STORAGE_KEY_LOGS, []);
        return logs.map(e => {
            const d = new Date(e.at);
            const ts = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
            return `<div class="ln ${e.level}"><span class="ts">${ts}</span>${e.message}</div>`;
        }).join('');
    }

    // --- LOGICA DE NEGOCIO ---

    _getAllTowns() {
        try {
            return uw.MM.getOnlyCollectionByName('Town').models.map(m => ({
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

    _loadPending() { return this.storage.load(this.STORAGE_KEY_PENDING, {}); }
    _savePending(p) { this.storage.save(this.STORAGE_KEY_PENDING, p); }

    _scanTowns() {
        const all = this._getAllTowns();
        return all.filter(t => this._canDoFestival(t.id));
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
        const donors = [];
        for (const t of all) {
            const tid = t.id;
            if (tid === targetId) continue;
            if (this._hasActiveFestival(tid)) continue;
            if (this._canDoFestival(tid) && !this._hasEnoughResources(tid)) continue;

            const res = this._getResources(tid);
            if (!res || (res.wood < 500 && res.stone < 500 && res.iron < 500)) continue;
            donors.push(tid);
        }
        return donors;
    }

    async _sendResources(fromTownId, toTownId, amount) {
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
            const targetId = this._getTargetTown();
            if (!targetId) {
                this._log('Nenhuma cidade precisa de recursos.', 'info');
                return;
            }

            const targetName = this.getTownName(targetId);
            const donors = this._getDonorTowns(targetId);

            if (!donors.length) {
                this._log('Sem doadores suficientes para ' + targetName, 'error');
                return;
            }

            for (const donorId of donors) {
                const currentTotal = this._getTotalResources(targetId);
                if (!currentTotal) break;

                // Cálculo de déficit para não enviar mais do que o necessário para o festival
                const deficit = {
                    wood: Math.max(0, this.CONFIG.cost.wood - currentTotal.wood),
                    stone: Math.max(0, this.CONFIG.cost.stone - currentTotal.stone),
                    iron: Math.max(0, this.CONFIG.cost.iron - currentTotal.iron),
                };

                if (deficit.wood + deficit.stone + deficit.iron <= 0) break;

                const donorRes = this._getResources(donorId);
                if (!donorRes) continue;

                // Envio de 500 ou o máximo que a cidade tem/precisa
                const sendAmount = {
                    wood: Math.min(Math.floor(donorRes.wood), deficit.wood, this.CONFIG.fixedSendAmount),
                    stone: Math.min(Math.floor(donorRes.stone), deficit.stone, this.CONFIG.fixedSendAmount),
                    iron: Math.min(Math.floor(donorRes.iron), deficit.iron, this.CONFIG.fixedSendAmount),
                };

                if (sendAmount.wood + sendAmount.stone + sendAmount.iron < this.CONFIG.minSendTotal) continue;

                const ok = await this._sendResources(donorId, targetId, sendAmount);
                if (ok) {
                    const pending = this._loadPending();
                    if (!pending[targetId]) pending[targetId] = { wood: 0, stone: 0, iron: 0, timestamp: Date.now() };
                    pending[targetId].wood += sendAmount.wood;
                    pending[targetId].stone += sendAmount.stone;
                    pending[targetId].iron += sendAmount.iron;
                    pending[targetId].timestamp = Date.now();
                    this._savePending(pending);

                    this._log(`✓ ${this.getTownName(donorId)} → ${targetName} | 🪵${sendAmount.wood} 🪨${sendAmount.stone} ⚙${sendAmount.iron}`, 'ok');
                    await this._randomDelay(1000, 500);
                } else {
                    this._log('✗ Falha ao enviar de ' + this.getTownName(donorId), 'error');
                }
            }

            this._refreshUI();
        } catch (e) {
            this._log('Erro no ciclo: ' + e, 'error');
        }
    }

    _randomDelay(base, variation) {
        return new Promise(r => setTimeout(r, base + (Math.random() * variation)));
    }
};
