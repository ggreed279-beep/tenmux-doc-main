// Deteta automaticamente se a tua classe base é MultUtil ou ModernUtil
const BaseUtilClass = typeof MultUtil !== 'undefined' ? MultUtil : (typeof ModernUtil !== 'undefined' ? ModernUtil : class {});

class AutoFarm extends BaseUtilClass {
    constructor(c, s) {
        super(c, s);
        this.injectStyles();

        // Compatibilidade de armazenamento (MultUtil/ModernUtil ou GM_ functions)
        const getVal = (key, def) => {
            if (this.storage && typeof this.storage.load === 'function') return this.storage.load(key, def);
            if (typeof GM_getValue !== 'undefined') return GM_getValue(key, def);
            return def;
        };
        const setVal = (key, val) => {
            if (this.storage && typeof this.storage.save === 'function') return this.storage.save(key, val);
            if (typeof GM_setValue !== 'undefined') return GM_setValue(key, val);
        };

        this.timing = parseInt(getVal('af_timing', '300000'));
        this.percent = parseFloat(getVal('af_percent', '1'));
        this.active = getVal('af_active', false);
        this.gui = getVal('af_gui', false);

        this.timer = 0;
        this.lastTime = Date.now();
        this.intervalId = null;
        this.polis_list = [];
        this.getVal = getVal;
        this.setVal = setVal;

        this.createUI();

        if (this.active) {
            this.startFarm();
        }
        this.updateUI();
    }

    injectStyles() {
        if (document.getElementById('af-custom-styles')) return;
        const styles = `
            .af-container { position: absolute; top: 3px; right: 120px; z-index: 999; }
            .af-wrapper { display: flex; align-items: center; background: rgba(0, 0, 0, 0.7); border-radius: 8px; padding: 3px 10px; gap: 8px; border: 1px solid rgba(255, 215, 0, 0.2); backdrop-filter: blur(4px); cursor: pointer; }
            .af-wrapper:hover { border-color: rgba(255, 215, 0, 0.5); }
            .af-icon { width: 28px; height: 28px; background: url(https://gpit.innogamescdn.com/images/game/premium_features/feature_icons_2.08.png) no-repeat 0 -240px; background-size: 28px; border-radius: 4px; transition: all 0.3s; }
            .af-icon.active { box-shadow: 0 0 20px rgba(76, 175, 80, 0.4); animation: af-pulse 2s infinite; }
            @keyframes af-pulse { 0%, 100% { box-shadow: 0 0 10px rgba(76, 175, 80, 0.2); } 50% { box-shadow: 0 0 25px rgba(76, 175, 80, 0.6); } }
            .af-timer { color: #fff; font-size: 13px; font-weight: bold; min-width: 45px; text-align: center; font-family: monospace; text-shadow: 0 0 10px rgba(0,0,0,0.8); }
            .af-timer.warning { color: #ff9800; animation: af-blink 1s infinite; }
            .af-timer.danger { color: #f44336; animation: af-blink 0.5s infinite; }
            @keyframes af-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
            .af-status { width: 10px; height: 10px; border-radius: 50%; display: inline-block; transition: all 0.3s; }
            .af-status.on { background: #4CAF50; box-shadow: 0 0 10px #4CAF50; }
            .af-status.off { background: #f44336; box-shadow: 0 0 10px #f44336; }
            .af-dropdown { display: none; position: absolute; top: 40px; right: 0; background: linear-gradient(180deg, #2c1810 0%, #1a0f0a 100%); border: 1px solid #8b7355; border-radius: 10px; padding: 15px; min-width: 260px; box-shadow: 0 8px 32px rgba(0,0,0,0.8); z-index: 1000; color: #d4c5a0; }
            .af-dropdown.show { display: block; animation: af-slideDown 0.3s ease-out; }
            @keyframes af-slideDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
            .af-title { text-align: center; font-size: 16px; font-weight: bold; color: #ffd700; margin-bottom: 12px; border-bottom: 1px solid #5a4a3a; padding-bottom: 8px; }
            .af-section { margin: 10px 0; }
            .af-label { font-size: 12px; color: #a89070; margin-bottom: 5px; display: block; }
            .af-btn-group { display: flex; gap: 4px; flex-wrap: wrap; }
            .af-btn { padding: 5px 12px; background: linear-gradient(180deg, #3d2b1f 0%, #2a1a12 100%); border: 1px solid #5a4a3a; border-radius: 4px; color: #d4c5a0; cursor: pointer; font-size: 11px; font-weight: bold; transition: all 0.2s; flex: 1; text-align: center; user-select: none; }
            .af-btn:hover { background: linear-gradient(180deg, #4d3b2f 0%, #3a2a22 100%); border-color: #8b7355; }
            .af-btn.active { background: linear-gradient(180deg, #4a7a3a 0%, #2d5a1d 100%); border-color: #6a9a5a; color: #fff; }
            .af-btn.primary { background: linear-gradient(180deg, #7a6a3a 0%, #5a4a2a 100%); border-color: #9a8a5a; font-size: 13px; padding: 8px 12px; }
            .af-btn.primary.active { background: linear-gradient(180deg, #4a8a3a 0%, #2d6a1d 100%); border-color: #6aaa5a; }
            .af-btn.danger { background: linear-gradient(180deg, #7a3a3a 0%, #5a2a2a 100%); border-color: #9a5a5a; }
            .af-stats { background: rgba(0,0,0,0.3); border-radius: 6px; padding: 8px 10px; margin: 8px 0; border: 1px solid #3d2b1f; font-size: 11px; display: grid; grid-template-columns: 1fr 1fr; gap: 3px 10px; }
            .af-stats .value { color: #ffd700; float: right; }
            .af-log { max-height: 60px; overflow-y: auto; background: rgba(0,0,0,0.4); border-radius: 4px; padding: 5px 8px; font-size: 10px; color: #8a8a7a; margin-top: 8px; border: 1px solid #2a1a12; }
            .af-log .log-success { color: #8bc34a; }
            .af-log .log-error { color: #ef5350; }
            .af-log .log-info { color: #64b5f6; }
            .af-log .log-warning { color: #ffb74d; }
            .af-notification { position: fixed; top: 80px; right: 20px; background: rgba(0,0,0,0.85); color: #fff; padding: 12px 20px; border-radius: 8px; border-left: 4px solid #4CAF50; box-shadow: 0 4px 20px rgba(0,0,0,0.5); z-index: 9999; animation: af-slideRight 0.5s ease-out; max-width: 300px; font-size: 13px; backdrop-filter: blur(8px); }
            @keyframes af-slideRight { from { transform: translateX(100px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            .af-notification.fade-out { animation: af-fadeOut 0.5s ease-in forwards; }
            @keyframes af-fadeOut { to { opacity: 0; transform: translateX(50px); } }
        `;
        const styleElem = document.createElement('style');
        styleElem.id = 'af-custom-styles';
        styleElem.textContent = styles;
        document.head.appendChild(styleElem);
    }

