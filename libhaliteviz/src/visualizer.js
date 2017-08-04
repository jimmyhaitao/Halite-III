const PIXI = require("pixi.js");
const $ = require("jquery");
const extraFilters = require("pixi-extra-filters");
const GlowFilter = extraFilters.GlowFilter;
const pako = require("pako");
const msgpack = require("msgpack-lite");

import {Ship} from "./ship";
import * as statistics from "./statistics";
import * as keyboard from "./keyboardControls";

import * as assets from "./assets";

import {
    FrameAnimation,
    PlanetExplosionFrameAnimation,
    ShipExplosionFrameAnimation,
} from "./animation";

export class HaliteVisualizer {
    constructor(replay) {
        this.replay = replay;
        this.stats = new statistics.Statistics(replay);

        this.frame = 0;
        this.time = 0;
        this._playing = false;

        this.timeStep = 0.1;
        this.playSpeed = 0.5;
        this.scrubSpeed = 0.25;
        this.keyboardControls = new keyboard.KeyboardControls(this, {
            "ArrowLeft": "scrubBackwards",
            "KeyA": "scrubBackwards",
            "ArrowRight": "scrubForwards",
            "KeyD": "scrubForwards",
            "Space": () => {
                if (this.isPlaying()) this.pause();
                else this.play();
            },
        });

        const aspectRatio = this.replay.height / this.replay.width;
        this.application = new PIXI.Application(
            assets.VISUALIZER_SIZE,
            2 * assets.STATS_SIZE + assets.VISUALIZER_SIZE * aspectRatio,
            {
                backgroundColor: 0x15223F,
            }
        );
        // Seems to help with pixelation when downscaling
        // Also: make sure textures have power-of-2 dimensions
        this.application.renderer.roundPixels = true;

        this.scale = assets.VISUALIZER_SIZE / Math.max(replay.width, replay.height);
        this.starfield = PIXI.Sprite.from(
            assets.BACKGROUND_IMAGES[Math.floor(Math.random() * assets.BACKGROUND_IMAGES.length)]);
        this.starfield.width = assets.VISUALIZER_SIZE;

        this.planetContainer = new PIXI.Container();
        this.shipContainer = new PIXI.Container();
        this.overlay = new PIXI.Graphics();
        this.lights = new PIXI.Graphics();
        this.lights.blendMode = PIXI.BLEND_MODES.SCREEN;
        this.lights.filters = [new GlowFilter(20, 1.5, 0.5, 0xFFFFFF, 0.3)];
        this.container = new PIXI.Container();
        this.container.position.set(0, 2 * assets.STATS_SIZE);

        this.ships = {};
        this.planets = [];
        for (let i = 0; i < this.replay.planets.length; i++) {
            const planetBase = this.replay.planets[i];
            const planetSprite =
                PIXI.Sprite.from(assets.PLANET_IMAGES[i % assets.PLANET_IMAGES.length]);
            const r = planetBase.r * assets.CELL_SIZE * this.scale;
            planetSprite.width = planetSprite.height = 2 * r;
            planetSprite.anchor.x = 0.5;
            planetSprite.anchor.y = 0.5;
            planetSprite.position.x = this.scale * assets.CELL_SIZE * planetBase.x;
            planetSprite.position.y = this.scale * assets.CELL_SIZE * planetBase.y;

            planetSprite.interactive = true;
            planetSprite.buttonMode = true;
            planetSprite.on("pointerdown", () => {
                this.onSelect("planet", {
                    id: i,
                });
            });

            this.planets.push(planetSprite);
            this.planetContainer.addChild(planetSprite);
        }

        let poi = new PIXI.Graphics();
        this.drawPOI(poi);
        let renderer = new PIXI.CanvasRenderer(
            assets.VISUALIZER_SIZE, assets.VISUALIZER_SIZE);
        let texture = renderer.generateTexture(poi);
        this.poi = PIXI.Sprite.from(texture);

        this.container.addChild(this.starfield, poi, this.planetContainer, this.shipContainer, this.overlay, this.lights);

        this.statsDisplay = new PIXI.Graphics();

        this.shipStrengthLabel = new PIXI.Text("Relative Fleet Strength");
        this.shipStrengthLabel.style.fontSize = assets.STATS_SIZE * 0.6;
        this.planetStrengthLabel = new PIXI.Text("Relative Territory");
        this.planetStrengthLabel.style.fontSize = assets.STATS_SIZE * 0.6;
        this.planetStrengthLabel.position.y = assets.STATS_SIZE;

        this.application.stage.addChild(this.container);
        this.application.stage.addChild(this.statsDisplay);
        this.application.stage.addChild(this.shipStrengthLabel);
        this.application.stage.addChild(this.planetStrengthLabel);

        this.timer = null;

        this.animationQueue = [];
        // Keep track of when ships die this frame, so that we don't
        // draw them after they die
        this.deathFlags = {};

        this.onUpdate = function() {};
        this.onPlay = function() {};
        this.onPause = function() {};
        this.onEnd = function() {};
        this.onSelect = function() {};
        this.onDeselect = function() {};

        this._onKeyUp = null;
        this._onKeyDown = null;
    }

