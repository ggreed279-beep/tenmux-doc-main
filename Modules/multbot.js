var MultBot = class {
    constructor() {
        this.console = new BotConsole();
        this.storage = new MultStorage();

        this.$ui = uw.$("#ui_box");
        this.$menu = this.createMultMenu();
        const $divider = uw.$('<div class="divider"></div>');

        this.autoFarm = this._safeInit('AutoFarm', () => new AutoFarm(this.console, this.storage));
        if (this.autoFarm) {
            this.$menu.append(this.autoFarm.$activity);
            this.$ui.append(this.autoFarm.$popup);
        }

        this.autoGratis         = this._safeInit('AutoGratis', () => new AutoGratis(this.console, this.storage));
        this.autoRuralLevel     = this._safeInit('AutoRuralLevel', () => new AutoRuralLevel(this.console, this.storage));
        this.autoBuild          = this._safeInit('AutoBuild', () => new AutoBuild(this.console, this.storage));
        this.autoRuralTrade     = this._safeInit('AutoRuralTrade', () => new AutoRuralTrade(this.console, this.storage));
        this.autoBootcamp       = this._safeInit('AutoBootcamp', () => new AutoBootcamp(this.console, this.storage));
        this.autoParty          = this._safeInit('AutoParty', () => new AutoParty(this.console, this.storage));
        this.autoTrain          = this._safeInit('AutoTrain', () => new AutoTrain(this.console, this.storage));
        this.autoHide           = this._safeInit('AutoHide', () => new AutoHide(this.console, this.storage));
        this.antiRage           = this._safeInit('AntiRage', () => new AntiRage(this.console, this.storage));
        this.autoTrade          = this._safeInit('AutoTrade', () => new AutoTrade(this.console, this.storage));
        this.colonizeShipSender = this._safeInit('ColonizeShipSender', () => new ColonizeShipSender(this.console, this.storage));
        this.multTools          = this._safeInit('MultTools', () => new MultTools(this.console, this.storage));
        this.autoQuest          = this._safeInit('AutoQuest', () => new AutoQuest(this.console, this.storage));
        this.sniper              = this._safeInit('Sniper', () => new Sniper(this.console, this.storage));
        this.discordAlert        = this._safeInit('DiscordAlert', () => new DiscordAlert(this.console, this.storage));
        this.autoMilitia        = this._safeInit('AutoMilitia', () => new AutoMilitia(this.console, this.storage));
        this.autoDodge          = this._safeInit('AutoDodge', () => new AutoDodge(this.console, this.storage));
        this.autoAttack         = this._safeInit('AutoAttack', () => new AutoAttack(this.console, this.storage));
        this.autoCommandPaster  = this._safeInit('AutoCommandPaster', () => new AutoCommandPaster(this.console, this.storage));
        this.autoSpells          = this._safeInit('AutoSpells', () => new AutoSpells(this.console, this.storage));
        this.autoResearch       = this._safeInit('AutoResearch', () => new AutoResearch(this.console, this.storage));
        this.autoSendResources  = this._safeInit('AutoSendResources', () => new AutoSendResources(this.console, this.storage));
        this.autoFestival       = this._safeInit('AutoFestival', () => new AutoFestival(this.console, this.storage));
        this.statusPanel        = this._safeInit('StatusPanel', () => new StatusPanel(this.console, this.storage));

        this.settingsFactory = this._safeInit('SettingsWindow', () => new createGrepoWindow({
            id: 'MULT_BOT',
            title: 'MultBot',
            size: [845, 560],
            tabs: [
                { title: multT('tab_status'), id: 'status', render: this.settingsStatus },
                { title: multT('tab_farm'),   id: 'farm',   render: this.settingsFarm },
                { title: 'Recur/Fest',        id: 'festival', render: this.settingsFestival },
                { title: multT('tab_build'),  id: 'build',  render: this.settingsBuild },
                { title: multT('tab_train'),  id: 'train',  render: this.settingsTrain },
                { title: multT('tab_mix'),    id: 'mix',    render: this.settingsMix },
                { title: multT('tab_attack'), id: 'attack', render: this.settingsAttack },
                { title: multT('sniper_title'), id: 'sniper', render: this.settingsSniper },
                { title: multT('tab_spells'), id: 'spells', render: this.settingsSpells },
                { title: multT('tab_mult'),   id: 'mult',   render: this.settingsMult },
                { title: multT('tab_console'), id: 'console', render: this.console.renderSettings },
            ],
            start_tab: 0,
        }));

        this.setup();
    }

    _safeInit = (name, factory) => {
        try {
            return factory();
        } catch (e) {
            const msg = `[MultBot] ✗ Failed to initialize module "${name}": ${e?.message ?? e}`;
            console.error(msg, e);
            try {
                if (this.console && typeof this.console.log === 'function') this.console.log(msg);
            } catch (_) {}
            return null;
        }
    };

    settingsStatus = () => {
        return this.statusPanel ? this.statusPanel.settings() : this._missingModuleHtml('Status');
    };

    settingsFarm = () => {
        let html = '';
        html += this.autoRuralLevel ? this.autoRuralLevel.settings() : this._missingModuleHtml('Auto Rural Level');
        html += this.autoRuralTrade ? this.autoRuralTrade.settings() : this._missingModuleHtml('Auto Rural Trade');
        html += this.autoSendResources ? this.autoSendResources.settings() : this._missingModuleHtml('Auto Send Resources');
        return html;
    };

    settingsFestival = () => {
        let html = '';
        html += this.autoFestival ? this.autoFestival.settings() : this._missingModuleHtml('Auto Festival');
        return html;
    };

    settingsBuild = () => {
        let html = '';
        html += this.autoGratis ? this.autoGratis.settings() : this._missingModuleHtml('Auto Gratis');
        html += this.autoBuild ? this.autoBuild.settings() : this._missingModuleHtml('Auto Build');
        return html;
    };

    settingsMix = () => {
        let html = '';
        html += this.autoBootcamp ? this.autoBootcamp.settings() : this._missingModuleHtml('Auto Bootcamp');
        html += this.autoParty ? this.autoParty.settings() : this._missingModuleHtml('Auto Party');
        html += this.autoHide ? this.autoHide.settings() : this._missingModuleHtml('Auto Hide');
        html += this.autoMilitia ? this.autoMilitia.settings() : this._missingModuleHtml('Auto Militia');
        html += this.autoDodge ? this.autoDodge.settings() : this._missingModuleHtml('Auto Dodge');
        html += this.autoQuest ? this.autoQuest.settings() : this._missingModuleHtml('Auto Quest');
        html += this.discordAlert ? this.discordAlert.settings() : this._missingModuleHtml('Discord Alert');
        return html;
    };

    settingsAttack = () => {
        let html = '';
        html += this.autoCommandPaster ? this.autoCommandPaster.settings() : this._missingModuleHtml('Command Paster');
        html += this.autoAttack ? this.autoAttack.settings() : this._missingModuleHtml('Auto Attack');
        return html;
    };

    settingsSniper = () => {
        let html = '';
        html += this.sniper ? this.sniper.settings() : this._missingModuleHtml('Sniper');
        return html;
    };

    settingsSpells = () => {
        let html = '';
        html += this.autoSpells ? this.autoSpells.settings() : this._missingModuleHtml('Auto Spells');
        return html;
    };

    settingsTrain = () => {
        let html = '';
        html += this.autoTrain ? this.autoTrain.settings() : this._missingModuleHtml('Auto Train');
        return html;
    };

    settingsMult = () => {
        let html = '';
        html += this.multTools ? this.multTools.settings() : this._missingModuleHtml('Mult Tools');
        html += this.colonizeShipSender ? this.colonizeShipSender.settings() : this._missingModuleHtml('Colonize Ship Sender');
        html += this.autoResearch ? this.autoResearch.settings() : this._missingModuleHtml('Auto Research');
        return html;
    };

    settingsTrade = () => {
        let html = ``;
        html += this.autoTrade ? this.autoTrade.settings() : this._missingModuleHtml('Auto Trade');
        return html;
    };

    _missingModuleHtml = (name) => {
        return `<div class="game_border" style="margin-bottom:20px;">
            <div style="padding:8px;font-size:11px;color:#f87171;">
                ⚠ ${multT('module_failed', { name })}
            </div>
        </div>`;
    };

    setup = () => {
        if (this.settingsFactory) this.settingsFactory.activate();

        // 👈 ALTERADO — engrenagem SVG amarela, centrada, 22px (igual ao peso dos outros ícones)
        uw.$('.gods_area_buttons').append(`
    <div class='circle_button mult_bot_settings' onclick='window.multBot.settingsFactory.openWindow()' style='position:relative;'>
        <div class='icon js-caption' title='MultBot' style='position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); line-height:0;'>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="#ffcc00" xmlns="http://www.w3.org/2000/svg" style="display:block; filter:drop-shadow(0 1px 1px rgba(0,0,0,0.7));">
                <path d="M19.14 12.94a7.07 7.07 0 0 0 .06-.94 7.07 7.07 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.61l-1.92-3.32a.5.5 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.49-.42h-3.84a.5.5 0 0 0-.49.42l-.36 2.54c-.58.24-1.12.55-1.62.94l-2.39-.96a.5.5 0 0 0-.59.22L2.74 8.87a.5.5 0 0 0 .12.61l2.03 1.58c-.04.31-.06.62-.06.94 0 .32.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.61l1.92 3.32c.13.22.39.3.59.22l2.39-.96c.5.39 1.04.7 1.62.94l.36 2.54c.04.24.25.42.49.42h3.84c.24 0 .45-.18.49-.42l.36-2.54c.58-.24 1.12-.55 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.5.5 0 0 0-.12-.61l-2.03-1.58zm-7.14 2.7a3.64 3.64 0 1 1 0-7.28 3.64 3.64 0 0 1 0 7.28z"/>
            </svg>
        </div>
    </div>
`);

        const editController = () => {
            const townController = uw.layout_main_controller.sub_controllers.find(controller => controller.name === 'town_name_area');
            if (!townController) {
                setTimeout(editController, 2500);
                return;
            }

            const oldRender = townController.controller.town_groups_list_view.render;
            townController.controller.town_groups_list_view.render = function () {
                oldRender.call(this);
                const both = `<div style='position: absolute; display:flex; align-items:center; justify-content:center; font-size:13px; margin: 1px; position: absolute; height: 20px; width: 25px; right: 18px;' title='${multT('tooltip_build_and_train')}'>🔨🔧</div>`;
                const build = `<div style='display:flex; align-items:center; justify-content:center; font-size:14px; margin: 1px; position: absolute; height: 20px; width: 25px; right: 18px;' title='${multT('tooltip_build')}'>🔨</div>`;
                const troop = `<div style='display:flex; align-items:center; justify-content:center; font-size:14px; margin: 1px; position: absolute; height: 20px; width: 25px; right: 18px;' title='${multT('tooltip_train')}'>🔧</div>`;
                const townIds = uw.multBot.autoBuild ? Object.keys(uw.multBot.autoBuild.towns_buildings) : [];
                const troopsIds = uw.multBot.autoTrain ? uw.multBot.autoTrain.getActiveList().map(entry => entry.toString()) : [];
                uw.$('.town_group_town').each(function () {
                    const townId = parseInt(uw.$(this).attr('data-townid'));
                    const is_build = townIds.includes(townId.toString());
                    const id_troop = troopsIds.includes(townId.toString());
                    if (!id_troop && !is_build) return;
                    if (id_troop && !is_build) uw.$(this).prepend(troop);
                    else if (is_build && !id_troop) uw.$(this).prepend(build);
                    else uw.$(this).prepend(both);
                });
            };
        };

        setTimeout(editController, 2500);
    };

    createMultMenu = () => {
        const $menu = uw.$('<div id="mult_menu" class="toolbar_activities"></div>');
        $menu.css({
            'position': 'absolute',
            'top': '3px',
            'left': '400px',
            'z-index': '1000',
        });

        const $left = uw.$('<div class="left"></div>');
        const $middle = uw.$('<div class="middle"></div>');
        const $right = uw.$('<div class="right"></div>');

        $menu.append($left, $middle, $right);
        uw.$("#ui_box").prepend($menu);

        return $middle
    }

};

if (!window.__multbot_loaded__) {
    window.__multbot_loaded__ = true;
    var _multbot_loader = setInterval(() => {
        if (uw.$("#loader").length > 0) return;
        uw.multBot = new MultBot();
        clearInterval(_multbot_loader);
    }, 100);
}