    createUI() {
        this.$container = $('<div class="af-container"></div>');
        this.$wrapper = $('<div class="af-wrapper"></div>');
        this.$icon = $('<div class="af-icon"></div>');
        this.$icon.on('click', () => this.toggle());
        this.$timer = $('<span class="af-timer">00:00</span>');
        this.$status = $('<span class="af-status off"></span>');
        this.createDropdown();

        this.$wrapper.append(this.$status, this.$icon, this.$timer);
        this.$container.append(this.$wrapper, this.$dropdown);

        const $uiBox = $('#ui_box');
        if ($uiBox.length) {
            $uiBox.append(this.$container);
        } else {
            setTimeout(() => this.createUI(), 500);
            return;
        }
        this.setupDropdownEvents();
    }

    createDropdown() {
        this.$dropdown = $(`
            <div class="af-dropdown">
                <div class="af-title">🌾 Auto-Farm</div>
                <div class="af-section">
                    <label class="af-label">⏱️ Intervalo</label>
                    <div class="af-btn-group" id="af-time-group">
                        <div class="af-btn" data-time="5">5min</div>
                        <div class="af-btn" data-time="10">10min</div>
                        <div class="af-btn" data-time="20">20min</div>
                    </div>
                </div>
                <div class="af-section">
                    <label class="af-label">📊 Armazenamento</label>
                    <div class="af-btn-group" id="af-percent-group">
                        <div class="af-btn" data-percent="0.8">80%</div>
                        <div class="af-btn" data-percent="0.9">90%</div>
                        <div class="af-btn" data-percent="1.0">100%</div>
                    </div>
                </div>
                <div class="af-section">
                    <label class="af-label">🖥️ Modo GUI</label>
                    <div class="af-btn-group" id="af-gui-group">
                        <div class="af-btn" data-gui="0">OFF</div>
                        <div class="af-btn" data-gui="1">ON</div>
                    </div>
                </div>
                <div class="af-stats">
                    <span>Status: <span class="value" id="af-status-text">Parado</span></span>
                    <span>Timer: <span class="value" id="af-timer-display">--</span></span>
                    <span>Fazendas: <span class="value" id="af-farms-count">0</span></span>
                    <span>Próxima: <span class="value" id="af-next-collect">--</span></span>
                </div>
                <div style="display: flex; gap: 5px; margin-top: 8px;">
                    <div class="af-btn primary" id="af-start-btn">▶ Iniciar</div>
                    <div class="af-btn danger" id="af-stop-btn">⏹ Parar</div>
                </div>
                <div class="af-log" id="af-log">
                    <div class="log-entry log-info">🔹 Sistema pronto</div>
                </div>
            </div>
        `);

        this.$dropdown.find('#af-time-group .af-btn').on('click', (e) => {
            const time = parseInt($(e.target).data('time')) * 60000;
            this.timing = time;
            this.setVal('af_timing', time.toString());
            this.updateUI();
            this.log(`Intervalo: ${time/60000}min`, 'info');
        });

        this.$dropdown.find('#af-percent-group .af-btn').on('click', (e) => {
            const percent = parseFloat($(e.target).data('percent'));
            this.percent = percent;
            this.setVal('af_percent', percent.toString());
            this.updateUI();
            this.log(`Armazenamento: ${percent*100}%`, 'info');
        });

        this.$dropdown.find('#af-gui-group .af-btn').on('click', (e) => {
            const gui = parseInt($(e.target).data('gui')) === 1;
            this.gui = gui;
            this.setVal('af_gui', gui);
            this.updateUI();
            this.log(`GUI Mode: ${gui ? 'ON' : 'OFF'}`, 'info');
        });

        this.$dropdown.find('#af-start-btn').on('click', () => this.startFarm());
        this.$dropdown.find('#af-stop-btn').on('click', () => this.stopFarm());
    }