    destroy() {
        this.keyboardControls.destroy();
        this.keyboardControls = null;
        this.pause();
        this.application.destroy(true);
        PIXI.ticker.shared.stop();
    }

    encodeGIF(start, stop) {
        if (!window.GIF) {
            const error = "GIF.js not loaded, can't encode GIF";
            console.error(error);
            return Promise.error(error);
        }

        this.pause();
        PIXI.ticker.shared.stop();
        const gif = new GIF({
            workers: 2,
            quality: 10,
            // TODO:
            workerScript: "assets/js/gif.worker.js",
        });

        this.frame = start.frame;
        this.substep = 0;

        while (this.frame <= stop.frame) {
            this.draw();
            this.application.render();
            const canvas = this.application.renderer.extract.canvas();
            gif.addFrame(canvas, { copy: true });
            this.advanceSubsteps(this.replay.frames[this.frame].length);
        }

        return new Promise((resolve) => {
            gif.on("finished", function(blob) {
                resolve(blob);
            });
            gif.render();
        });
    }

    get currentFrame() {
        return this.replay.frames[this.frame];
    }

    get currentStatistics() {
        let frame = this.currentFrame;
        let planets = { "unowned": 0 };
        let ships = {};
        let total_ships = 0;

        for (let planet of Object.values(frame.planets)) {
            if (planet.owner !== null) {
                if (typeof planets[planet.owner] === "undefined") {
                    planets[planet.owner] = 0;
                }
                planets[planet.owner]++;
            }
            else {
                planets["unowned"]++;
            }
        }

        for (let owner of Object.keys(frame.ships)) {
            for (let ship of Object.values(frame.ships[owner])) {
                if (typeof ships[owner] === "undefined") {
                    ships[owner] = 0;
                }
                ships[owner]++;
                total_ships++;
            }
        }

        return {
            "planets": planets,
            "ships": ships,
            "total_ships": total_ships,
        };
    }

    attach(containerEl) {
        $(containerEl).append(this.application.view);

        this.keyboardControls.attach(document.body);

        this.update();

        this.application.ticker.add((dt) => {
            if (this.isPlaying()) {
                this.advanceTime(this.timeStep * this.playSpeed * dt);
            }
            this.keyboardControls.handleKeys(dt);
            this.draw(dt);

            if (!this.isPlaying() && this.animationQueue.length === 0) {
                console.log("Stopping event loop");
                this.application.stop();
            }
        });
    }

    play() {
        if (this._playing) return;
        this.application.start();

        this._playing = true;

        this.onPlay();
    }

    advanceTime(time) {
        // Interpolate between frames for smoother feel
        const prevFrame = this.frame;

        this.time += time;
        if (this.time >= 1.0) {
            this.frame++;
            this.time = 0;
        }
        else if (this.time < 0.0) {
            this.frame--;
            this.time = 1.0;
        }

        if (this.frame >= this.replay.frames.length) {
            this.pause();
            this.frame = this.replay.frames.length - 1;
            this.time = 1.0;
            this.onEnd();
            return;
        }
        else if (this.frame < 0) {
            this.pause();
            this.frame = 0;
            this.time = 0.0;
        }

        if (prevFrame !== this.frame) {
            this.update();
        }
        this.onUpdate();
    }

    pause() {
        if (!this._playing) return;
        this._playing = false;
        this.onPause();
    }

    scrub(frame, time, dt=1000/60) {
        this.pause();
        this.frame = frame;
        this.time = time;
        if (time === 0.0) {
            this.update();
            this.onUpdate();
        }
        this.draw(dt);
        this.application.render();
    }

