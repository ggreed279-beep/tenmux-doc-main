// ==UserScript==
// @name         ModernBot + Extra Modules + AutoSpells (Final)
// @author       Sau1707 & Adapted
// @description  ModernBot com AutoFarm (500 fixos), AutoSpells e módulos IONIX integrados
// @version      3.0.0-FINAL
// @match        http://*.grepolis.com/game/*
// @match        https://*.grepolis.com/game/*
// @require      http://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js
// @grant        none
// ==/UserScript==

var uw;
if (typeof unsafeWindow == 'undefined') { uw = window; } else { uw = unsafeWindow; }

// ==========================================================================================================
// CLASSE BASE (ModernUtil)
// ==========================================================================================================
class ModernUtil {
    REQUIREMENTS = {
        sword: {}, archer: { research: 'archer' }, hoplite: { research: 'hoplite' }, slinger: { research: 'slinger' },
        catapult: { research: 'catapult' }, rider: { research: 'rider', building: 'barracks', level: 10 },
        chariot: { research: 'chariot', building: 'barracks', level: 15 }, big_transporter: { building: 'docks', level: 1 },
        small_transporter: { research: 'small_transporter', building: 'docks', level: 1 }, bireme: { research: 'bireme', building: 'docks', level: 1 },
        attack_ship: { research: 'attack_ship', building: 'docks', level: 1 }, trireme: { research: 'trireme', building: 'docks', level: 1 },
        colonize_ship: { research: 'colonize_ship', building: 'docks', level: 10 },
    };
    constructor(console, storage) { this.console = console; this.storage = storage; }
    
