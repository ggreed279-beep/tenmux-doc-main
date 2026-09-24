// ══════════════════════════════════════════════════════
//  MODULE: AutoFarm (HUD Edition v1.0)
//  Dropdown com estilo futurista (neon/cyberpunk).
//  Logica de farm 100% intacta - apenas visual.
// ══════════════════════════════════════════════════════
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

        this.createDropdown();
        this.updateButtons();

        this.timer = 0;
        this.lastTime = Date.now();
        if (this.active) this.active = this.createGuardedInterval(this.main, 5000);
    }

    // ══════════════════════════════════════════════════
    //  ESTILOS HUD (injetados uma única vez)
    // ══════════════════════════════════════════════════
    _injectFarmStyles = () => {
        if (uw.$('#mb-farm-styles').length) return;
        const css = `
            @keyframes mbFarmScan {
                0%   { background-position: 200% 0%; }
                100% { background-position: -200% 0%; }
            }

            .mb-farm-hud {
                background: linear-gradient(135deg, #060816 0%, #0a1020 50%, #060816 100%);
                border: 1px solid rgba(34,211,238,0.4);
                border-radius: 4px;
                padding: 10px;
                font-family: 'SF Mono','Consolas','Monaco','Menlo',monospace;
                color: #a8b8d0;
                position: relative;
                overflow: hidden;
                box-sizing: border-box;
                width: 100%;
                height: 100%;
            }
            .mb-farm-hud::before {
                content: '';
                position: absolute; top: 0; left: 0; right: 0; height: 2px;
                background: linear-gradient(90deg, transparent, #22d3ee, transparent);
                background-size: 200% 100%;
                animation: mbFarmScan 3.5s linear infinite;
                pointer-events: none;
            }
            .mb-farm-hud::after {
                content: '';
                position: absolute; inset: 0;
                background-image:
                    linear-gradient(rgba(34,211,238,0.03) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(34,211,238,0.03) 1px, transparent 1px);
                background-size: 20px 20px;
                pointer-events: none;
                opacity: 0.55;
            }

            .mb-farm-hud-title {
                text-align: center;
                margin-bottom: 10px;
                padding-bottom: 8px;
                border-bottom: 1px solid rgba(34,211,238,0.2);
                position: relative;
                z-index: 1;
            }
            .mb-farm-hud-title .mb-farm-hud-label {
                color: #22d3ee;
                font-size: 12px;
                letter-spacing: 4px;
                font-weight: 700;
                text-transform: uppercase;
                font-family: inherit;
                text-shadow: 0 0 12px rgba(34,211,238,0.7), 0 0 22px rgba(34,211,238,0.3);
            }

            .mb-farm-hud-section {
                margin-bottom: 8px;
                position: relative;
                z-index: 1;
            }
            .mb-farm-hud-section:last-child { margin-bottom: 0; }

            .mb-farm-hud-subtitle {
                display: block;
                font-size: 9px;
                color: #22d3ee;
                letter-spacing: 2.5px;
                text-transform: uppercase;
                margin-bottom: 5px;
                font-weight: 700;
                font-family: inherit;
                text-shadow: 0 0 6px rgba(34,211,238,0.45);
            }
            .mb-farm-hud-subtitle::before {
                content: '▸ ';
                opacity: 0.7;
                margin-right: 2px;
            }

            .mb-farm-hud-row {
                display: flex;
                gap: 5px;
            }

            .mb-farm-pill {
                flex: 1;
                text-align: center;
                padding: 5px 8px;
                border-radius: 3px;
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 1px;
                text-transform: uppercase;
                cursor: pointer;
                transition: all 0.2s ease;
                user-select: none;
                background: rgba(10,16,32,0.6);
                border: 1px solid rgba(34,211,238,0.25);
                color: #5a6a7a;
                font-family: inherit;
                box-sizing: border-box;
            }
            .mb-farm-pill:hover {
                border-color: rgba(34,211,238,0.55);
                color: #22d3ee;
                background: rgba(34,211,238,0.08);
                box-shadow: 0 0 10px rgba(34,211,238,0.2);
            }
            .mb-farm-pill.on {
                background: rgba(0,255,136,0.15);
                border-color: rgba(0,255,136,0.55);
                color: #00ff88;
                box-shadow: 0 0 12px rgba(0,255,136,0.28), inset 0 0 8px rgba(0,255,136,0.08);
                text-shadow: 0 0 6px rgba(0,255,136,0.5);
            }
            .mb-farm-pill.on:hover {
                background: rgba(0,255,136,0.25);
                box-shadow: 0 0 18px rgba(0,255,136,0.5);
            }
        `;
        uw.$('<style id="mb-farm-styles">').text(css).appendTo('head');
    };

    /* Create the dropdown menu — HUD style */
    createDropdown = () => {
        this._injectFarmStyles();

        const $hud = uw.$('<div class="mb-farm-hud"></div>');
        $hud.html(
            '<div class="mb-farm-hud-title">' +
                '<span class="mb-farm-hud-label">◆ Auto Farm ◆</span>' +
            '</div>' +

            '<div class="mb-farm-hud-section">' +
                '<div class="mb-farm-hud-subtitle">Duração</div>' +
                '<div class="mb-farm-hud-row">' +
                    '<span id="mult_farm_5" class="mb-farm-pill">5 min</span>' +
                    '<span id="mult_farm_10" class="mb-farm-pill">10 min</span>' +
                    '<span id="mult_farm_20" class="mb-farm-pill">20 min</span>' +
                '</div>' +
            '</div>' +

            '<div class="mb-farm-hud-section">' +
                '<div class="mb-farm-hud-subtitle">Armazém</div>' +
                '<div class="mb-farm-hud-row">' +
                    '<span id="mult_farm_80" class="mb-farm-pill">80%</span>' +
                    '<span id="mult_farm_90" class="mb-farm-pill">90%</span>' +
                    '<span id="mult_farm_100" class="mb-farm-pill">100%</span>' +
                '</div>' +
            '</div>' +

            '<div class="mb-farm-hud-section">' +
                '<div class="mb-farm-hud-subtitle">Modo GUI</div>' +
                '<div class="mb-farm-hud-row">' +
                    '<span id="mult_farm_gui_on" class="mb-farm-pill">ON</span>' +
                    '<span id="mult_farm_gui_off" class="mb-farm-pill">OFF</span>' +
                '</div>' +
            '</div>'
        );

        // Bind handlers
        $hud.find('#mult_farm_5, #mult_farm_10, #mult_farm_20').on('click', this.toggleDuration);
        $hud.find('#mult_farm_80, #mult_farm_90, #mult_farm_100').on('click', this.toggleStorage);
        $hud.find('#mult_farm_gui_on, #mult_farm_gui_off').on('click', this.toggleGui);

        // Store references for updateButtons
        this.$content = $hud;
        this.$button5   = $hud.find('#mult_farm_5');
        this.$button10  = $hud.find('#mult_farm_10');
        this.$button20  = $hud.find('#mult_farm_20');
        this.$button80  = $hud.find('#mult_farm_80');
        this.$button90  = $hud.find('#mult_farm_90');
        this.$button100 = $hud.find('#mult_farm_100');
        this.$guiOn     = $hud.find('#mult_farm_gui_on');
        this.$guiOff    = $hud.find('#mult_farm_gui_off');

        // Create popup
        this.$popup = this.createPopup(423, 250, 170, this.$content);
        this.$popup.css({ 'height': 'auto', 'min-height': '170px' });
        this.$popup.find('.middle').css({
            'position': 'relative',
            'top': '0', 'bottom': '0', 'left': '0', 'right': '0',
            'padding': '6px',
        });
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
    }

    /* Update the buttons — HUD: ativo = .on (verde neon) */
    updateButtons = () => {
        const setActive = ($btn, isOn) => {
            if (!$btn || !$btn.length) return;
            if (isOn) $btn.addClass('on');
            else $btn.removeClass('on');
        };

        setActive(this.$button5,   this.timing === 300000);
        setActive(this.$button10,  this.timing === 600000);
        setActive(this.$button20,  this.timing === 1200000);
        setActive(this.$button80,  this.percent === 0.8);
        setActive(this.$button90,  this.percent === 0.9);
        setActive(this.$button100, this.percent === 1);
        setActive(this.$guiOn,     this.gui === true);
        setActive(this.$guiOff,    this.gui === false);

        if (!this.active) {
            this.$count.css('color', 'red');
            this.$count.text('');
        }
    }

    toggleDuration = (event) => {
        const { id } = event.currentTarget;

        if (id == "mult_farm_5") this.timing = 300000;
        if (id == "mult_farm_10") this.timing = 600000;
        if (id == "mult_farm_20") this.timing = 1200000;

        this.storage.save('af_level', this.timing);
        this.updateButtons();
    }

    toggleStorage = (event) => {
        const { id } = event.currentTarget;

        if (id == "mult_farm_80") this.percent = 0.8;
        if (id == "mult_farm_90") this.percent = 0.9;
        if (id == "mult_farm_100") this.percent = 1;

        this.storage.save('af_percent', this.percent);
        this.updateButtons();
    }

    toggleGui = (event) => {
        const { id } = event.currentTarget;

        if (id == "mult_farm_gui_on") this.gui = true;
        if (id == "mult_farm_gui_off") this.gui = false;

        this.storage.save('af_gui', this.gui);
        this.updateButtons();
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
            this.updateButtons();
        } else {
            this.updateTimer();
            this.active = this.createGuardedInterval(this.main, 5000);
        }

        this.storage.save('af_active', !!this.active);
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
                maxLootableTime = lootableTime;
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
        this.$count.text(Math.round(Math.max(this.timer, 0) / 1000));
        this.$count.css('color', isCaptainActive ? "#1aff1a" : "yellow");
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
            this.console.log('[AutoFarm] Erro no main(): ' + (e && e.message ? e.message : e));
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
                return;
            } catch (e) {
                this.console.log('[AutoFarm] Caminho AJAX direto falhou (' + (e && e.message ? e.message : e) + '), tentando via GUI...');
                try {
                    await this.fakeGuiUpdate();
                    return;
                } catch (e2) {
                    this.console.log('[AutoFarm] Caminho GUI tambem falhou (' + (e2 && e2.message ? e2.message : e2) + '), usando coleta individual.');
                }
            }
        } else if (isCaptainActive && this.gui) {
            try {
                await this.fakeGuiUpdate();
                return;
            } catch (e) {
                this.console.log('[AutoFarm] Modo GUI falhou (' + (e && e.message ? e.message : e) + '), usando coleta individual.');
            }
        }

        /* Fallback: coleta uma por uma (sem Captain ou apos falhas) */
        await this._claimOneByOne(polis_list);
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

        setTimeout(function() { uw.WMap.removeFarmTownCooldownIconAndRefreshLootTimers(); }, 2000);
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