    drawPOI(graphics) {
        const side = assets.CELL_SIZE * this.scale;
        for (let poi of this.replay.poi) {
            if (poi.type === "orbit") {
                graphics.beginFill(0, 0);
                graphics.lineStyle(1, 0xFFFFFF, 0.2);
                const x = side * poi.x;
                const y = side * poi.y;
                const a = side * poi.x_axis;
                const b = side * poi.y_axis;
                graphics.drawEllipse(x, y, a, b);
                graphics.endFill();
            }
            else {
                console.log(poi);
            }
        }
    }

    drawPlanet(planet) {
        let planetBase = this.replay.planets[planet.id];

        const side = assets.CELL_SIZE * this.scale;
        const color = planet.owner === null ?
            assets.PLANET_COLOR : assets.PLAYER_COLORS[planet.owner];

        const center_x = side * planetBase.x;
        const center_y = side * (planetBase.y + 0.5);

        const health_factor = planet.health / planetBase.health;
        const health_bar = health_factor * side * (planetBase.r - 1);

        this.planets[planet.id].tint = color;
        this.planets[planet.id].alpha = 1.0;
        this.planets[planet.id].visible = true;
        this.planets[planet.id].interactive = true;
        this.planets[planet.id].buttonMode = true;

        if (planet.health === 0) {
            this.planets[planet.id].alpha = 0;
            this.planets[planet.id].visible = false;
            this.planets[planet.id].interactive = false;
            this.planets[planet.id].buttonMode = false;
        }
        else if (health_factor < 0.25) {
            this.planets[planet.id].alpha = 0.7;
        }

        this.overlay.beginFill(0x990000);
        this.overlay.lineStyle(0, 0x000000);
        this.overlay.drawRect(center_x, center_y - health_bar, side, 2 * health_bar);
        this.overlay.endFill();
    }

    update() {
        this.deathFlags = {
            "planets": {},
        };

        if (this.currentFrame.events) {
            for (let event of this.currentFrame.events) {
                // How much to delay (in terms of ticks) before
                // actually playing the event
                const delayTime = event.time ? event.time / (this.timeStep * this.playSpeed) : 0;
                const cellSize = assets.CELL_SIZE * this.scale;

                if (event.event === "destroyed") {
                    if (event.entity.type === "planet") {
                        this.animationQueue.push(
                            new PlanetExplosionFrameAnimation(
                                event, delayTime, cellSize, this.lights));
                        this.deathFlags["planets"][event.entity.id] = event.time;
                    }
                    else if (event.entity.type === "ship") {
                        // Use default draw function
                        this.animationQueue.push(
                            new ShipExplosionFrameAnimation(
                                event, delayTime, cellSize, this.lights));
                        if (typeof this.deathFlags[event.entity.owner] === "undefined") {
                            this.deathFlags[event.entity.owner] = {};
                        }
                        this.deathFlags[event.entity.owner][event.entity.id] = event.time;
                    }
                    else {
                        console.log("Unknown entity destroyed");
                        console.log(event);
                    }
                }
                else if (event.event === "attack") {
                    const side = assets.CELL_SIZE * this.scale;

                    const x = side * (event.x + 0.5);
                    const y = side * (event.y + 0.5);

                    let attackSprite = PIXI.Sprite.fromImage(assets.ATTACK_IMAGE);
                    attackSprite.anchor.x = 0.5;
                    attackSprite.anchor.y = 0.5;
                    attackSprite.position.x = x;
                    attackSprite.position.y = y;
                    attackSprite.width = 2 * side * this.replay.constants.WEAPON_RADIUS;
                    attackSprite.height = 2 * side * this.replay.constants.WEAPON_RADIUS;
                    attackSprite.tint = assets.PLAYER_COLORS[event.entity.owner];
                    this.container.addChild(attackSprite);

                    this.animationQueue.push(new FrameAnimation(
                        24, delayTime,
                        () => {
                        },
                        (frame) => {
                            attackSprite.alpha = 0.5 * frame / 24;
                        },
                        () => {
                            this.container.removeChild(attackSprite);
                        }
                    ));
                }
                else if (event.event === "spawned") {
                    this.animationQueue.push(new FrameAnimation(
                        24, delayTime,
                        () => {
                        },
                        (frame) => {
                            const side = assets.CELL_SIZE * this.scale;
                            const planetX = side * (event.planet_x + 0.5);
                            const planetY = side * (event.planet_y + 0.5);
                            const ship_x = side * (event.x + 0.5);
                            const ship_y = side * (event.y + 0.5);
                            this.lights.lineStyle(2, assets.PLAYER_COLORS[event.entity.owner], 0.5 * frame / 24);
                            this.lights.moveTo(planetX, planetY);
                            this.lights.lineTo(ship_x, ship_y);
                            this.lights.endFill();
                        },
                        () => {

                        }
                    ));
                }
                else {
                    console.log(event);
                }
            }
        }
    }