    sleep = (ms, stdDev) => {
        if (typeof stdDev === 'undefined') return new Promise(resolve => setTimeout(resolve, ms));
        const mean = ms; let u = 0, v = 0;
        while (u === 0) u = Math.random(); while (v === 0) v = Math.random();
        let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        return new Promise(resolve => setTimeout(resolve, num * stdDev + mean));
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

    createGuardedInterval = (fn, ms) => {
        return setInterval(() => { try { fn(); } catch(e) { console.error('Guarded interval error:', e); } }, ms);
    };

    getButtonHtml(id, text, fn, props) {
        const name = this.constructor.name.charAt(0).toLowerCase() + this.constructor.name.slice(1);
        props = isNaN(parseInt(props)) ? `'${props}'` : props;
        return `<div id="${id}" style="cursor: pointer" class="button_new" onclick="window.modernBot.${name}.${fn.name}(${props || ''})"><div class="left"></div><div class="right"></div><div class="caption js-caption"> ${text} <div class="effect js-effect"></div></div></div>`;
    }

    getTitleHtml(id, text, fn, props, enable, desc = '(click to toggle)') {
        const name = this.constructor.name.charAt(0).toLowerCase() + this.constructor.name.slice(1);
        props = isNaN(parseInt(props)) && props ? `"${props}"` : props;
        const filter = 'brightness(100%) saturate(186%) hue-rotate(241deg)';
        return `<div class="game_border_top"></div><div class="game_border_bottom"></div><div class="game_border_left"></div><div class="game_border_right"></div><div class="game_border_corner corner1"></div><div class="game_border_corner corner2"></div><div class="game_border_corner corner3"></div><div class="game_border_corner corner4"></div><div id="${id}" style="cursor: pointer; filter: ${enable ? filter : ''}" class="game_header bold" onclick="window.modernBot.${name}.${fn.name}(${props || ''})">${text}<span class="command_count"></span><div style="position: absolute; right: 10px; top: 4px; font-size: 10px;"> ${desc} </div></div>`;
    }

    countPopulation(obj) {
        const data = GameData.units; let total = 0;
        for (let key in obj) { total += data[key].population * obj[key]; }
        return total;
    }

    createButton = (id, text, fn) => {
        const $button = $('<div>', { 'id': id, 'class': 'button_new' });
        $button.append($('<div>', { 'class': 'left' })).append($('<div>', { 'class': 'right' }));
        $button.append($('<div>', { 'class': 'caption js-caption', 'html': `${text} <div class="effect js-effect"></div>` }));
        if (fn) $(document).on('click', `#${id}`, fn);
        return $button;
    }

    createActivity = (background) => {
        const $activity_wrap = $('<div class="activity_wrap"></div>');
        const $activity = $('<div class="activity"></div>');
        const $icon = $('<div class="icon"></div>').css({ "background": background, "position": "absolute", "top": "-1px", "left": "-1px" });
        const $count = $('<div class="count js-caption"></div>').text(0);
        $icon.append($count); $activity.append($icon); $activity_wrap.append($activity);
        return { $activity, $count };
    }

    createPopup = (left, width, height, $content) => {
        const $box = $('<div class="sandy-box js-dropdown-list"></div>').css({ "left": `${left}px`, "position": "absolute", "width": `${width}px`, "height": `${height}px`, "top": "29px", "margin-left": "0px", "display": "none" });
        const $corner_tl = $('<div class="corner_tl"></div>'); const $corner_tr = $('<div class="corner_tr"></div>');
        const $corner_bl = $('<div class="corner_bl"></div>'); const $corner_br = $('<div class="corner_br"></div>');
        const $border_t = $('<div class="border_t"></div>'); const $border_b = $('<div class="border_b"></div>');
        const $border_l = $('<div class="border_l"></div>'); const $border_r = $('<div class="border_r"></div>');
        const $middle = $('<div class="middle"></div>').css({ "left": "10px", "right": "20px", "top": "14px", "bottom": "20px" });
        const $middle_content = $('<div class="content js-dropdown-item-list"></div>').append($content);
        $middle.append($middle_content);
        $box.append($corner_tl, $corner_tr, $corner_bl, $corner_br, $border_t, $border_b, $border_l, $border_r, $middle);
        return $box;
    }
}

// ==========================================================================================================
// AUTO FARM (Versão 500 Fixos + Interface Bonita)
// ==========================================================================================================
class AutoFarm extends ModernUtil {
    constructor(c, s) {
        super(c, s);
        this.timing = this.storage.load('af_timing', 300000);
        this.percent = this.storage.load('af_percent', 1);
        this.active = this.storage.load('af_active', false);
        this.gui = this.storage.load('af_gui', false);
        this.timer = 0;
        this.lastTime = Date.now();
        this.intervalId = null;
        this.polis_list = [];
        this.injectStyles();
        this.createUI();
        if (this.active) this.startFarm();
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
            .af-log .log-success { color: #8bc34a; } .af-log .log-error { color: #ef5350; } .af-log .log-info { color: #64b5f6; } .af-log .log-warning { color: #ffb74d; }
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
        this.$icon = $('<div class="af-icon"></div>').on('click', () => this.toggle());
        this.$timer = $('<span class="af-timer">00:00</span>');
        this.$status = $('<span class="af-status off"></span>');
        this.createDropdown();
        this.$wrapper.append(this.$status, this.$icon, this.$timer);
        this.$container.append(this.$wrapper, this.$dropdown);
        const $uiBox = $('#ui_box');
        if ($uiBox.length) { $uiBox.append(this.$container); } 
        else { setTimeout(() => this.createUI(), 500); return; }
        this.setupDropdownEvents();
    }

    createDropdown() {
        this.$dropdown = $(`
            <div class="af-dropdown">
                <div class="af-title">🌾 Auto-Farm (500 Fixos)</div>
                <div class="af-section"><label class="af-label">⏱️ Intervalo</label><div class="af-btn-group" id="af-time-group">
                    <div class="af-btn" data-time="5">5min</div><div class="af-btn" data-time="10">10min</div><div class="af-btn" data-time="20">20min</div>
                </div></div>
                <div class="af-section"><label class="af-label">📊 Armazenamento</label><div class="af-btn-group" id="af-percent-group">
                    <div class="af-btn" data-percent="0.8">80%</div><div class="af-btn" data-percent="0.9">90%</div><div class="af-btn" data-percent="1.0">100%</div>
                </div></div>
                <div class="af-section"><label class="af-label">🖥️ Modo GUI</label><div class="af-btn-group" id="af-gui-group">
                    <div class="af-btn" data-gui="0">OFF</div><div class="af-btn" data-gui="1">ON</div>
                </div></div>
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
                <div class="af-log" id="af-log"><div class="log-entry log-info">🔹 Sistema pronto</div></div>
            </div>
        `);
        this.$dropdown.find('#af-time-group .af-btn').on('click', (e) => {
            const time = parseInt($(e.target).data('time')) * 60000;
            this.timing = time; this.storage.save('af_timing', time); this.updateUI(); this.log(`Intervalo: ${time/60000}min`, 'info');
        });
        this.$dropdown.find('#af-percent-group .af-btn').on('click', (e) => {
            const percent = parseFloat($(e.target).data('percent'));
            this.percent = percent; this.storage.save('af_percent', percent); this.updateUI(); this.log(`Armazenamento: ${percent*100}%`, 'info');
        });
        this.$dropdown.find('#af-gui-group .af-btn').on('click', (e) => {
            const gui = parseInt($(e.target).data('gui')) === 1;
            this.gui = gui; this.storage.save('af_gui', gui); this.updateUI(); this.log