    setupDropdownEvents() {
        let hoverTimeout = null;
        this.$wrapper.on('mouseenter', () => {
            clearTimeout(hoverTimeout);
            this.$dropdown.addClass('show');
        });
        this.$wrapper.on('mouseleave', () => {
            hoverTimeout = setTimeout(() => {
                if (!this.$dropdown.is(':hover')) {
                    this.$dropdown.removeClass('show');
                }
            }, 300);
        });
        this.$dropdown.on('mouseenter', () => clearTimeout(hoverTimeout));
        this.$dropdown.on('mouseleave', () => {
            hoverTimeout = setTimeout(() => {
                this.$dropdown.removeClass('show');
            }, 300);
        });
    }

    toggle() {
        if (this.active) this.stopFarm();
        else this.startFarm();
    }

    startFarm() {
        if (this.active) return;
        this.active = true;
        this.setVal('af_active', true);
        this.updateTimer();
        this.intervalId = setInterval(() => this.main(), 1000);
        this.log('🚀 Auto-Farm iniciado!', 'success');
        this.showNotification('Auto-Farm iniciado!');
        this.updateUI();
    }

    stopFarm() {
        if (!this.active) return;
        this.active = false;
        this.setVal('af_active', false);
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.log('⏹️ Auto-Farm parado', 'warning');
        this.showNotification('Auto-Farm parado', 'warning');
        this.updateUI();
    }

    generateList() {
        const islands_list = new Set();
        const polis_list = [];
        const { models: towns } = uw.MM.getOnlyCollectionByName('Town');
        for (const town of towns) {
            const { on_small_island, island_id, id } = town.attributes;
            if (on_small_island || islands_list.has(island_id)) continue;
            const { wood, stone, iron, storage } = uw.ITowns.getTown(id).resources();
            const minResource = Math.min(wood, stone, iron);
            const min_percent = minResource / storage;
            islands_list.add(island_id);
            polis_list.push(id);
        }
        return polis_list;
    }

    getTotalResources() {
        const polis_list = this.generateList();
        let total = { wood: 0, stone: 0, iron: 0, storage: 0 };
        for (const town_id of polis_list) {
            const town = uw.ITowns.getTown(town_id);
            const { wood, stone, iron, storage } = town.resources();
            total.wood += wood;
            total.stone += stone;
            total.iron += iron;
            total.storage += storage;
        }
        return total;
    }

    getNextCollection() {
        const { models } = uw.MM.getCollections().FarmTownPlayerRelation[0];
        const lootCounts = {};
        for (const model of models) {
            const { lootable_at } = model.attributes;
            lootCounts[lootable_at] = (lootCounts[lootable_at] || 0) + 1;
        }
        let maxLootableTime = 0;
        let maxValue = 0;
        for (const lootableTime in lootCounts) {
            const value = lootCounts[lootableTime];
            if (value < maxValue) continue;
            maxLootableTime = parseInt(lootableTime);
            maxValue = value;
        }
        const seconds = maxLootableTime - Math.floor(Date.now() / 1000);
        return seconds > 0 ? seconds * 1000 : 0;
    }