    draw(dt=0) {
        this.overlay.clear();
        this.lights.clear();

        for (let planet of Object.values(this.currentFrame.planets)) {
            if (typeof this.deathFlags["planets"][planet.id] !== "undefined") {
                if (this.time < this.deathFlags["planets"][planet.id]) {
                    this.drawPlanet(planet);
                }
            }
            else {
                this.drawPlanet(planet);
            }
        }

        // Handle dead planets
        for (let planet of this.replay.planets) {
            if (typeof this.currentFrame.planets[planet.id] === "undefined") {
                this.drawPlanet({ id: planet.id, owner: null, health: 0 });
            }
        }

        for (let playerShips of Object.values(this.currentFrame.ships)) {
            for (let ship of Object.values(playerShips)) {
                let deathTime = 1.1;
                if (this.deathFlags[ship.owner] &&
                    typeof this.deathFlags[ship.owner][ship.id] !== "undefined") {
                    deathTime = this.deathFlags[ship.owner][ship.id];
                }

                if (this.time < deathTime) {
                    if (typeof this.ships[ship.id] === "undefined") {
                        this.ships[ship.id] = new Ship(this, ship);
                        this.ships[ship.id].attach(this.shipContainer);
                    }
                    this.ships[ship.id].update(ship);
                }
            }
        }

        for (let shipIndex of Object.keys(this.ships)) {
            const ship = this.ships[shipIndex];
            if (!this.currentFrame.ships[ship.owner][ship.id]) {
                ship.destroy();
                delete this.ships[shipIndex];
            }
        }

        this.drawStats();

        // dt comes from Pixi ticker, and the unit is essentially frames
        let queue = this.animationQueue;
        this.animationQueue = [];
        for (let anim of queue) {
            let subdelta = dt;
            if (anim.delayFrames > 0) {
                if (anim.delayFrames >= subdelta) {
                    anim.delayFrames -= subdelta;
                }
                else if (anim.delayFrames < subdelta) {
                    subdelta -= anim.delayFrames;
                    anim.delayFrames = -1;
                }
            }

            if (anim.delayFrames <= 0 && anim.frames >= subdelta) {
                anim.draw(anim.frames);
                anim.frames -= subdelta;
                this.animationQueue.push(anim);
            }
            else if (anim.delayFrames > 0) {
                this.animationQueue.push(anim);
            }
            else {
                anim.finish();
            }
        }
    }

    drawStats() {
        let stats = this.currentStatistics;

        let x = 0;
        for (let player = 0; player < this.replay.num_players; player++) {
            const width = assets.VISUALIZER_SIZE * (stats.ships[player] || 0) / stats.total_ships;
            this.statsDisplay.beginFill(assets.PLAYER_COLORS[player]);
            this.statsDisplay.drawRect(x, 0, width, assets.STATS_SIZE * 0.8);
            this.statsDisplay.endFill();
            x += width;
        }

        x = 0;
        for (let player = 0; player < this.replay.num_players; player++) {
            const width = assets.VISUALIZER_SIZE * (stats.planets[player] || 0) / this.replay.planets.length;
            this.statsDisplay.beginFill(assets.PLAYER_COLORS[player]);
            this.statsDisplay.drawRect(x, assets.STATS_SIZE, width, assets.STATS_SIZE * 0.8);
            this.statsDisplay.endFill();
            x += width;
        }
        const width = assets.VISUALIZER_SIZE * (stats.planets["unowned"] || 0) / this.replay.planets.length;
        this.statsDisplay.beginFill(assets.PLANET_COLOR);
        this.statsDisplay.drawRect(x, assets.STATS_SIZE, width, assets.STATS_SIZE * 0.8);
        this.statsDisplay.endFill();
        this.statsDisplay.drawRect(0, 90, assets.VISUALIZER_SIZE, 10);
    }

    render(dt=1000/60) {
        this.draw(dt);
        this.application.render();
    }

    isPlaying() {
        return this._playing;
    }
}
