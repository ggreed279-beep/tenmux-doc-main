class AutoFarm extends ModernUtil {
        // Timing options in milliseconds
    static TIMING_OPTIONS = {
                '5min':  300_000,
                '10min': 600_000,
                '20min': 1_200_000,
    };

    // Storage percent options
    static PERCENT_OPTIONS = {
                '80': 0.8,
                '90': 0.9,
                '100': 1.0,
    };

    constructor(c, s) {
                super(c, s);

            // Load settings with validated defaults
            this.timing  = this.storage.load('af_level',   AutoFarm.TIMING_OPTIONS['5min']);
                this.percent = this.storage.load('af_percent', AutoFarm.PERCENT_OPTIONS['100']);
                this.active  = this.storage.load('af_active',  false);
                this.gui     = this.storage.load('af_gui',     false);

            // Build toolbar icon
            const { $activity, $count } = this.createActivity(
                            "url(https://gpit.innogamescdn.com/images/game/premium_features/feature_icons_2.08.png) no-repeat 0 -240px"
                        );
                this.$activity = $activity;
                this.$count    = $count;
                this.$activity.on('click', this.toggle);

            this.createDropdown();
                this.updateButtons();

            this.timer    = 0;
                this.lastTime = Date.now();

            // Resume interval if was active before reload
            if (this.active) {
                            this.active = setInterval(this.main, 1000);
            }
    }

    /* ── Dropdown ─────────────────────────────────────────────── */

    createDropdown = () => {
                this.$content = $('<div></div>');

            // Title
            $('<p>Modern Farm</p>').css({
                            textAlign:  'center',
                            margin:     '2px',
                            fontWeight: 'bold',
                            fontSize:   '16px',
            }).appendTo(this.$content);

            // Duration buttons
            $('<p>Duration:</p>').css({ textAlign: 'left', margin: '2px', fontWeight: 'bold' })
                    .appendTo(this.$content);
                this.$button5  = this.createButton('modern_farm_5',  '5 min',  this.toggleDuration);
                this.$button10 = this.createButton('modern_farm_10', '10 min', this.toggleDuration);
                this.$button20 = this.createButton('modern_farm_20', '20 min', this.toggleDuration);
                this.$content.append(this.$button5, this.$button10, this.$button20);

            // Storage buttons
            $('<p>Storage:</p>').css({ textAlign: 'left', margin: '2px', fontWeight: 'bold' })
                    .appendTo(this.$content);
                this.$button80  = this.createButton('modern_farm_80',  '80%',  this.toggleStorage).css({ width: '70px' });
                this.$button90  = this.createButton('modern_farm_90',  '90%',  this.toggleStorage).css({ width: '80px' });
                this.$button100 = this.createButton('modern_farm_100', '100%', this.toggleStorage).css({ width: '80px' });
                this.$content.append(this.$button80, this.$button90, this.$button100);

            // GUI toggle
            $('<p>Gui:</p>').css({ textAlign: 'left', margin: '2px', fontWeight: 'bold' })
                    .appendTo(this.$content);
                this.$guiOn  = this.createButton('modern_farm_gui_on',  'ON',  this.toggleGui);
                this.$guiOff = this.createButton('modern_farm_gui_off', 'OFF', this.toggleGui);
                this.$content.append(this.$guiOn, this.$guiOff);

            // Popup
            this.$popup = this.createPopup(423, 250, 170, this.$content);
                this.dropdown_active = false;

            const close = () => { if (!this.dropdown_active) this.$popup.hide(); this.dropdown_active = false; };
                const open  = () => { if (this.dropdown_active)  this.$popup.show(); };

            this.$activity.on({
                            mouseenter: () => { this.dropdown_active = true;  setTimeout(open,  1000); },
                            mouseleave: () => { this.dropdown_active = false; setTimeout(close, 50);   },
            });
                this.$popup.on({
                                mouseenter: () => { this.dropdown_active = true; },
                                mouseleave: () => { this.dropdown_active = false; setTimeout(close, 50); },
                });
    };

    /* ── Button state ─────────────────────────────────────────── */

    updateButtons = () => {
                // Reset all to disabled
            [this.$button5, this.$button10, this.$button20,
                      this.$button80, this.$button90, this.$button100,
                      this.$guiOn, this.$guiOff].forEach(b => b.addClass('disabled'));

            // Activate current timing
            const timingMap = {
                            [AutoFarm.TIMING_OPTIONS['5min']]:  this.$button5,
                            [AutoFarm.TIMING_OPTIONS['10min']]: this.$button10,
                            [AutoFarm.TIMING_OPTIONS['20min']]: this.$button20,
            };
                timingMap[this.timing]?.removeClass('disabled');

            // Activate current percent
            const percentMap = {
                            [AutoFarm.PERCENT_OPTIONS['80']]:  this.$button80,
                            [AutoFarm.PERCENT_OPTIONS['90']]:  this.$button90,
                            [AutoFarm.PERCENT_OPTIONS['100']]: this.$button100,
            };
                percentMap[this.percent]?.removeClass('disabled');

            // Active/inactive indicator
            if (!this.active) {
                            this.$count.css('color', 'red').text('');
            }

            // GUI toggle
            if (this.gui) this.$guiOn.removeClass('disabled');
                else          this.$guiOff.removeClass('disabled');
    };

    /* ── Toggle handlers ──────────────────────────────────────── */

    toggleDuration = (event) => {
                const { id } = event.currentTarget;
                const map = {
                                'modern_farm_5':  AutoFarm.TIMING_OPTIONS['5min'],
                                'modern_farm_10': AutoFarm.TIMING_OPTIONS['10min'],
                                'modern_farm_20': AutoFarm.TIMING_OPTIONS['20min'],
                };
                if (map[id] !== undefined) {
                                this.timing = map[id];
                                this.storage.save('af_level', this.timing);
                                this.updateButtons();
                }
    };

    toggleStorage = (event) => {
                const { id } = event.currentTarget;
                const map = {
                                'modern_farm_80':  AutoFarm.PERCENT_OPTIONS['80'],
                                'modern_farm_90':  AutoFarm.PERCENT_OPTIONS['90'],
                                'modern_farm_100': AutoFarm.PERCENT_OPTIONS['100'],
                };
                if (map[id] !== undefined) {
                                this.percent = map[id];
                                this.storage.save('af_percent', this.percent);
                                this.updateButtons();
                }
    };

    toggleGui = (event) => {
                const { id } = event.currentTarget;
                this.gui = (id === 'modern_farm_gui_on');
                this.storage.save('af_gui', this.gui);
                this.updateButtons();
    };

    /* ── Town helpers ─────────────────────────────────────────── */

    /**
         * Returns one representative town ID per large island whose resources
         * are below the configured threshold (this.percent).
         */
    generateList = () => {
                const islandsSeen = new Set();
                const result      = [];

            for (const town of uw.MM.getOnlyCollectionByName('Town').models) {
                            const { island_id, id, on_small_island } = town.attributes;
                            if (on_small_island || islandsSeen.has(island_id)) continue;

                    islandsSeen.add(island_id);
                            result.push(id);
            }
                return result;
    };

    /** Returns aggregate resources across all eligible towns. */
    getTotalResources = () => {
                const totals = { wood: 0, stone: 0, iron: 0, storage: 0 };
                for (const town_id of this.generateList()) {
                                const { wood, stone, iron, storage } = uw.ITowns.getTown(town_id).resources();
                                totals.wood    += wood;
                                totals.stone   += stone;
                                totals.iron    += iron;
                                totals.storage += storage;
                }
                return totals;
    };

    /** Returns milliseconds until the next loot collection window. */
    getNextCollection = () => {
                const { models } = uw.MM.getCollections().FarmTownPlayerRelation[0];

            // Find the lootable_at timestamp shared by the most farm towns
            const counts = {};
                for (const model of models) {
                                const t = model.attributes.lootable_at;
                                counts[t] = (counts[t] || 0) + 1;
                }

            let bestTime  = 0;
                let bestCount = 0;
                for (const [t, n] of Object.entries(counts)) {
                                if (n > bestCount) { bestTime = t; bestCount = n; }
                }

            const seconds = bestTime - Math.floor(Date.now() / 1000);
                return seconds > 0 ? seconds * 1000 : 0;
    };

    /* ── Timer display ────────────────────────────────────────── */

    updateTimer = () => {
                const now        = Date.now();
                this.timer      -= now - this.lastTime;
                this.lastTime    = now;

            const isCaptain  = uw.GameDataPremium.isAdvisorActivated('captain');
                const display    = Math.round(Math.max(this.timer, 0) / 1000);

            this.$count
                    .text(display)
                    .css('color', isCaptain ? '#1aff1a' : 'yellow');
    };

    /* ── Toggle on/off ────────────────────────────────────────── */

    toggle = () => {
                if (this.active) {
                                clearInterval(this.active);
                                this.active = null;
                                this.updateButtons();
                } else {
                                this.updateTimer();
                                this.active = setInterval(this.main, 1000);
                }
                this.storage.save('af_active', !!this.active);
    };

    /* ── Claim logic ──────────────────────────────────────────── */

    claim = async () => {
                const isCaptain = uw.GameDataPremium.isAdvisorActivated('captain');

            if (isCaptain && !this.gui) {
                            // Fast headless path: fake the UI sequence then bulk-claim
                    await this.fakeOpening();
                            await this.sleep(Math.random() * 2000 + 1000);
                            await this.fakeSelectAll();
                            await this.sleep(Math.random() * 2000 + 1000);

                    if (this.timing <= AutoFarm.TIMING_OPTIONS['10min']) {
                                        await this.claimMultiple(300, 600);
                    } else {
                                        await this.claimMultiple(1200, 2400);
                    }

                    await this.fakeUpdate();
                            setTimeout(() => uw.WMap.removeFarmTownLootCooldownIconAndRefreshLootTimers(), 2000);
                            return;
            }

            if (isCaptain && this.gui) {
                            await this.fakeGuiUpdate();
                            return;
            }

            // Non-captain path: claim one farm at a time
            let remaining = 60;
                const polis_list          = this.generateList();
                const { models: relations } = uw.MM.getOnlyCollectionByName('FarmTownPlayerRelation');
                const { models: farmTowns } = uw.MM.getOnlyCollectionByName('FarmTown');
                const now = Math.floor(Date.now() / 1000);

            outer: for (const town_id of polis_list) {
                            const town = uw.ITowns.towns[town_id];
                            const ix   = town.getIslandCoordinateX();
                            const iy   = town.getIslandCoordinateY();

                    for (const ft of farmTowns) {
                                        if (ft.attributes.island_x !== ix || ft.attributes.island_y !== iy) continue;

                                for (const rel of relations) {
                                                        const { farm_town_id, relation_status, lootable_at, id: rel_id } = rel.attributes;
                                                        if (farm_town_id  !== ft.attributes.id) continue;
                                                        if (relation_status !== 1) continue;
                                                        if (lootable_at !== null && now < lootable_at) continue;

                                            this.claimSingle(
                                                                        town_id,
                                                                        farm_town_id,
                                                                        rel_id,
                                                                        Math.ceil(this.timing / 600_000)
                                                                    );
                                                        await this.sleep(500);

                                            if (--remaining <= 0) break outer;
                                }
                    }
            }

            setTimeout(() => uw.WMap.removeFarmTownLootCooldownIconAndRefreshLootTimers(), 2000);
    };

    /* ── Main loop ────────────────────────────────────────────── */

    main = async () => {
                const next = this.getNextCollection();

            // Keep timer in sync with the actual next-loot window
            if (next && (this.timer > next + 60_000 || this.timer < next)) {
                            this.timer = next + Math.floor(Math.random() * 20_000) + 10_000;
            }

            if (this.timer < 1) {
                            clearInterval(this.active);
                            this.active = null;
                            await this.claim();
                            this.active = setInterval(this.main, 1000);

                    const rand   = Math.floor(Math.random() * 20_000) + 10_000;
                            this.timer   = this.timing + rand;
                            if (next && this.timer < next) this.timer = next + rand;
            }

            this.updateTimer();
    };

    /* ── Ajax helpers ─────────────────────────────────────────── */

    claimSingle = (town_id, farm_town_id, relation_id, option = 1) => {
                uw.gpAjax.ajaxPost('frontend_bridge', 'execute', {
                                model_url:   `FarmTownPlayerRelation/${relation_id}`,
                                action_name: 'claim',
                                arguments:   { farm_town_id, type: 'resources', option },
                                town_id,
                });
    };

    claimMultiple = (base = 300, boost = 600) =>
                new Promise(resolve => {
                                uw.gpAjax.ajaxPost(
                                                    'farm_town_overviews',
                                                    'claim_loads_multiple',
                                    {
                                                            towns:            this.generateList(),
                                                            time_option_base:  base,
                                                            time_option_booty: boost,
                                                            claim_factor:      'normal',
                                    },
                                                    false,
                                                    resolve
                                                );
                });

    fakeOpening = () =>
                new Promise(resolve => {
                                uw.gpAjax.ajaxGet('farm_town_overviews', 'index', {}, false, async () => {
                                                    await this.sleep(10);
                                                    await this.fakeUpdate();
                                                    resolve();
                                });
                });

    fakeSelectAll = () =>
                new Promise(resolve => {
                                uw.gpAjax.ajaxGet(
                                                    'farm_town_overviews',
                                                    'get_farm_towns_from_multiple_towns',
                                    { town_ids: this.polislist },
                                                    false,
                                                    resolve
                                                );
                });

    fakeUpdate = () =>
                new Promise(resolve => {
                                const town  = uw.ITowns.getCurrentTown();
                                const { attributes: booty }        = town.getResearches();
                                const { attributes: trade_office } = town.getBuildings();

                                        uw.gpAjax.ajaxGet(
                                                            'farm_town_overviews',
                                                            'get_farm_towns_for_town',
                                            {
                                                                    island_x:          town.getIslandCoordinateX(),
                                                                    island_y:          town.getIslandCoordinateY(),
                                                                    current_town_id:   town.id,
                                                                    booty_researched:  booty        ? 1 : 0,
                                                                    diplomacy_researched: '',
                                                                    trade_office:      trade_office ? 1 : 0,
                                            },
                                                            false,
                                                            resolve
                                                        );
                });

    /** Simulate the full GUI flow when gui-mode is on. */
    fakeGuiUpdate = async () => {
                $('.toolbar_button.premium .icon').trigger('mouseenter');
                await this.sleep(1019, 128);

            $('.farm_town_overview a').trigger('click');
                await this.sleep(1157, 166);

            $('.checkbox.select_all').trigger('click');
                await this.sleep(1036, 136);

            $('#fto_claim_button').trigger('click');
                await this.sleep(1036, 136);

            // Confirm if a dialog appears
            const $confirm = $('.confirmation .btn_confirm.button_new');
                if ($confirm.length) {
                                $confirm.trigger('click');
                                await this.sleep(1036, 136);
                }

            $('.icon_right.icon_type_speed.ui-dialog-titlebar-close').trigger('click');
    };
}
