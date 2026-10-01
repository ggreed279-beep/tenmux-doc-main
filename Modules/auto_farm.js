/* =========================================================
   AutoFarm (versao melhorada)
   - Base: script original (MultUtil / ModernBot)
   - Adicionado: botao LIGAR/DESLIGAR, notificacoes, log,
     painel de estatisticas, timer formatado mm:ss
   - Mantidos os time_option validados pelo F12
     (600 / 2400 / 10800 / 28800) — NUNCA 300 / 1200
   - Mantido o filtro de percentagem de armazem
     (o script "extra" tinha esse filtro comentado = bug)
   ========================================================= */

var AutoFarm = class extends MultUtil {
    constructor(c, s) {
        super(c, s);

        // Load the settings
        this.timing = this.storage.load('af_level', 300000);
        this.percent = this.storage.load('af_percent', 1);
        this.active = this.storage.load('af_active', false);
        this.gui = this.storage.load('af_gui', false);

        // Create the elements for the new menu
        const { $activity, $count } = this.createActivity("url(https://gpit.innogamescdn.com/images/game/premium_features/feature_icons_2.08.png) no-repeat 0 -240px");
        this.$activity = $activity;
        this.$count = $count;
        this.$activity.on('click', this.toggle);

        this.timer = 0;
        this.lastTime = Date.now();
        this.polis_list = [];

        this.injectStyles();
        this.createDropdown();
        this.updateButtons();

        if (this.active) this.active = this.createGuardedInterval(this.main, 5000);
        this.updateButtons();
    }

    /* =========================================================
       ESTILOS (notificacoes, log, estatisticas)
       ========================================================= */
    injectStyles = () => {
        if (uw.document.getElementById('mult_af_styles')) return;
        const css = `
            .mult_af_stats { background: rgba(0,0,0,0.35); border: 1px solid #3d2b1f; border-radius: 6px; padding: 6px 8px; margin: 4px 0; font-size: 11px; color: #d4c5a0; }
            .mult_af_stats .row { display: flex; justify-content: space-between; margin: 1px 0; }
            .mult_af_stats .val { color: #ffd700; font-weight: bold; }
            .mult_af_log { max-height: 70px; overflow-y: auto; background: rgba(0,0,0,0.4); border: 1px solid #2a1a12; border-radius: 4px; padding: 4px 6px; margin-top: 6px; font-size: 10px; color: #8a8a7a; }
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
       HELPERS DE UI (novos)
       ========================================================= */

    /* Formata segundos como mm:ss */
    formatTime = (totalSeconds) => {
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    };

    /* Notificacao tipo toast no canto superior direito */
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

    /* Entrada no log do dropdown (max 20 linhas) */
    log = (message, type) => {
        if (!this.$log || !this.$log.length) return;
        const time = new Date().toLocaleTimeString();
        const $entry = uw.$('<div></div>').addClass('mult_af_log_' + (type || 'info')).text('[' + time + '] ' + message);
        this.$log.prepend($entry);
        while (this.$log.children().length > 20) this.$log.children().last().remove();
    };

    /* Atualiza o painel de estatisticas */
    updateStats = () => {
        if (!this.$statStatus) return;
        const secs = Math.max(0, Math.round(this.timer / 1000));
        this.$statStatus.text(this.active ? 'Ativo' : 'Parado').css('color', this.active ? '#1aff1a' : '#ff5555');
        this.$statTimer.text(this.formatTime(secs));
        let farms = this.polis_list.length;
        try { farms = this.generateList().length; } catch (e) { /* MM ainda nao pronto */ }
        this.$statFarms.text(farms);
        this.$statNext.text(this.active ? (this.timer > 0 ? this.formatTime(secs) : 'Agora!') : '--');
    };

    /* Create the dropdown menu */
    createDropdown = () => {
        this.$content = uw.$("<div></div>");
        this.$title = uw.$("<p></p>").text(this.t('af_title')).css({ "text-align": "center", "margin": "2px", "font-weight": "bold", "font-size": "16px" });
        this.$content.append(this.$title);

        /* --- NOVO: botao LIGAR / DESLIGAR --- */
        this.$power = uw.$("<p></p>").text('Auto-Farm').css({ "text-align": "left", "margin": "2px", "font-weight": "bold" });
        this.$btnOn = this.createButton("mult_farm_on", "▶ LIGAR", this.togglePower).css({ "width": "110px" });
        this.$btnOff = this.createButton("mult_farm_off", "⏹ DESLIGAR", this.togglePower).css({ "width": "110px" });
        this.$content.append(this.$power, this.$btnOn, this.$btnOff);

        /* --- NOVO: painel de estatisticas --- */
        this.$statStatus = uw.$('<span class="val"></span>');
        this.$statTimer = uw.$('<span class="val"></span>');
        this.$statFarms = uw.$('<span class="val"></span>');
        this.$statNext = uw.$('<span class="val"></span>');
        const row = (label, $val) => uw.$('<div class="row"></div>').append(uw.$('<span></span>').text(label), $val);
        this.$stats = uw.$('<div class="mult_af_stats"></div>').append(
            row('Estado', this.$statStatus),
            row('Timer', this.$statTimer),
            row('Cidades', this.$statFarms),
            row('Próxima', this.$statNext)
        );
        this.$content.append(this.$stats);

        this.$duration = uw.$("<p></p>").text(this.t('af_duration')).css({ "text-align": "left", "margin": "2px", "font-weight": "bold" });
        this.$button5 = this.createButton("mult_farm_5", "5 min", this.toggleDuration);
        this.$button10 = this.createButton("mult_farm_10", "10 min", this.toggleDuration);
        this.$button20 = this.createButton("mult_farm_20", "20 min", this.toggleDuration);
        this.$content.append(this.$duration, this.$button5, this.$button10, this.$button20);

        this.$storage = uw.$("<p></p>").text(this.t('af_storage')).css({ "text-align": "left", "margin": "2px", "font-weight": "bold" });
        this.$button80 = this.createButton("mult_farm_80", "80%", this.toggleStorage).css({ "width": "70px" });
        this.$button90 = this.createButton("mult_farm_90", "90%", this.toggleStorage).css({ "width": "80px" });
        this.$button100 = this.createButton("mult_farm_100", "100%", this.toggleStorage).css({ "width": "80px" });
        this.$content.append(this.$storage, this.$button80, this.$button90, this.$button100);

        this.$gui = uw.$("<p></p>").text(this.t('af_gui')).css({ "text-align": "left", "margin": "2px", "font-weight": "bold" });
        this.$guiOn = this.createButton("mult_farm_gui_on", "ON", this.toggleGui);
        this.$guiOff = this.createButton("mult_farm_gui_off", "OFF", this.toggleGui);
        this.$content.append(this.$gui, this.$guiOn, this.$guiOff);

        /* --- NOVO: log de eventos --- */
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

        this.log('Sistema pronto', 'info');
    }

    /* Update the buttons */
    updateButtons = () => {
        this.$button5.addClass('disabled');
        this.$button10.addClass('disabled');
        this.$button20.addClass('disabled');
        this.$button80.addClass('disabled');
        this.$button90.addClass('disabled');
        this.$button100.addClass('disabled');

        if (this.timing == 300000) this.$button5.removeClass('disabled');
        if (this.timing == 600000) this.$button10.removeClass('disabled');
        if (this.timing == 1200000) this.$button20.removeClass('disabled');

        if (this.percent == 0.8) this.$button80.removeClass('disabled');
        if (this.percent == 0.9) this.$button90.removeClass('disabled');
        if (this.percent == 1) this.$button100.removeClass('disabled');

        /* NOVO: estado dos botoes LIGAR/DESLIGAR */
        this.$btnOn.addClass('disabled');
        this.$btnOff.addClass('disabled');
        if (this.active) this.$btnOn.removeClass('disabled');
        else this.$btnOff.removeClass('disabled');

        if (!this.active) {
            this.$count.css('color', "red");
            this.$count.text("");
        }

        this.$guiOn.addClass('disabled');
        this.$guiOff.addClass('disabled');
        if (this.gui) this.$guiOn.removeClass('disabled');
        else this.$guiOff.removeClass('disabled');

        this.updateStats();
    }

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

        if (id == "mult_farm_80") this.percent = 0.8;
        if (id == "mult_farm_90") this.percent = 0.9;
        if (id == "mult_farm_100") this.percent = 1;

        this.storage.save('af_percent', this.percent);
        this.log('Armazém: ' + (this.percent * 100) + '%', 'info');
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

    /* NOVO: handler dos botoes LIGAR/DESLIGAR */
    togglePower = (event) => {
        const { id } = event.currentTarget;
        if (id === 'mult_farm_on' && !this.active) this.toggle();
        if (id === 'mult_farm_off' && this.active) this.toggle();
    }

    /* Generate the list containing 1 polis per island */
    generateList = () => {
        const islands_list = new Set();
        const polis_list = [];
        let minResource = 0;
        let min_percent = 0;

        const { models: towns } = uw.MM.getOnlyCollectionByName('Town');

        for (const town of towns) {
            const { on_small_island, island_id, id } = town.attributes;
            if (on_small_island || islands_list.has(island_id)) continue;

            islands_list.add(island_id);

            const { wood, stone, iron, storage } = uw.ITowns.getTown(id).resources();
            minResource = Math.min(wood, stone, iron);
            min_percent = storage > 0 ? minResource / storage : 0;

            if (min_percent < this.percent) continue;

            polis_list.push(town.id);
        }

        return polis_list;
    };

    toggle = () => {
        if (this.active) {
            clearInterval(this.active);
            this.active = null;
            this.log('Auto-Farm parado', 'warning');
            this.notify('Auto-Farm parado', 'off');
        } else {
            this.updateTimer();
            this.active = this.createGuardedInterval(this.main, 5000);
            this.log('Auto-Farm iniciado', 'success');
            this.notify('Auto-Farm iniciado!', 'on');
        }

        this.storage.save('af_active', !!this.active);
        this.updateButtons();
    };

    /* Return the time before the next collection */
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
                maxLootableTime = parseInt(lootableTime, 10);
                maxValue = value;
            }
        }

        const seconds = maxLootableTime - Math.floor(Date.now() / 1000);
        return seconds > 0 ? seconds * 1000 : 0;
    };

    /* Call to update the timer */
    updateTimer = () => {
        const currentTime = Date.now();
        this.timer -= currentTime - this.lastTime;
        this.lastTime = currentTime;

        const isCaptainActive = uw.GameDataPremium.isAdvisorActivated('captain');
        const secs = Math.max(0, Math.round(this.timer / 1000));
        this.$count.text(this.formatTime(secs));
        this.$count.css('color', isCaptainActive ? "#1aff1a" : "yellow");
        this.updateStats();
    };

    /* Main loop */
    main = async () => {
        if (window.__multbot_captcha_active) return;
        try {
            const next_collection = this.getNextCollection();
            if (next_collection && (this.timer > next_collection + 60 * 1000 || this.timer < next_collection)) {
                this.timer = next_collection + Math.floor(Math.random() * 20000) + 10000;
            }

            if (this.timer < 1) {
                this.polis_list = this.generateList();

                clearInterval(this.active);
                this.active = null;

                await this.claim();
                this.active = this.createGuardedInterval(this.main, 5000);

                const rand = Math.floor(Math.random() * 20000) + 10000;
                this.timer = this.timing + rand;
                if (this.timer < next_collection) this.timer = next_collection + rand;
            }

            this.updateTimer();
        } catch (e) {
            const msg = '[AutoFarm] Erro no main(): ' + (e && e.message ? e.message : e);
            this.console.log(msg);
            this.log(msg, 'error');
            if (!this.active) this.active = this.createGuardedInterval(this.main, 5000);
        }
    };

    /* =========================================================
       HELPERS INTERNOS — retornam town_id atual para os payloads
       ========================================================= */

    /* Retorna o town_id da cidade atual do jogador */
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
       Payload confirmado pelas screenshots do F12:
       Form Data: towns[], time_option_base, time_option_booty,
                  claim_factor, town_id, nl_init:true
       Query String: town_id, action, h

       Valores validos de time_option confirmados pelo loads_data da resposta:
         600   = 10 minutos (base padrao)
         2400  = 40 minutos (booty padrao / base alternativa)
         10800 = 3 horas
         28800 = 8 horas
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

    /* Simula abertura da janela Farm Town Overview
       Payload confirmado: town_id + nl_init:true (Image 1) */
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

    /* Simula o usuario selecionando todas as cidades
       Payload confirmado: town_ids[], town_id, nl_init:true (Image 3) */
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

    /* Simula update da janela (chamado ao abrir e apos claim)
       Payload confirmado: island_x, island_y, current_town_id,
       booty_researched, diplomacy_researched, trade_office,
       town_id, nl_init:true (Images 2 e 6) */
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

    /* Divide polis_list em lotes de 20 e chama claimMultiple por lote.
       Evita timeout quando o jogador tem muitas cidades (57 no caso atual).
       Cada lote tem pausa de 2s entre si para nao sobrecarregar o servidor. */
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

    /* Orchestrator: decide qual caminho usar */
    claim = async () => {
        const isCaptainActive = uw.GameDataPremium.isAdvisorActivated('captain');

        /* Reutilizamos this.polis_list que ja foi setada no main() */
        const polis_list = this.polis_list;

        if (polis_list.length === 0) {
            this.log('Nenhuma cidade acima do limite de armazém', 'warning');
            return;
        }

        this.log('A coletar ' + polis_list.length + ' cidades...', 'info');

        if (isCaptainActive && !this.gui) {
            /* Caminho rapido AJAX (Captain ativo, GUI desligado):
               Dividido em lotes de 20 via claimMultipleBatched para
               evitar timeout com 57 cidades (limite original: 45s). */
            try {
                await this.fakeOpening();
                await this.sleep(2000, 500);
                await this.fakeSelectAll();
                await this.sleep(2000, 500);

                /* Mapeamento timing -> time_option confirmado pelo loads_data:
                   5 min  (300000ms)  -> base=600,   booty=2400
                   10 min (600000ms)  -> base=600,   booty=2400
                   20 min (1200000ms) -> base=2400,  booty=10800
                   Valores validos: 600, 2400, 10800, 28800 (segundos) */
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
                this.console.log('[AutoFarm] Caminho AJAX direto falhou (' + (e && e.message ? e.message : e) + '), tentando via GUI...');
                this.log('Caminho AJAX falhou, a tentar GUI...', 'warning');
                try {
                    await this.fakeGuiUpdate();
                    this.log('Coleta concluída (GUI)', 'success');
                    this.notify('Recursos coletados!', 'on');
                    return;
                } catch (e2) {
                    this.console.log('[AutoFarm] Caminho GUI tambem falhou (' + (e2 && e2.message ? e2.message : e2) + '), usando coleta individual.');
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
                this.log('Modo GUI falhou, coleta individual...', 'warning');
            }
        }

        /* Fallback: coleta uma por uma (sem Captain ou apos falhas) */
        await this._claimOneByOne(polis_list);
        this.log('Coleta individual concluída', 'success');
        this.notify('Recursos coletados!', 'on');
    };

    /* Coleta cidade a cidade, respeitando limite de 60 por ciclo. */
    _claimOneByOne = async (polis_list) => {
        let max = 60;
        const { models: player_relation_models } = uw.MM.getOnlyCollectionByName('FarmTownPlayerRelation');
        const { models: farm_town_models } = uw.MM.getOnlyCollectionByName('FarmTown');
        const now = Math.floor(Date.now() / 1000);

        for (let town_id of polis_list) {
            let town = uw.ITowns.towns[town_id];
            let x = town.getIslandCoordinateX();
            let y = town.getIslandCoordinateY();

            for (let farm_town of farm_town_models) {
                if (farm_town.attributes.island_x != x) continue;
                if (farm_town.attributes.island_y != y) continue;

                for (let relation of player_relation_models) {
                    if (farm_town.attributes.id != relation.attributes.farm_town_id) continue;
                    if (relation.attributes.relation_status !== 1) continue;
                    if (relation.attributes.lootable_at !== null && now < relation.attributes.lootable_at) continue;

                    await this.claimSingle(town_id, relation.attributes.farm_town_id, relation.id, Math.ceil(this.timing / 600000));
                    await this.sleep(500);
                    if (!max) return;
                    else max -= 1;
                }
            }
        }

        setTimeout(function() { uw.WMap.removeFarmTownLootCooldownIconAndRefreshLootTimers(); }, 2000);
    };

    /* Return the total resources of the polis in the list */
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
