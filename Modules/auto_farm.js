class AutoFarm extends ModernUtil {
    constructor(c, s) {
        super(c, s);

        /* ---------- Configurações guardadas ---------- */
        this.timing = this.storage.load('af_level', 300000);
        this.percent = this.storage.load('af_percent', 0);   // 0 = "Todas"
        this.active = this.storage.load('af_active', false);
        this.gui = this.storage.load('af_gui', false);

        /* ---------- Estado interno ---------- */
        this.timer = 0;
        this.lastTime = Date.now();
        this.polis_list = [];
        this._claiming = false;
        this._captchaLogged = false;
        this._statTick = 0;
        this._farmsCached = 0;
        this._intervalId = null;

        /* ---------- Ícone + contador na barra ---------- */
        const { $activity, $count } = this.createActivity("url(https://gpit.innogamescdn.com/images/game/premium_features/feature_icons_2.08.png) no-repeat 0 -240px");
        this.$activity = $activity;
        this.$count = $count;
        this.$activity.on('click', () => this.toggle());

        /* ---------- UI ---------- */
        this.injectStyles();
        this.createDropdown();

        /* ---------- Arranque ---------- */
        const wasActive = !!this.active;
        this.active = null; // Reset para o _start controlar
        if (wasActive) this._start();
        this.updateButtons();
    }

    /* =========================================================
       ESTILOS
       ========================================================= */
    injectStyles = () => {
        if (uw.document.getElementById('mult_af_styles')) return;
        const css = `
            .mult_af_stats { background: rgba(0,0,0,0.35); border: 1px solid #3d2b1f; border-radius: 6px; padding: 6px 8px; margin: 4px 0; font-size: 11px; color: #d4c5a0; }
            .mult_af_stats .row { display: flex; justify-content: space-between; margin: 1px 0; }
            .mult_af_stats .val { color: #ffd700; font-weight: bold; }
            .mult_af_log { max-height: 80px; overflow-y: auto; background: rgba(0,0,0,0.4); border: 1px solid #2a1a12; border-radius: 4px; padding: 4px 6px; margin-top: 6px; font-size: 10px; color: #8a8a7a; }
            .mult_af_log_success { color: #8bc34a; }
            .mult_af_log_error { color: #ef5350; }
            .mult_af_log_info { color: #64b5f6; }
            .mult_af_log_warning { color: #ffb74d; }
            .mult_af_notif { position: fixed; top: 80px; right: 20px; background: rgba(0,0,0,0.85); color: #fff; padding: 10px 18px; border-radius: 8px; border-left: 4px solid #4CAF50; box-shadow: 0 4px 20px rgba(0,0,0,0.5); z-index: 99999; font-size: 13px; animation: mult_af_slide 0.4s ease-out; }
            @keyframes mult_af_slide { from { transform: translateX(80px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            .mult_af_fade { opacity: 0; transition: opacity 0.5s; }
        `;
        uw.$('<style id="mult_af_styles"></style>').text(css).appendTo('head');
    };

    /* =========================================================
       HELPERS DE UI & AJAX
       ========================================================= */
    formatTime = (totalSeconds) => {
        totalSeconds = Math.max(0, Math.round(totalSeconds));
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        const mm = String(m).padStart(2, '0');
        const ss = String(s).padStart(2, '0');
        return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
    };

    notify = (message, type) => {
        const colors = { on: '#4CAF50', off: '#f44336', info: '#64b5f6', warning: '#ffb74d' };
        const color = colors[type] || colors.info;
        const $n = uw.$('<div class="mult_af_notif"></div>').text(message).css('border-left-color', color);
        uw.$('body').append($n);
        setTimeout(() => {
            $n.addClass('mult_af_fade');
            setTimeout(() => $n.remove(), 500);
        }, 3000);
    };

    log = (message, type) => {
        if (!this.$log || !this.$log.length) return;
        const time = new Date().toLocaleTimeString();
        const $entry = uw.$('<div></div>').addClass('mult_af_log_' + (type || 'info')).text('[' + time + '] ' + message);
        this.$log.prepend($entry);
        while (this.$log.children().length > 25) this.$log.children().last().remove();
    };

    ajaxPostWithTimeout = (controller, action, data, timeout = 15000) => {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Timeout')), timeout);
            uw.gpAjax.ajaxPost(controller, action, data, false, (res) => {
                clearTimeout(timer);
                if (res && !res.error) resolve(res);
                else reject(new Error(res?.error || 'Ajax Error'));
            }, () => { clearTimeout(timer); reject(new Error('Network Error')); });
        });
    };

    ajaxGetWithTimeout = (controller, action, data, timeout = 15000) => {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Timeout')), timeout);
            uw.gpAjax.ajaxGet(controller, action, data, false, (res) => {
                clearTimeout(timer);
                if (res && !res.error) resolve(res);
                else reject(new Error(res?.error || 'Ajax Error'));
            }, () => { clearTimeout(timer); reject(new Error('Network Error')); });
        });
    };

    updateStats = () => {
        if (!this.$statStatus) return;
        const secs = Math.max(0, Math.round(this.timer / 1000));
        this.$statStatus.text(this.active ? 'Ativo' : 'Pausa').css('color', this.active ? '#1aff1a' : '#ff5555');

        let captain = '?';
        try { captain = uw.GameDataPremium.isAdvisorActivated('captain') ? 'Sim' : 'Não'; } catch (e) {}
        this.$statCaptain.text(captain);

        this._statTick++;
        if (this._statTick % 10 === 1 || !this._farmsCached) {
            try { this._farmsCached = this.generateList().length; } catch (e) { this._farmsCached = this.polis_list.length; }
        }
        this.$statFarms.text(this._farmsCached || 0);
        this.$statNext.text(this.active ? (this.timer > 0 ? this.formatTime(secs) : 'Agora!') : '--');
    };

    /* =========================================================
       DROPDOWN
       ========================================================= */
    createDropdown = () => {
        this.$content = uw.$("<div></div>");
        this.$title = uw.$("<p></p>").text('Auto-Farm').css({ "text-align": "center", "margin": "2px", "font-weight": "bold", "font-size": "16px" });
        this.$content.append(this.$title);

        this.$power = uw.$("<p></p>").text('Controle').css({ "text-align": "left", "margin": "2px", "font-weight": "bold" });
        this.$btnOn = this.createButton("mult_farm_on", "▶ START", () => { if (!this.active) this.toggle(); }).css({ "width": "110px" });
        this.$btnOff = this.createButton("mult_farm_off", "⏸ PAUSE", () => { if (this.active) this.toggle(); }).css({ "width": "110px" });
        this.$content.append(this.$power, this.$btnOn, this.$btnOff);

        this.$btnNow = this.createButton("mult_farm_now", "🌾 FARM AGORA", this.forceFarm).css({ "width": "220px", "margin-top": "5px" });
        this.$content.append(this.$btnNow);

        this.$statStatus = uw.$('<span class="val"></span>');
        this.$statCaptain = uw.$('<span class="val"></span>');
        this.$statFarms = uw.$('<span class="val"></span>');
        this.$statNext = uw.$('<span class="val"></span>');
        const row = (label, $val) => uw.$('<div class="row"></div>').append(uw.$('<span></span>').text(label), $val);
        this.$stats = uw.$('<div class="mult_af_stats"></div>').append(
            row('Estado', this.$statStatus),
            row('Capitão', this.$statCaptain),
            row('Cidades', this.$statFarms),
            row('Próxima', this.$statNext)
        );
        this.$content.append(this.$stats);

        this.$duration = uw.$("<p></p>").text('Intervalo').css({ "text-align": "left", "margin": "2px", "font-weight": "bold" });
        this.$button5 = this.createButton("mult_farm_5", "5 min", this.toggleDuration);
        this.$button10 = this.createButton("mult_farm_10", "10 min", this.toggleDuration);
        this.$button20 = this.createButton("mult_farm_20", "20 min", this.toggleDuration);
        this.$content.append(this.$duration, this.$button5, this.$button10, this.$button20);

        this.$storage = uw.$("<p></p>").text('Filtro Armazém').css({ "text-align": "left", "margin": "2px", "font-weight": "bold" });
        this.$buttonAll = this.createButton("mult_farm_all", "Todas", this.toggleStorage).css({ "width": "70px" });
        this.$button80 = this.createButton("mult_farm_80", "80%", this.toggleStorage).css({ "width": "60px" });
        this.$button90 = this.createButton("mult_farm_90", "90%", this.toggleStorage).css({ "width": "60px" });
        this.$button100 = this.createButton("mult_farm_100", "100%", this.toggleStorage).css({ "width": "60px" });
        this.$content.append(this.$storage, this.$buttonAll, this.$button80, this.$button90, this.$button100);

        this.$gui = uw.$("<p></p>").text('Modo GUI').css({ "text-align": "left", "margin": "2px", "font-weight": "bold" });
        this.$guiOn = this.createButton("mult_farm_gui_on", "ON", this.toggleGui);
        this.$guiOff = this.createButton("mult_farm_gui_off", "OFF", this.toggleGui);
        this.$content.append(this.$gui, this.$guiOn, this.$guiOff);

        this.$log = uw.$('<div class="mult_af_log"></div>');
        this.$content.append(this.$log);

        this.$popup = this.createPopup(423, 250, 170, this.$content);
        this.$popup.css({ 'height': 'auto', 'min-height': '170px' });
        this.$popup.find('.middle').css({ 'position': 'relative', 'top': '0', 'bottom': '0', 'left': '0', 'right': '0', 'padding': '10px' });
        this.dropdown_active = false;

        const close = () => { if (!this.dropdown_active) this.$popup.hide(); this.dropdown_active = false; };
        const open = () => { if (this.dropdown_active) this.$popup.show(); };

        this.$activity.on({
            mouseenter: () => { this.dropdown_active = true; setTimeout(open, 1000); },
            mouseleave: () => { this.dropdown_active = false; setTimeout(close, 50); }
        });
        this.$popup.on({
            mouseenter: () => { this.dropdown_active = true; },
            mouseleave: () => { this.dropdown_active = false; setTimeout(close, 50); }
        });

        this.log('Sistema pronto — prime START', 'info');
    };

    /* =========================================================
       ESTADO DOS BOTÕES
       ========================================================= */
    updateButtons = () => {
        this.$button5.addClass('disabled'); this.$button10.addClass('disabled'); this.$button20.addClass('disabled');
        this.$buttonAll.addClass('disabled'); this.$button80.addClass('disabled'); this.$button90.addClass('disabled'); this.$button100.addClass('disabled');

        if (this.timing == 300000) this.$button5.removeClass('disabled');
        if (this.timing == 600000) this.$button10.removeClass('disabled');
        if (this.timing == 1200000) this.$button20.removeClass('disabled');

        if (this.percent == 0) this.$buttonAll.removeClass('disabled');
        if (this.percent == 0.8) this.$button80.removeClass('disabled');
        if (this.percent == 0.9) this.$button90.removeClass('disabled');
        if (this.percent == 1) this.$button100.removeClass('disabled');

        this.$btnOn.addClass('disabled'); this.$btnOff.addClass('disabled');
        if (this.active) this.$btnOn.removeClass('disabled');
        else this.$btnOff.removeClass('disabled');

        if (!this.active) { this.$count.css('color', "red"); this.$count.text("off"); }

        this.$guiOn.addClass('disabled'); this.$guiOff.addClass('disabled');
        if (this.gui) this.$guiOn.removeClass('disabled');
        else this.$guiOff.removeClass('disabled');

        this.updateStats();
    };

    /* =========================================================
       HANDLERS DOS BOTÕES
       ========================================================= */
    toggleDuration = (event) => {
        const { id } = event.currentTarget;
        if (id == "mult_farm_5") this.timing = 300000;
        if (id == "mult_farm_10") this.timing = 600000;
        if (id == "mult_farm_20") this.timing = 1200000;
        this.storage.save('af_level', this.timing);
        this.log('Intervalo: ' + (this.timing / 60000) + ' min', 'info');
        this.updateButtons();
    };

    toggleStorage = (event) => {
        const { id } = event.currentTarget;
        if (id == "mult_farm_all") this.percent = 0;
        if (id == "mult_farm_80") this.percent = 0.8;
        if (id == "mult_farm_90") this.percent = 0.9;
        if (id == "mult_farm_100") this.percent = 1;
        this.storage.save('af_percent', this.percent);
        this._farmsCached = 0;
        this.log('Armazém: ' + (this.percent === 0 ? 'Todas as cidades' : (this.percent * 100) + '%'), 'info');
        this.updateButtons();
    };

    toggleGui = (event) => {
        const { id } = event.currentTarget;
        if (id == "mult_farm_gui_on") this.gui = true;
        if (id == "mult_farm_gui_off") this.gui = false;
        this.storage.save('af_gui', this.gui);
        this.log('Modo GUI: ' + (this.gui ? 'ON' : 'OFF'), 'info');
        this.updateButtons();
    };

    /* =========================================================
       START / PAUSE
       ========================================================= */
    _start = () => {
        this.lastTime = Date.now();
        this.timer = 0; /* farm IMEDIATO ao ligar */
        this.active = setInterval(() => this.main(), 1000); /* tick de 1s = contagem fluida */
    };

    _stop = () => {
        if (this.active) clearInterval(this.active);
        this.active = null;
    };

    toggle = () => {
        if (this.active) {
            this._stop();
            this.log('Auto-Farm em pausa', 'warning');
            this.notify('Auto-Farm em pausa', 'off');
        } else {
            this._start();
            this.log('Auto-Farm iniciado — a coletar...', 'success');
            this.notify('Auto-Farm iniciado!', 'on');
        }
        this.storage.save('af_active', !!this.active);
        this.updateButtons();
    };

    /* =========================================================
       LISTA DE CIDADES
       ========================================================= */
    generateList = () => {
        const islands_list = new Set();
        const polis_list = [];
        const { models: towns } = uw.MM.getOnlyCollectionByName('Town');

        for (const town of towns) {
            const { on_small_island, island_id, id } = town.attributes;
            if (on_small_island || islands_list.has(island_id)) continue;
            islands_list.add(island_id);

            if (this.percent > 0) {
                const { wood, stone, iron, storage } = uw.ITowns.getTown(id).resources();
                const minResource = Math.min(wood, stone, iron);
                const min_percent = storage > 0 ? minResource / storage : 0;
                if (min_percent < this.percent) continue;
            }
            polis_list.push(town.id);
        }
        return polis_list;
    };

    getNextCollection = () => {
        const collection = uw.MM.getOnlyCollectionByName('FarmTownPlayerRelation');
        const models = collection?.models ?? [];
        if (models.length === 0) return 0;

        const lootCounts = {};
        for (const model of models) {
            const { lootable_at } = model.attributes;
            lootCounts[lootable_at] = (lootCounts[lootable_at] || 0) + 1;
        }

        let maxLootableTime = 0, maxValue = 0;
        for (const lootableTime in lootCounts) {
            const value = lootCounts[lootableTime];
            if (value > maxValue) {
                maxLootableTime = parseInt(lootableTime, 10) || 0;
                maxValue = value;
            }
        }
        const seconds = maxLootableTime - Math.floor(Date.now() / 1000);
        return seconds > 0 ? seconds * 1000 : 0;
    };

    /* =========================================================
       LOOP PRINCIPAL
       ========================================================= */
    updateTimer = () => {
        const currentTime = Date.now();
        this.timer -= currentTime - this.lastTime;
        this.lastTime = currentTime;
        this.$count.text(this.formatTime(Math.max(this.timer, 0) / 1000));
        this.updateStats();
    };

    main = async () => {
        if (!this.active) return;

        if (uw.$('.botcheck').length || $('#recaptcha_window').length) {
            if (!this._captchaLogged) { this._captchaLogged = true; this.log('Captcha ativo — farm em pausa', 'error'); }
            return;
        }
        this._captchaLogged = false;

        try {
            this.updateTimer();
            if (this._claiming) return;

            if (this.timer < 30000) {
                const next_collection = this.getNextCollection();
                if (next_collection && this.timer < next_collection) {
                    this.timer = next_collection + Math.floor(Math.random() * 20000) + 10000;
                    return;
                }
            }

            if (this.timer >= 1) return;

            this._claiming = true;
            this.polis_list = this.generateList();
            await this.claim();

            const next_collection = this.getNextCollection();
            const rand = Math.floor(Math.random() * 20000) + 10000;
            this.timer = this.timing + rand;
            if (next_collection && this.timer < next_collection) this.timer = next_collection + rand;
            this.lastTime = Date.now();
            this._farmsCached = 0;
            this.updateButtons();
        } catch (e) {
            this.console.log('[AutoFarm] Erro no main(): ' + (e && e.message ? e.message : e));
            this.log('Erro no ciclo: ' + (e && e.message ? e.message : e), 'error');
        } finally {
            this._claiming = false;
        }
    };

    forceFarm = async () => {
        if (this._claiming) { this.log('Já existe uma coleta em curso...', 'warning'); return; }
        this._claiming = true;
        this.log('Coleta manual iniciada...', 'info');
        try {
            this.polis_list = this.generateList();
            await this.claim();
            const rand = Math.floor(Math.random() * 20000) + 10000;
            this.timer = this.timing + rand;
            this.lastTime = Date.now();
            this._farmsCached = 0;
        } catch (e) {
            this.log('Erro na coleta manual: ' + (e && e.message ? e.message : e), 'error');
        } finally {
            this._claiming = false;
        }
        this.updateButtons();
    };

    /* =========================================================
       CLAIM METHODS
       ========================================================= */
    claimSingle = async (town_id, farm_town_id, relation_id, option) => {
        const data = {
            model_url: 'FarmTownPlayerRelation/' + relation_id,
            action_name: 'claim',
            arguments: { farm_town_id: farm_town_id, type: 'resources', option: option || 1 },
            town_id: town_id,
        };
        try { await this.ajaxPostWithTimeout('frontend_bridge', 'execute', data); } 
        catch (e) { this.console.log('[AutoFarm] Erro claimSingle: ' + e.message); }
    };

    claimMultiple = async (polis_list, base, boost) => {
        const town_id = uw.ITowns.getCurrentTown().id;
        const data = { towns: polis_list, time_option_base: base, time_option_booty: boost, claim_factor: 'normal', town_id: town_id, nl_init: true };
        await this.ajaxPostWithTimeout('farm_town_overviews', 'claim_loads_multiple', data, 90000);
    };

    claimMultipleBatched = async (polis_list, base, boost) => {
        const BATCH_SIZE = 20;
        for (let i = 0; i < polis_list.length; i += BATCH_SIZE) {
            const batch = polis_list.slice(i, i + BATCH_SIZE);
            await this.claimMultiple(batch, base, boost);
            if (i + BATCH_SIZE < polis_list.length) await this.sleep(2000, 500);
        }
    };

    fakeOpening = async () => {
        const town_id = uw.ITowns.getCurrentTown().id;
        await this.ajaxGetWithTimeout('farm_town_overviews', 'index', { town_id: town_id, nl_init: true });
        await this.sleep(10);
        await this.fakeUpdate();
    };

    fakeSelectAll = async () => {
        const town_id = uw.ITowns.getCurrentTown().id;
        await this.ajaxGetWithTimeout('farm_town_overviews', 'get_farm_towns_from_multiple_towns', { town_ids: this.polis_list, town_id: town_id, nl_init: true });
    };

    fakeUpdate = async () => {
        const town = uw.ITowns.getCurrentTown();
        const res = town.getResearches().attributes;
        const bld = town.getBuildings().attributes;
        await this.ajaxGetWithTimeout('farm_town_overviews', 'get_farm_towns_for_town', {
            island_x: town.getIslandCoordinateX(), island_y: town.getIslandCoordinateY(), current_town_id: town.id,
            booty_researched: res.booty ? 1 : 0, diplomacy_researched: res.diplomacy ? 1 : 0, trade_office: bld.trade_office ? 1 : 0, town_id: town.id, nl_init: true
        });
    };

    fakeGuiUpdate = async () => {
        uw.$(".toolbar_button.premium .icon").trigger('mouseenter'); await this.sleep(1019, 127);
        uw.$(".farm_town_overview a").trigger('click'); await this.sleep(1156, 165);
        uw.$(".checkbox.select_all").trigger("click"); await this.sleep(1036, 135);
        uw.$("#fto_claim_button").trigger("click"); await this.sleep(1036, 135);
        const el = uw.$(".confirmation .btn_confirm.button_new");
        if (el.length) { el.trigger("click"); await this.sleep(1036, 135); }
        uw.$(".icon_right.icon_type_speed.ui-dialog-titlebar-close").trigger("click");
    };

    claim = async () => {
        const isCaptainActive = uw.GameDataPremium.isAdvisorActivated('captain');
        const polis_list = this.polis_list;

        if (polis_list.length === 0) {
            this.log(this.percent > 0 ? 'Nenhuma cidade atinge o filtro do armazém.' : 'Nenhuma cidade encontrada!', 'warning');
            return;
        }

        this.log('A coletar ' + polis_list.length + ' cidades (' + (isCaptainActive ? 'Capitão' : 'individual') + ')...', 'info');

        if (isCaptainActive && !this.gui) {
            try {
                await this.fakeOpening(); await this.sleep(2000, 500);
                await this.fakeSelectAll(); await this.sleep(2000, 500);
                if (this.timing <= 600000) await this.claimMultipleBatched(polis_list, 600, 2400);
                else await this.claimMultipleBatched(polis_list, 2400, 10800);
                await this.fakeUpdate();
                setTimeout(() => uw.WMap.removeFarmTownLootCooldownIconAndRefreshLootTimers(), 2000);
                this.log('Coleta concluída (AJAX)', 'success');
                return;
            } catch (e) {
                this.log('AJAX falhou, a tentar GUI...', 'warning');
                try {
                    await this.fakeGuiUpdate();
                    this.log('Coleta concluída (GUI)', 'success');
                    return;
                } catch (e2) {
                    this.log('GUI falhou, coleta individual...', 'warning');
                }
            }
        } else if (isCaptainActive && this.gui) {
            try {
                await this.fakeGuiUpdate();
                this.log('Coleta concluída (GUI)', 'success');
                return;
            } catch (e) {
                this.log('GUI falhou, coleta individual...', 'warning');
            }
        }

        await this._claimOneByOne(polis_list);
        this.log('Coleta individual concluída', 'success');
    };

    _claimOneByOne = async (polis_list) => {
        let max = 60;
        const { models: player_relation_models } = uw.MM.getOnlyCollectionByName('FarmTownPlayerRelation');
        const { models: farm_town_models } = uw.MM.getOnlyCollectionByName('FarmTown');
        const now = Math.floor(Date.now() / 1000);

        for (let town_id of polis_list) {
            let town = uw.ITowns.towns[town_id] || uw.ITowns.getTown(town_id);
            if (!town) continue;
            let x, y;
            try { x = town.getIslandCoordinateX(); y = town.getIslandCoordinateY(); } catch (e) { continue; }

            for (let farm_town of farm_town_models) {
                if (farm_town.attributes.island_x != x || farm_town.attributes.island_y != y) continue;
                for (let relation of player_relation_models) {
                    if (farm_town.attributes.id != relation.attributes.farm_town_id) continue;
                    if (relation.attributes.relation_status !== 1) continue;
                    if (relation.attributes.lootable_at !== null && now < relation.attributes.lootable_at) continue;

                    await this.claimSingle(town_id, relation.attributes.farm_town_id, relation.id, Math.ceil(this.timing / 600000));
                    await this.sleep(500);
                    if (!max) break; else max -= 1;
                }
            }
            if (!max) break;
        }
        setTimeout(() => uw.WMap.removeFarmTownLootCooldownIconAndRefreshLootTimers(), 2000);
    };

    getTotalResources = () => {
        const polis_list = this.generateList();
        let total = { wood: 0, stone: 0, iron: 0, storage: 0 };
        for (let town_id of polis_list) {
            const { wood, stone, iron, storage } = uw.ITowns.getTown(town_id).resources();
            total.wood += wood; total.stone += stone; total.iron += iron; total.storage += storage;
        }
        return total;
    };
}