    updateTimer() {
        const currentTime = Date.now();
        this.timer -= currentTime - this.lastTime;
        this.lastTime = currentTime;
        const displayTime = Math.max(0, Math.ceil(this.timer / 1000));
        this.$timer.text(this.formatTime(displayTime));
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    async claim() {
        const isCaptainActive = uw.GameDataPremium.isAdvisorActivated('captain');
        this.polis_list = this.generateList();

        if (isCaptainActive && !this.gui) {
            await this.fakeOpening();
            await this.sleep(Math.random() * 2000 + 1000);
            await this.fakeSelectAll();
            await this.sleep(Math.random() * 2000 + 1000);
            if (this.timing <= 600000) {
                await this.claimMultiple(300, 600);
            } else {
                await this.claimMultiple(1200, 2400);
            }
            await this.fakeUpdate();
            setTimeout(() => uw.WMap.removeFarmTownLootCooldownIconAndRefreshLootTimers(), 2000);
            return;
        }

        if (isCaptainActive && this.gui) {
            await this.fakeGuiUpdate();
            return;
        }

        let max = 60;
        const { models: player_relation_models } = uw.MM.getOnlyCollectionByName('FarmTownPlayerRelation');
        const { models: farm_town_models } = uw.MM.getOnlyCollectionByName('FarmTown');
        const now = Math.floor(Date.now() / 1000);

        for (const town_id of this.polis_list) {
            const town = uw.ITowns.towns[town_id];
            const x = town.getIslandCoordinateX();
            const y = town.getIslandCoordinateY();

            for (const farm_town of farm_town_models) {
                if (farm_town.attributes.island_x != x) continue;
                if (farm_town.attributes.island_y != y) continue;

                for (const relation of player_relation_models) {
                    if (farm_town.attributes.id != relation.attributes.farm_town_id) continue;
                    if (relation.attributes.relation_status !== 1) continue;
                    if (relation.attributes.lootable_at !== null && now < relation.attributes.lootable_at) continue;

                    this.claimSingle(town_id, relation.attributes.farm_town_id, relation.attributes.id, Math.ceil(this.timing / 600000));
                    await this.sleep(500);
                    if (!max) return;
                    max -= 1;
                }
            }
        }
        setTimeout(() => uw.WMap.removeFarmTownLootCooldownIconAndRefreshLootTimers(), 2000);
    }

    claimSingle = (town_id, farm_town_id, relation_id, option = 1) => {
        const data = {
            model_url: `FarmTownPlayerRelation/${relation_id}`,
            action_name: 'claim',
            arguments: { farm_town_id: farm_town_id, type: 'resources', option: option },
            town_id: town_id,
        };
        uw.gpAjax.ajaxPost('frontend_bridge', 'execute', data);
    };

    claimMultiple = (base = 300, boost = 600) => {
        return new Promise((resolve) => {
            const data = { towns: this.polis_list, time_option_base: base, time_option_booty: boost, claim_factor: 'normal' };
            uw.gpAjax.ajaxPost('farm_town_overviews', 'claim_loads_multiple', data, false, () => resolve());
        });
    };

    fakeOpening = () => {
        return new Promise((resolve) => {
            uw.gpAjax.ajaxGet('farm_town_overviews', 'index', {}, false, async () => {
                await this.sleep(10);
                await this.fakeUpdate();
                resolve();
            });
        });
    };

    fakeSelectAll = () => {
        return new Promise((resolve) => {
            const data = { town_ids: this.polis_list };
            uw.gpAjax.ajaxGet('farm_town_overviews', 'get_farm_towns_from_multiple_towns', data, false, () => resolve());
        });
    };

    fakeUpdate = () => {
        return new Promise((resolve) => {
            const town = uw.ITowns.getCurrentTown();
            const { attributes: booty } = town.getResearches();
            const { attributes: trade_office } = town.getBuildings();
            const data = {
                island_x: town.getIslandCoordinateX(),
                island_y: town.getIslandCoordinateY(),
                current_town_id: town.id,
                booty_researched: booty ? 1 : 0,
                diplomacy_researched: '',
                trade_office: trade_office ? 1 : 0,
            };
            uw.gpAjax.ajaxGet('farm_town_overviews', 'get_farm_towns_for_town', data, false, () => resolve());
        });
    };

    fakeGuiUpdate = () => {
        return new Promise(async (resolve) => {
            $(".toolbar_button.premium .icon").trigger('mouseenter');
            await this.sleep(1019.39, 127.54);
            $(".farm_town_overview a").trigger('click');
            await this.sleep(1156.65, 165.62);
            $(".checkbox.select_all").trigger("click");
            await this.sleep(1036.20, 135.69);
            $("#fto_claim_button").trigger("click");
            await this.sleep(1036.20, 135.69);
            const el = $(".confirmation .btn_confirm.button_new");
            if (el.length) {
                el.trigger("click");
                await this.sleep(1036.20, 135.69);
            }
            $(".icon_right.icon_type_speed.ui-dialog-titlebar-close").trigger("click");
            resolve();
        });
    };

    main = async () => {
        const next_collection = this.getNextCollection();
        if (next_collection && (this.timer > next_collection + 60 * 1000 || this.timer < next_collection)) {
            this.timer = next_collection + Math.floor(Math.random() * 20000) + 10000;
        }

        if (this.timer < 1) {
            this.polis_list = this.generateList();
            clearInterval(this.intervalId);
            this.intervalId = null;
            await this.claim();
            this.intervalId = setInterval(this.main, 1000);
            const rand = Math.floor(Math.random() * 20000) + 10000;
            this.timer = this.timing + rand;
            if (this.timer < next_collection) {
                this.timer = next_collection + rand;
            }
        }
        this.updateTimer();
        this.updateUI();
    };

    sleep = (ms, stdDev) => {
        if (typeof stdDev === 'undefined') {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
        const mean = ms;
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        num = num * stdDev + mean;
        return new Promise(resolve => setTimeout(resolve, num));
    };

    updateUI() {
        const seconds = Math.max(0, Math.ceil(this.timer / 1000));
        this.$timer.text(this.formatTime(seconds));

        this.$status.removeClass('on off');
        if (this.active) {
            this.$status.addClass('on');
            this.$icon.addClass('active');
        } else {
            this.$status.addClass('off');
            this.$icon.removeClass('active');
        }

        this.$timer.removeClass('warning danger');
        if (this.active) {
            if (this.timer < 10000) this.$timer.addClass('danger');
            else if (this.timer < 30000) this.$timer.addClass('warning');
        }
        this.updateDropdownUI();
    }

    updateDropdownUI() {
        this.$dropdown.find('#af-time-group .af-btn').removeClass('active');
        this.$dropdown.find('#af-time-group .af-btn').each((i, el) => {
            if (parseInt($(el).data('time')) * 60000 === this.timing) $(el).addClass('active');
        });

        this.$dropdown.find('#af-percent-group .af-btn').removeClass('active');
        this.$dropdown.find('#af-percent-group .af-btn').each((i, el) => {
            if (parseFloat($(el).data('percent')) === this.percent) $(el).addClass('active');
        });

        this.$dropdown.find('#af-gui-group .af-btn').removeClass('active');
        this.$dropdown.find('#af-gui-group .af-btn').each((i, el) => {
            if (parseInt($(el).data('gui')) === (this.gui ? 1 : 0)) $(el).addClass('active');
        });

        const $startBtn = this.$dropdown.find('#af-start-btn');
        const $stopBtn = this.$dropdown.find('#af-stop-btn');

        if (this.active) {
            $startBtn.addClass('active').text('▶ Rodando...');
            $stopBtn.show();
        } else {
            $startBtn.removeClass('active').text('▶ Iniciar');
            $stopBtn.hide();
        }

        this.$dropdown.find('#af-status-text').text(this.active ? '✅ Ativo' : '⏸️ Parado');
        const seconds = Math.max(0, Math.ceil(this.timer / 1000));
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        this.$dropdown.find('#af-timer-display').text(`${mins}min ${secs}s`);
        this.$dropdown.find('#af-farms-count').text(this.polis_list?.length || 0);
        const nextCollect = this.timer > 0 ? `${Math.floor(this.timer/60000)}min ${Math.floor((this.timer%60000)/1000)}s` : 'Agora!';
        this.$dropdown.find('#af-next-collect').text(nextCollect);
    }

    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const $log = this.$dropdown.find('#af-log');
        const $entry = $(`<div class="log-entry log-${type}">[${timestamp}] ${message}</div>`);
        $log.prepend($entry);
        while ($log.children().length > 20) {
            $log.children().last().remove();
        }
    }

    showNotification(message, type = 'success') {
        const $notif = $(`<div class="af-notification ${type}">${message}</div>`);
        $('body').append($notif);
        setTimeout(() => {
            $notif.addClass('fade-out');
            setTimeout(() => $notif.remove(), 500);
        }, 3000);
    }
}
