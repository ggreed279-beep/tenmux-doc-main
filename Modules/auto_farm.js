// ══════════════════════════════════════════════════════
//  MODULE: AutoFarm Turbo v2 — REESCRITA TOTAL
//
//  Porquê a versão antiga era lenta:
//   • Timer GLOBAL fixo (5/10/20 min) — colhia tudo de uma vez
//     e depois esperava o intervalo inteiro, mesmo que as
//     aldeias rurais ficassem prontas antes.
//   • Esperava pelo "maior grupo" de lootable_at (modo estatístico)
//     — cidades prontas ficavam paradas à espera das outras.
//   • fakeOpening + fakeSelectAll em CADA ciclo (metade da lentidão).
//
//  Como a Turbo funciona:
//   • COLETA POR CIDADE no momento exato: um ticker de 1s vigia o
//     lootable_at de cada ilha e colhe a cidade assim que a SUA ilha
//     está pronta — sem esperar timer global nem outras cidades.
//   • Jitter determinístico por cidade (2–9s) para não disparar
//     tudo no mesmo segundo (parece humano, espalha o servidor).
//   • Janela de farm simulada UMA vez por sessão, não por ciclo.
//   • Lotes maiores (25) com pausa curta (1.2s).
//   • Escolhe automaticamente a cidade representante de cada ilha:
//     a que tem MAIS ESPAÇO no armazém.
//   • Filtro de armazém CORRIGIDO: a antiga só colhia quando o
//     armazém estava CHEIO (desperdiçava tudo que transbordava).
//     Agora colhe enquanto o armazém tem espaço (abaixo de X%).
//   • Contagem regressiva até a PRÓXIMA cidade pronta (não um
//     número genérico), botão "Coletar já" e estatísticas.
//
//  Endpoints e time_options confirmados por captura real de rede:
//   farm_town_overviews/claim_loads_multiple — towns[], 
//   time_option_base/booty válidos: 600, 2400, 10800, 28800.
// ══════════════════════════════════════════════════════
var AutoFarm = class extends MultUtil {
    /* Modos = duração da coleta (define o cooldown a seguir).
       Valores confirmados válidos pelo loads_data da resposta. */
    MODES = [
        { id: 'turbo',  label: '⚡ 10 min', base: 600,   booty: 2400  },
        { id: 'rapido', label: '🕐 40 min', base: 2400,  booty: 2400  },
        { id: 'longo',  label: '🌇 3 h',   base: 10800, booty: 10800 },
        { id: 'noite',  label: '🌙 8 h',   base: 28800, booty: 28800 },
    ];

    /* Filtro de armazém: colhe apenas enquanto o recurso mais cheio
       está ABAIXO dist (evita desperdício por transbordo). */
    PERCENTS = [
        { v: 1,   label: 'Sempre' },
        { v: 0.9, label: '90%' },
        { v: 0.8, label: '80%' },
        { v: 0.5, label: '50%' },
    ];

    /* OPÇÃO 1: usa o Capitão (coleta em lote, claim_loads_multiple).
       OPÇÃO 2: farma cidade a cidade (claim individual por aldeia). */
    METHODS = [
        { id: 'captain', label: '🧭 OPÇÃO 1 — Capitão (lote)' },
        { id: 'single',  label: '👟 OPÇÃO 2 — Cidade a cidade' },
    ];

    constructor(c, s) {
        super(c, s);

        this.mode = this.storage.load('af_mode', 'turbo');
        this.percent = this.storage.load('af_percent', 1);
        this.method = this.storage.load('af_method', 'captain');
        this.active = false;

        this._tickId = null;
        this._claiming = false;
        this._windowOpened = false;
        this._warnedNoCaptain = false;

        // Caches (relações por ilha / lista de cidades por colher)
        this._islandRelations = null;
        this._islandCacheAt = 0;
        this._farmListCache = null;
        this._farmListAt = 0;

        this.stats = this.storage.load('af_stats', { claims: 0, lastClaimAt: 0 });

        const { $activity, $count } = this.createActivity("url(https://gpit.innogamescdn.com/images/game/premium_features/feature_icons_2.08.png) no-repeat 0 -240px");
        this.$activity = $activity;
        this.$count = $count;
        this.$activity.on('click', this.toggle);

        this.createDropdown();
        this.updateButtons();

        if (this.storage.load('af_active', false)) {
            setTimeout(() => this.start(), 3000);
        }
    }

    /* ══════════════ UI ══════════════ */

    createDropdown = () => {
        this.$content = uw.$("<div></div>");
        this.$title = uw.$("<p></p>").text('⚡ AutoFarm Turbo').css({ "text-align": "center", "margin": "2px", "font-weight": "bold", "font-size": "16px" });
        this.$content.append(this.$title);

        this.$methodLabel = uw.$("<p></p>").text('Método de coleta:').css({ "text-align": "left", "margin": "4px 2px 2px", "font-weight": "bold" });
        this.$content.append(this.$methodLabel);
        this.$methodButtons = this.METHODS.map(m =>
            this.createButton('mult_farm_method_' + m.id, m.label, this.toggleMethod)
        );
        this.$content.append(...this.$methodButtons);

        this.$modeLabel = uw.$("<p></p>").text('Duração da coleta (cooldown):').css({ "text-align": "left", "margin": "6px 2px 2px", "font-weight": "bold" });
        this.$content.append(this.$modeLabel);
        this.$modeButtons = this.MODES.map(m =>
            this.createButton('mult_farm_mode_' + m.id, m.label, this.toggleMode)
        );
        this.$content.append(...this.$modeButtons);

        this.$storageLabel = uw.$("<p></p>").text('Coletar só com armazém abaixo de:').css({ "text-align": "left", "margin": "6px 2px 2px", "font-weight": "bold" });
        this.$content.append(this.$storageLabel);
        this.$pctButtons = this.PERCENTS.map(p =>
            this.createButton('mult_farm_pct_' + String(p.v).replace('0.', ''), p.label, this.togglePercent)
        );
        this.$content.append(...this.$pctButtons);

        this.$claimNowLabel = uw.$("<p></p>").text('Ação imediata:').css({ "text-align": "left", "margin": "6px 2px 2px", "font-weight": "bold" });
        this.$claimNow = this.createButton('mult_farm_claim_now', '⚡ Coletar já', this.claimNow);
        this.$content.append(this.$claimNowLabel, this.$claimNow);

        this.$status = uw.$('<div id="af_status_v2"></div>').css({
            "text-align": "center", "margin": "8px 2px 2px",
            "font-size": "11px", "color": "#5a3a0a",
            "border-top": "1px solid rgba(90,58,10,0.25)", "padding-top": "6px",
        });
        this.$content.append(this.$status);

        this.$popup = this.createPopup(423, 250, 170, this.$content);
        this.$popup.css({ 'height': 'auto', 'min-height': '170px' });
        this.$popup.find('.middle').css({ 'position': 'relative', 'top': '0', 'bottom': '0', 'left': '0', 'right': '0', 'padding': '10px' });
        this.dropdown_active = false;

        const close = () => {
            if (!this.dropdown_active) this.$popup.hide();
            this.dropdown_active = false;
        };
        const open = () => {
            if (this.dropdown_active) this.$popup.show();
        };

        this.$activity.on({
            mouseenter: () => { this.dropdown_active = true; setTimeout(open, 1000); },
            mouseleave: () => { this.dropdown_active = false; setTimeout(close, 50); }
        });
        this.$popup.on({
            mouseenter: () => { this.dropdown_active = true; },
            mouseleave: () => { this.dropdown_active = false; setTimeout(close, 50); }
        });
    };

    updateButtons = () => {
        for (const btn of this.$methodButtons) btn.addClass('disabled');
        for (const btn of this.$modeButtons) btn.addClass('disabled');
        for (const btn of this.$pctButtons) btn.addClass('disabled');

        const methodIdx = this.METHODS.findIndex(m => m.id === this.method);
        if (methodIdx >= 0) this.$methodButtons[methodIdx].removeClass('disabled');

        const modeIdx = this.MODES.findIndex(m => m.id === this.mode);
        if (modeIdx >= 0) this.$modeButtons[modeIdx].removeClass('disabled');

        const pctIdx = this.PERCENTS.findIndex(p => p.v === this.percent);
        if (pctIdx >= 0) this.$pctButtons[pctIdx].removeClass('disabled');

        if (!this.active) {
            this.$count.css('color', "red");
            this.$count.text("");
        }
    };

    toggleMethod = (event) => {
        const { id } = event.currentTarget;
        const method = this.METHODS.find(m => 'mult_farm_method_' + m.id === id);
        if (!method) return;
        this.method = method.id;
        this.storage.save('af_method', this.method);
        this._windowOpened = false; // força reabrir a janela se voltar ao Capitão
        this.updateButtons();
        this.console.log('[AutoFarm] Método alterado: ' + method.label + '.');
    };

    toggleMode = (event) => {
        const { id } = event.currentTarget;
        const mode = this.MODES.find(m => 'mult_farm_mode_' + m.id === id);
        if (!mode) return;
        this.mode = mode.id;
        this.storage.save('af_mode', this.mode);
        this.updateButtons();
        this.console.log('[AutoFarm] Modo alterado para ' + mode.label + ' (aplica-se à próxima coleta).');
    };

    togglePercent = (event) => {
        const { id } = event.currentTarget;
        const pct = this.PERCENTS.find(p => 'mult_farm_pct_' + String(p.v).replace('0.', '') === id);
        if (!pct) return;
        this.percent = pct.v;
        this.storage.save('af_percent', this.percent);
        this.updateButtons();
    };

    /* ══════════════ LIFECYCLE ══════════════ */

    toggle = () => {
        if (this.active) this.stop();
        else this.start();
    };

    start = () => {
        if (this.active) return;
        this.active = true;
        this.storage.save('af_active', true);
        this._windowOpened = false;
        this._islandRelations = null;
        this._farmListCache = null;
        this.updateButtons();
        const mode = this.MODES.find(m => m.id === this.mode) || this.MODES[0];
        this.console.log('[AutoFarm] ⚡ Turbo iniciado — modo ' + mode.label + '. Colheita por cidade no momento exato.');
        this._tickId = this.createGuardedInterval(this._tick, 1000);
        this._tick();
    };

    stop = () => {
        this.active = false;
        this.storage.save('af_active', false);
        if (this._tickId) { clearInterval(this._tickId); this._tickId = null; }
        this.updateButtons();
        this.console.log('[AutoFarm] Turbo parado.');
    };

    /* ══════════════ CACHES / DADOS ══════════════ */

    /* Mapa ilha 'x:y' -> [relações de aldeias rurais dessa ilha].
       Construído a partir de FarmTown + FarmTownPlayerRelation.
       Rebuild a cada 10 min (ou se vazio). */
    _ensureIslandRelations = () => {
        if (this._islandRelations && Date.now() - this._islandCacheAt < 600000) return;
        const map = new Map();
        try {
            const { models: farmTowns } = uw.MM.getOnlyCollectionByName('FarmTown');
            const ftIsland = new Map();
            for (const f of farmTowns) {
                ftIsland.set(String(f.attributes.id), f.attributes.island_x + ':' + f.attributes.island_y);
            }
            const { models: relations } = uw.MM.getOnlyCollectionByName('FarmTownPlayerRelation');
            for (const r of relations) {
                const a = r.attributes;
                if (a.relation_status !== 1) continue;
                const key = ftIsland.get(String(a.farm_town_id));
                if (!key) continue;
                if (!map.has(key)) map.set(key, []);
                map.get(key).push(r);
            }
        } catch (e) {
            this.console.log('[AutoFarm] Erro ao mapear ilhas: ' + (e && e.message ? e.message : e));
        }
        this._islandRelations = map;
        this._islandCacheAt = Date.now();
    };

    /* Uma cidade por ilha — a com MAIS ESPAÇO no armazém.
       Cache de 30s (recursos mudam a cada coleta). */
    _getFarmList = () => {
        const now = Date.now();
        if (this._farmListCache && now - this._farmListAt < 30000) return this._farmListCache;
        const byIsland = new Map();
        try {
            const { models } = uw.MM.getOnlyCollectionByName('Town');
            for (const t of models) {
                const a = t.attributes;
                if (a.on_small_island) continue;
                const it = uw.ITowns.towns[a.id];
                if (!it) continue;
                const key = it.getIslandCoordinateX() + ':' + it.getIslandCoordinateY();
                let fill = 1;
                try {
                    const r = it.resources();
                    fill = r.storage > 0 ? Math.min(r.wood, r.stone, r.iron) / r.storage : 1;
                } catch (e) {}
                if (!byIsland.has(key)) byIsland.set(key, []);
                byIsland.get(key).push({ id: String(a.id), key, fill });
            }
        } catch (e) {
            return this._farmListCache || [];
        }
        const list = [];
        for (const arr of byIsland.values()) {
            arr.sort((x, y) => x.fill - y.fill); // mais espaço primeiro
            list.push(arr[0]);
        }
        this._farmListCache = list;
        this._farmListAt = now;
        return list;
    };

    /* Verifica prontidão de cada cidade: pronta quando TODAS as
       aldeias rurais da sua ilha estão lootable (max lootable_at).
       Retorna { ready: [{id,key}], nextIn: segundos }. */
    _scanReadiness = (ignoreJitter) => {
        const now = Math.floor(Date.now() / 1000);
        const ready = [];
        let nextIn = Infinity;

        for (const t of this._getFarmList()) {
            const rels = this._islandRelations.get(t.key);
            if (!rels || !rels.length) continue;

            let readyAt = 0;
            for (const r of rels) {
                const la = r.attributes.lootable_at;
                if (la !== null && la !== undefined && la > readyAt) readyAt = la;
            }

            if (readyAt <= now) {
                // Jitter determinístico por cidade: 2–9s
                const at = ignoreJitter ? 0 : readyAt + (parseInt(t.id, 10) % 8) + 2;
                if (now >= at) ready.push(t);
                else nextIn = Math.min(nextIn, at - now);
            } else {
                nextIn = Math.min(nextIn, readyAt - now);
            }
        }
        return { ready, nextIn: nextIn === Infinity ? 0 : nextIn };
    };

    /* ══════════════ TICKER (1s) ══════════════ */

    _tick = async () => {
        if (!this.active || this._claiming) return;
        if (window.__multbot_captcha_active) return;
        try {
            this._ensureIslandRelations();
            const { ready, nextIn } = this._scanReadiness(false);
            this._updateCountdown(ready.length, nextIn);
            if (ready.length) await this._claimReady(ready);
        } catch (e) {
            this.console.log('[AutoFarm] Erro no tick: ' + (e && e.message ? e.message : e));
        }
    };

    _updateCountdown = (readyCount, nextIn) => {
        try {
            if (!this.active) { this.$count.text("").css('color', 'red'); return; }
            const captain = uw.GameDataPremium.isAdvisorActivated('captain');
            this.$count.css('color', captain ? "#1aff1a" : "yellow");
            this.$count.text(readyCount > 0 ? "GO" : nextIn);
        } catch (e) {}
        try {
            const mode = this.MODES.find(m => m.id === this.mode) || this.MODES[0];
            const method = this.METHODS.find(m => m.id === this.method) || this.METHODS[0];
            uw.$('#af_status_v2').html(
                method.label + ' · ' + mode.label + ' · ' +
                (this.active
                    ? '<span style="color:#1a6b2a;font-weight:bold;">● ATIVO</span>'
                    : '<span style="color:#c0392b;font-weight:bold;">● PARADO</span>') +
                '<br>Prontas agora: <b>' + readyCount + '</b> · próxima em <b>' + nextIn + 's</b>' +
                '<br>Coletas: <b>' + this.stats.claims + '</b> · última: ' +
                (this.stats.lastClaimAt ? new Date(this.stats.lastClaimAt).toLocaleTimeString() : '—')
            );
        } catch (e) {}
    };

    /* ══════════════ COLETA ══════════════ */

    claimNow = async () => {
        if (this._claiming) return;
        if (!this.active) {
            this.console.log('[AutoFarm] Ativa primeiro o AutoFarm (clica no ícone).');
            return;
        }
        try {
            this._ensureIslandRelations();
            const { ready } = this._scanReadiness(true); // ignora jitter
            if (!ready.length) {
                this.console.log('[AutoFarm] Nada pronto para colher já.');
                return;
            }
            this.console.log('[AutoFarm] ⚡ Coleta manual: ' + ready.length + ' cidade(s).');
            await this._claimReady(ready);
        } catch (e) {
            this.console.log('[AutoFarm] Erro na coleta manual: ' + (e && e.message ? e.message : e));
        }
    };

    _claimReady = async (towns) => {
        this._claiming = true;
        try {
            // Filtro de espaço no armazém (leitura fresca, pós-cache)
            const eligible = [];
            for (const t of towns) {
                try {
                    const it = uw.ITowns.towns[t.id];
                    if (!it) continue;
                    const r = it.resources();
                    const fill = r.storage > 0 ? Math.min(r.wood, r.stone, r.iron) / r.storage : 1;
                    if (this.percent >= 1 || fill < this.percent) eligible.push(t);
                } catch (e) {}
            }
            if (!eligible.length) return;

            const mode = this.MODES.find(m => m.id === this.mode) || this.MODES[0];
            const useCaptain = this.method === 'captain';
            const captainActive = uw.GameDataPremium.isAdvisorActivated('captain');

            // OPÇÃO 1 — Capitão (lote). Se o Capitão não estiver ativo,
            // avisa (uma vez por sessão) e usa o método individual.
            if (useCaptain) {
                if (!captainActive) {
                    if (!this._warnedNoCaptain) {
                        this._warnedNoCaptain = true;
                        this.console.log('[AutoFarm] ⚠ Capitão não está ativo — OPÇÃO 1 exige Capitão. A usar cidade a cidade.');
                    }
                } else {
                    try {
                        // Janela de farm simulada UMA vez por sessão (não por ciclo!)
                        if (!this._windowOpened) {
                            await this.fakeOpening();
                            await this.sleep(1200, 300);
                            await this.fakeSelectAll(eligible.map(t => parseInt(t.id, 10)));
                            this._windowOpened = true;
                            await this.sleep(1200, 300);
                        }
                        await this._claimBatched(eligible.map(t => parseInt(t.id, 10)), mode.base, mode.booty);
                        this.stats.claims += eligible.length;
                        this.console.log('[AutoFarm] 🧭 ' + eligible.length + ' cidade(s) colhida(s) via Capitão [' + mode.label + '].');
                        this._afterClaim();
                        return;
                    } catch (e) {
                        this.console.log('[AutoFarm] claimMultiple falhou (' + (e && e.message ? e.message : e) + ') — coleta individual.');
                        this._windowOpened = false;
                        // cai para o método individual abaixo
                    }
                }
            }

            // OPÇÃO 2 — Cidade a cidade (também fallback da Opção 1)
            const count = await this._claimOneByOne(eligible);
            this.stats.claims += count;
            if (count > 0) this.console.log('[AutoFarm] 👟 ' + count + ' aldeia(s) colhida(s) cidade a cidade.');
        } finally {
            this._claiming = false;
            this.stats.lastClaimAt = Date.now();
            this.storage.save('af_stats', this.stats);
        }
    };

    _afterClaim = () => {
        try { this.fakeUpdate(); } catch (e) {}
        try {
            setTimeout(function () {
                uw.WMap.removeFarmTownLootCooldownIconAndRefreshLootTimers();
            }, 2000);
        } catch (e) {}
    };

    /* Lotes de 25 com pausa curta de 1.2s — bem mais rápido que
       os lotes de 20 com 2s da versão antiga. */
    _claimBatched = async (town_ids, base, booty) => {
        const BATCH_SIZE = 25;
        for (let i = 0; i < town_ids.length; i += BATCH_SIZE) {
            const batch = town_ids.slice(i, i + BATCH_SIZE);
            await this.claimMultiple(batch, base, booty);
            if (i + BATCH_SIZE < town_ids.length) {
                await this.sleep(1200, 300);
            }
        }
    };

    /* ══════════════ ENDPOINTS (confirmados por captura) ══════════════ */

    claimSingle = async (town_id, farm_town_id, relation_id, option) => {
        if (option === undefined) option = 1;
        const data = {
            model_url: 'FarmTownPlayerRelation/' + relation_id,
            action_name: 'claim',
            arguments: {
                farm_town_id: farm_town_id,
                type: 'resources',
                option: option,
            },
            town_id: town_id,
        };
        try {
            await this.ajaxPostWithTimeout('frontend_bridge', 'execute', data);
        } catch (e) {
            this.console.log('[AutoFarm] Erro ao coletar rural: ' + (e && e.message ? e.message : e));
        }
    };

    claimMultiple = async (polis_list, base, boost) => {
        if (base === undefined) base = 600;
        if (boost === undefined) boost = 2400;
        const town_id = uw.ITowns.getCurrentTown().id;
        const data = {
            towns: polis_list,
            time_option_base: base,
            time_option_booty: boost,
            claim_factor: 'normal',
            town_id: town_id,
            nl_init: true,
        };
        try {
            await this.ajaxPostWithTimeout('farm_town_overviews', 'claim_loads_multiple', data, 90000);
        } catch (e) {
            this.console.log('[AutoFarm] Erro em claimMultiple: ' + (e && e.message ? e.message : e));
            throw e;
        }
    };

    fakeOpening = async () => {
        try {
            const town_id = uw.ITowns.getCurrentTown().id;
            await this.ajaxGetWithTimeout('farm_town_overviews', 'index', {
                town_id: town_id,
                nl_init: true,
            });
            await this.sleep(10);
            await this.fakeUpdate();
        } catch (e) {
            this.console.log('[AutoFarm] Erro em fakeOpening: ' + (e && e.message ? e.message : e));
            throw e;
        }
    };

    fakeSelectAll = async (town_ids) => {
        const town_id = uw.ITowns.getCurrentTown().id;
        const data = {
            town_ids: town_ids,
            town_id: town_id,
            nl_init: true,
        };
        try {
            await this.ajaxGetWithTimeout('farm_town_overviews', 'get_farm_towns_from_multiple_towns', data);
        } catch (e) {
            this.console.log('[AutoFarm] Erro em fakeSelectAll: ' + (e && e.message ? e.message : e));
            throw e;
        }
    };

    fakeUpdate = async () => {
        const town = uw.ITowns.getCurrentTown();
        const researches = town.getResearches() && town.getResearches().attributes ? town.getResearches().attributes : {};
        const buildings = town.getBuildings() && town.getBuildings().attributes ? town.getBuildings().attributes : {};
        const data = {
            island_x: town.getIslandCoordinateX(),
            island_y: town.getIslandCoordinateY(),
            current_town_id: town.id,
            booty_researched: researches.booty ? 1 : 0,
            diplomacy_researched: researches.diplomacy ? 1 : 0,
            trade_office: buildings.trade_office ? 1 : 0,
            town_id: town.id,
            nl_init: true,
        };
        try {
            await this.ajaxGetWithTimeout('farm_town_overviews', 'get_farm_towns_for_town', data);
        } catch (e) {
            this.console.log('[AutoFarm] Erro em fakeUpdate: ' + (e && e.message ? e.message : e));
            throw e;
        }
    };

    /* Coleta cidade a cidade (fallback). Sem Captain usa sempre a
       opção curta — a frequência fica a cargo do ticker de prontidão. */
    _claimOneByOne = async (eligible) => {
        let max = 60;
        let count = 0;
        try {
            const { models: relations } = uw.MM.getOnlyCollectionByName('FarmTownPlayerRelation');
            const { models: farmTowns } = uw.MM.getOnlyCollectionByName('FarmTown');
            const now = Math.floor(Date.now() / 1000);

            const ftIsland = new Map();
            for (const f of farmTowns) {
                ftIsland.set(String(f.attributes.id), f.attributes.island_x + ':' + f.attributes.island_y);
            }

            for (const t of eligible) {
                const it = uw.ITowns.towns[t.id];
                if (!it) continue;
                const key = it.getIslandCoordinateX() + ':' + it.getIslandCoordinateY();

                for (const rel of relations) {
                    const a = rel.attributes;
                    if (ftIsland.get(String(a.farm_town_id)) !== key) continue;
                    if (a.relation_status !== 1) continue;
                    if (a.lootable_at !== null && a.lootable_at !== undefined && now < a.lootable_at) continue;

                    await this.claimSingle(parseInt(t.id, 10), a.farm_town_id, rel.id, 1);
                    await this.sleep(500);
                    count++;
                    if (--max <= 0) { this._afterClaim(); return count; }
                }
            }
        } catch (e) {
            this.console.log('[AutoFarm] Erro na coleta individual: ' + (e && e.message ? e.message : e));
        }
        this._afterClaim();
        return count;
    };
};
