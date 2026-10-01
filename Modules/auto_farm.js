/* =========================================================
   AutoFarm — REESCRITA COMPLETA (v3)
   Base: script original (MultUtil / ModernBot)

   O que mudou em relacao ao original:
   - Tick de 1 SEGUNDO: contagem mm:ss fluida (acabou a
     "contagem lenta" de 5 em 5 segundos)
   - START / PAUSE operacionais no dropdown + clique no icone
   - FARM AGORA: coleta manual imediata para testar
   - Ao ligar, farma IMEDIATAMENTE (timer começa em 0)
   - Filtro de armazem com opcao "Todas" (sem filtro) —
     com 80/90/100% so farma cidades com armazem cheio
     nessa %, e era por isso que "nao farmava"
   - Loop nunca morre: erros sao apanhados e o intervalo
     e sempre rearmado; captcha e falhas aparecem no log
   - Sincroniza com o cooldown real do servidor
     (lootable_at) para nunca pedir antes de poder
   - Mantidos os time_option validados pelo F12
     (600 / 2400 / 10800 / 28800) — NUNCA 300 / 1200
   ========================================================= */

var AutoFarm = class extends MultUtil {
    constructor(c, s) {
        super(c, s);

        /* ---------- Configuracoes guardadas ---------- */
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

        /* ---------- Icone + contador na barra ---------- */
        const { $activity, $count } = this.createActivity("url(https://gpit.innogamescdn.com/images/game/premium_features/feature_icons_2.08.png) no-repeat 0 -240px");
        this.$activity = $activity;
        this.$count = $count;
        this.$activity.on('click', this.toggle);

        /* ---------- UI ---------- */
        this.injectStyles();
        this.createDropdown();

        /* ---------- Arranque ---------- */
        const wasActive = !!this.active;
        this.active = null;
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
       HELPERS DE UI
       ========================================================= */

    /* Segundos -> "mm:ss" (ou "h:mm:ss") */
    formatTime = (totalSeconds) => {
        totalSeconds = Math.max(0, Math.round(totalSeconds));
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        const mm = String(m).padStart(2, '0');
        const ss = String(s).padStart(2, '0');
        return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
    };

    /* Notificacao tipo toast */
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

    /* Entrada no log do dropdown (max 25 linhas) */
    log = (message, type) => {
        if (!this.$log || !this.$log.length) return;
        const time = new Date().toLocaleTimeString();
        const $entry = uw.$('<div></div>').addClass('mult_af_log_' + (type || 'info')).text('[' + time + '] ' + message);
        this.$log.prepend($entry);
        while (this.$log.children().length > 25) this.$log.children().last().remove();
    };

    /* Atualiza o painel de estatisticas */
    updateStats = () => {
        if (!this.$statStatus) return;
        const secs = Math.max(0, Math.round(this.timer / 1000));
        this.$statStatus.text(this.active ? 'Ativo' : 'Pausa').css('color', this.active ? '#1aff1a' : '#ff5555');

        let captain = '?';
        try { captain = uw.GameDataPremium.isAdvisorActivated('captain') ? 'Sim' : 'Não'; } catch (e) {}
        this.$statCaptain.text(captain);

        /* Contagem de cidades elegiveis: recalcula so a cada 10s (e caro) */
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
        this.$title = uw.$("<p></p>").text(this.t('af_title')).css({ "text-align": "center", "margin": "2px", "font-weight": "bold", "font-size": "16px" });
        this.$content.append(this.$title);

        /* --- START / PAUSE --- */
        this.$power = uw.$("<p></p>").text('Auto-Farm').css({ "text-align": "left", "margin": "2px", "font-weight": "bold" });
        this.$btnOn = this.createButton("mult_farm_on", "▶ START", () => { if (!this.active) this.toggle(); }).css({ "width": "110px" });
        this.$btnOff = this.createButton("mult_farm_off", "⏸ PAUSE", () => { if (this.active) this.toggle(); }).css({ "width": "110px" });
        this.$content.append(this.$power, this.$btnOn, this.$btnOff);

        /* --- FARM AGORA --- */
        this.$btnNow = this.createButton("mult_farm_now", "🌾 FARM AGORA", this.forceFarm).css({ "width": "220px" });
        this.$content.append(this.$btnNow);

        /* --- Estatisticas --- */
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

        /* --- Intervalo --- */
        this.$duration = uw.$("<p></p>").text(this.t('af_duration')).css({ "text-align": "left", "margin": "2px", "font-weight": "bold" });
        this.$button5 = this.createButton("mult_farm_5", "5 min", this.toggleDuration);
        this.$button10 = this.createButton("mult_farm_10", "10 min", this.toggleDuration);
        this.$button20 = this.createButton("mult_farm_20", "20 min", this.toggleDuration);
        this.$content.append(this.$duration, this.$button5, this.$button10, this.$button20);

        /* --- Armazem (filtro) --- */
        this.$storage = uw.$("<p></p>").text(this.t('af_storage')).css({ "text-align": "left", "margin": "2px", "font-weight": "bold" });
        this.$buttonAll = this.createButton("mult_farm_all", "Todas", this.toggleStorage).css({ "width": "70px" });
        this.$button80 = this.createButton("mult_farm_80", "80%", this.toggleStorage).css({ "width": "60px" });
        this.$button90 = this.createButton("mult_farm_90", "90%", this.toggleStorage).css({ "width": "60px" });
        this.$button100 = this.createButton("mult_farm_100", "100%", this.toggleStorage).css({ "width": "60px" });
        this.$content.append(this.$storage, this.$buttonAll, this.$button80, this.$button90, this.$button100);

        /* --- Modo GUI --- */
        this.$gui = uw.$("<p></p>").text(this.t('af_gui')).css({ "text-align": "left", "margin": "2px", "font-weight": "bold" });
        this.$guiOn = this.createButton("mult_farm_gui_on", "ON", this.toggleGui);
        this.$guiOff = this.createButton("mult_farm_gui_off", "OFF", this.toggleGui);
        this.$content.append(this.$gui, this.$guiOn, this.$guiOff);

        /* --- Log --- */
        this.$log = uw.$('<div class="mult_af_log"></div>');
        this.$content.append(this.$log);

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
            mouseenter: () => {
                this.dropdown_active = true;
                setTimeout(open, 1000);
            },
            mouseleave: () => {
                this.dropdown_active = false;
                setTimeout(close, 50);
            }
        });

        this.$popup.on({
            mouseenter: () => {
                this.dropdown_active = true;
            },
            mouseleave: () => {
                this.dropdown_active = false;
                setTimeout(close, 50);
            }
        });

        this.log('Sistema pronto — prime START', 'info');
    }

    /* =========================================================
       ESTADO DOS BOTOES
       ========================================================= */
    updateButtons = () => {
        this.$button5.addClass('disabled');
        this.$button10.addClass('disabled');
        this.$button20.addClass('disabled');
        this.$buttonAll.addClass('disabled');
        this.$button80.addClass('disabled');
        this.$button90.addClass('disabled');
        this.$button100.addClass('disabled');

        if (this.timing == 300000) this.$button5.removeClass('disabled');
        if (this.timing == 600000) this.$button10.removeClass('disabled');
        if (this.timing == 1200000) this.$button20.removeClass('disabled');

        if (this.percent == 0) this.$buttonAll.removeClass('disabled');
        if (this.percent == 0.8) this.$button80.removeClass('disabled');
        if (this.percent == 0.9) this.$button90.removeClass('disabled');
        if (this.percent == 1) this.$button100.removeClass('disabled');

        this.$btnOn.addClass('disabled');
        this.$btnOff.addClass('disabled');
        if (this.active) this.$btnOn.removeClass('disabled');
        else this.$btnOff.removeClass('disabled');

        if (!this.active) {
            this.$count.css('color', "red");
            this.$count.text("off");
        }

        this.$guiOn.addClass('disabled');
        this.$guiOff.addClass('disabled');
        if (this.gui) this.$guiOn.removeClass('disabled');
        else this.$guiOff.removeClass('disabled');

        this.updateStats();
    }

    /* =========================================================
       HANDLERS DOS BOTOES
       ========================================================= */
    toggleDuration = (event) => {
        const { id } = event.currentTarget;

        if (id == "mult_farm_5") this.timing = 300000;
        if (id == "mult_farm_10") this.timing = 600000;
        if (id == "mult_farm_20") this.timing = 1200000;

        this.storage.save('af_level', this.timing);
        this.log('Intervalo: ' + (this.timing / 60000) + ' min', 'info');
        this.updateButtons();
    }

    toggleStorage = (event) => {
        const { id } = event.currentTarget;

        if (id == "mult_farm_all") this.percent = 0;
        if (id == "mult_farm_80") this.percent = 0.8;
        if (id == "mult_farm_90") this.percent = 0.9;
        if (id == "mult_farm_100") this.percent = 1;

        this.storage.save('af_percent', this.percent);
        this._farmsCached = 0; /* forca recalculo no painel */
        this.log('Armazém: ' + (this.percent === 0 ? 'Todas as cidades' : (this.percent * 100) + '%'), 'info');
        this.updateButtons();
    }

    toggleGui = (event) => {
        const { id } = event.currentTarget;

        if (id == "mult_farm_gui_on") this.gui = true;
        if (id == "mult_farm_gui_off") this.gui = false;

        this.storage.save('af_gui', this.gui);
        this.log('Modo GUI: ' + (this.gui ? 'ON' : 'OFF'), 'info');
        this.updateButtons();
    }

    /* =========================================================
       START / PAUSE
       ========================================================= */
    _start = () => {
        this.lastTime = Date.now();
        this.timer = 0; /* farm IMEDIATO ao ligar */
        this.active = this.createGuardedInterval(this.main, 1000); /* tick de 1s = contagem fluida */
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
       LISTA DE CIDADES (1 por ilha, com filtro de armazem)
       ========================================================= */
    generateList = () => {
        const islands_list = new Set();
        const polis_list = [];

        const { models: towns } = uw.MM.getOnlyCollectionByName('Town');

        for (const town of towns) {
            const { on_small_island, island_id, id } = town.attributes;
            if (on_small_island || islands_list.has(island_id)) continue;

            islands_list.add(island_id);

            /* percent == 0 ("Todas") = sem filtro */
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

    /* =========================================================
       COOLDOWN DO SERVIDOR (proximo lootable_at)
       ========================================================= */
    getNextCollection = () => {
        const collection = uw.MM.getOnlyCollectionByName('FarmTownPlayerRelation');
        const models = collection?.models ?? [];
        if (models.length === 0) return 0;

        const lootCounts = {};
        for (const model of models) {
            const { lootable_at } = model.attributes;
            lootCounts[lootable_at] = (lootCounts[lootable_at] || 0) + 1;
        }

        let maxLootableTime = 0;
        let maxValue = 0;
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
       CONTADOR (chamado a cada segundo)
       ========================================================= */
    updateTimer = () => {
        const currentTime = Date.now();
        this.timer -= currentTime - this.lastTime;
        this.lastTime = currentTime;

        let captain = false;
        try { captain = uw.GameDataPremium.isAdvisorActivated('captain'); } catch (e) {}
        this.$count.text(this.formatTime(Math.max(this.timer, 0) / 1000));
        this.$count.css('color', captain ? "#1aff1a" : "yellow");
        this.updateStats();
    };

    /* =========================================================
       LOOP PRINCIPAL — tick de 1 segundo
       ========================================================= */
    main = async () => {
        if (!this.active) return;

        /* Captcha: pausa silenciosa, mas avisa uma vez no log */
        if (window.__multbot_captcha_active) {
            if (!this._captchaLogged) {
                this._captchaLogged = true;
                this.log('Captcha ativo — farm em pausa', 'error');
            }
            return;
        }
        this._captchaLogged = false;

        try {
            /* 1) Contagem decrescente (sempre, = display fluido) */
            this.updateTimer();

            if (this._claiming) return;

            /* 2) Quando falta pouco, sincroniza com o cooldown real
                  do servidor para nao pedir antes de poder */
            if (this.timer < 30000) {
                const next_collection = this.getNextCollection();
                if (next_collection && this.timer < next_collection) {
                    this.timer = next_collection + Math.floor(Math.random() * 20000) + 10000;
                    return;
                }
            }

            if (this.timer >= 1) return;

            /* 3) HORA DE FARMAR */
            this._claiming = true;
            this.polis_list = this.generateList();
            await this.claim();

            /* 4) Rearma o timer (respeitando cooldown do servidor) */
            const next_collection = this.getNextCollection();
            const rand = Math.floor(Math.random() * 20000) + 10000;
            this.timer = this.timing + rand;
            if (next_collection && this.timer < next_collection) this.timer = next_collection + rand;
            this.lastTime = Date.now();
            this._farmsCached = 0;
            this.updateButtons();
        } catch (e) {
            const msg = '[AutoFarm] Erro no main(): ' + (e && e.message ? e.message : e);
            this.console.log(msg);
            this.log(msg, 'error');
        } finally {
            this._claiming = false;
        }
    };

    /* =========================================================
       FARM AGORA (coleta manual)
       ========================================================= */
    forceFarm = async () => {
        if (this._claiming) {
            this.log('Já existe uma coleta em curso...', 'warning');
            return;
        }
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
       HELPERS INTERNOS
       ========================================================= */

    _getCurrentTownId = () => {
        return uw.ITowns.getCurrentTown().id;
    };

    /* =========================================================
       CLAIM METHODS
       ========================================================= */

    /* Claim resources from a single polis (sem Captain) */
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

    /* Claim resources from multiple polis (Captain ativo)
       Payload confirmado pelas screenshots do F12.
       Valores validos de time_option: 600, 2400, 10800, 28800.
       NUNCA usar 300 ou 1200 — o servidor rejeita silenciosamente. */
    claimMultiple = async (polis_list, base, boost) => {
        if (base === undefined) base = 600;
        if (boost === undefined) boost = 2400;

        const town_id = this._getCurrentTownId();

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

    /* Simula abertura da janela Farm Town Overview */
    fakeOpening = async () => {
        try {
            const town_id = this._getCurrentTownId();
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

    /* Simula o usuario selecionando todas as cidades */
    fakeSelectAll = async () => {
        const town_id = this._getCurrentTownId();
        const data = {
            town_ids: this.polis_list,
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

    /* Simula update da janela */
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

    /* Coleta via GUI real (abre a janela de verdade) */
    fakeGuiUpdate = async () => {
        uw.$(".toolbar_button.premium .icon").trigger('mouseenter');
        await this.sleep(1019.39, 127.54);

        uw.$(".farm_town_overview a").trigger('click');
        await this.sleep(1156.65, 165.62);

        uw.$(".checkbox.select_all").trigger("click");
        await this.sleep(1036.20, 135.69);

        uw.$("#fto_claim_button").trigger("click");
        await this.sleep(1036.20, 135.69);

        const el = uw.$(".confirmation .btn_confirm.button_new");
        if (el.length) {
            el.trigger("click");
            await this.sleep(1036.20, 135.69);
        }

        uw.$(".icon_right.icon_type_speed.ui-dialog-titlebar-close").trigger("click");
    };

    /* Divide polis_list em lotes de 20 para evitar timeout */
    claimMultipleBatched = async (polis_list, base, boost) => {
        var BATCH_SIZE = 20;
        for (var i = 0; i < polis_list.length; i += BATCH_SIZE) {
            var batch = polis_list.slice(i, i + BATCH_SIZE);
            await this.claimMultiple(batch, base, boost);
            if (i + BATCH_SIZE < polis_list.length) {
                await this.sleep(2000, 500);
            }
        }
    };

    /* =========================================================
       ORQUESTRADOR — escolhe o caminho e faz fallback
       ========================================================= */
    claim = async () => {
        const isCaptainActive = uw.GameDataPremium.isAdvisorActivated('captain');
        const polis_list = this.polis_list;

        if (polis_list.length === 0) {
            if (this.percent > 0) {
                this.log('Nenhuma cidade atinge ' + (this.percent * 100) + '% do armazém (prime "Todas" para farmar sem filtro)', 'warning');
            } else {
                this.log('Nenhuma cidade encontrada!', 'warning');
            }
            return;
        }

        this.log('A coletar ' + polis_list.length + ' cidades (' + (isCaptainActive ? 'Capitão' : 'individual') + ')...', 'info');

        if (isCaptainActive && !this.gui) {
            /* Caminho rapido AJAX, em lotes de 20 */
            try {
                await this.fakeOpening();
                await this.sleep(2000, 500);
                await this.fakeSelectAll();
                await this.sleep(2000, 500);

                /* timing -> time_option confirmado pelo loads_data:
                   5/10 min -> base=600, booty=2400
                   20 min   -> base=2400, booty=10800 */
                if (this.timing <= 600000) {
                    await this.claimMultipleBatched(polis_list, 600, 2400);
                } else {
                    await this.claimMultipleBatched(polis_list, 2400, 10800);
                }

                await this.fakeUpdate();
                setTimeout(function() { uw.WMap.removeFarmTownLootCooldownIconAndRefreshLootTimers(); }, 2000);
                this.log('Coleta concluída (AJAX)', 'success');
                this.notify('Recursos coletados!', 'on');
                return;
            } catch (e) {
                this.console.log('[AutoFarm] Caminho AJAX falhou (' + (e && e.message ? e.message : e) + '), tentando via GUI...');
                this.log('AJAX falhou, a tentar GUI...', 'warning');
                try {
                    await this.fakeGuiUpdate();
                    this.log('Coleta concluída (GUI)', 'success');
                    this.notify('Recursos coletados!', 'on');
                    return;
                } catch (e2) {
                    this.console.log('[AutoFarm] GUI falhou (' + (e2 && e2.message ? e2.message : e2) + '), usando coleta individual.');
                    this.log('GUI falhou, coleta individual...', 'warning');
                }
            }
        } else if (isCaptainActive && this.gui) {
            try {
                await this.fakeGuiUpdate();
                this.log('Coleta concluída (GUI)', 'success');
                this.notify('Recursos coletados!', 'on');
                return;
            } catch (e) {
                this.console.log('[AutoFarm] Modo GUI falhou (' + (e && e.message ? e.message : e) + '), usando coleta individual.');
                this.log('GUI falhou, coleta individual...', 'warning');
            }
        }

        /* Fallback final: uma a uma (funciona SEM Capitão) */
        await this._claimOneByOne(polis_list);
        this.log('Coleta individual concluída', 'success');
        this.notify('Recursos coletados!', 'on');
    };

    /* Coleta cidade a cidade (limite 60 por ciclo) */
    _claimOneByOne = async (polis_list) => {
        let max = 60;
        const { models: player_relation_models } = uw.MM.getOnlyCollectionByName('FarmTownPlayerRelation');
        const { models: farm_town_models } = uw.MM.getOnlyCollectionByName('FarmTown');
        const now = Math.floor(Date.now() / 1000);

        for (let town_id of polis_list) {
            let town = uw.ITowns.towns[town_id];
            if (!town) {
                try { town = uw.ITowns.getTown(town_id); } catch (e) { continue; }
            }
            if (!town) continue;

            let x, y;
            try {
                x = town.getIslandCoordinateX();
                y = town.getIslandCoordinateY();
            } catch (e) { continue; }

            for (let farm_town of farm_town_models) {
                if (farm_town.attributes.island_x != x) continue;
                if (farm_town.attributes.island_y != y) continue;

                for (let relation of player_relation_models) {
                    if (farm_town.attributes.id != relation.attributes.farm_town_id) continue;
                    if (relation.attributes.relation_status !== 1) continue;
                    if (relation.attributes.lootable_at !== null && now < relation.attributes.lootable_at) continue;

                    await this.claimSingle(town_id, relation.attributes.farm_town_id, relation.id, Math.ceil(this.timing / 600000));
                    await this.sleep(500);
                    if (!max) break;
                    else max -= 1;
                }
            }
            if (!max) break;
        }

        setTimeout(function() { uw.WMap.removeFarmTownLootCooldownIconAndRefreshLootTimers(); }, 2000);
    };

    /* Total de recursos das cidades na lista */
    getTotalResources = () => {
        const polis_list = this.generateList();

        let total = {
            wood: 0,
            stone: 0,
            iron: 0,
            storage: 0,
        };

        for (let town_id of polis_list) {
            const town = uw.ITowns.getTown(town_id);
            const { wood, stone, iron, storage } = town.resources();
            total.wood += wood;
            total.stone += stone;
            total.iron += iron;
            total.storage += storage;
        }

        return total;
    };
};
