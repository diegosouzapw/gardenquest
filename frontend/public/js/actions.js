class ActionHud {
    constructor() {
        this.promptEl = document.getElementById('actionPrompt');
        this.floatingMsgEl = document.getElementById('floatingMsg');
        this.systemNoticeEl = document.getElementById('systemNotice');
        this.applesCountEl = document.getElementById('applesCount');
        this.arrowsCountEl = document.getElementById('arrowsCount');
        this.foodLevelEl = document.getElementById('foodLevel');
        this.waterLevelEl = document.getElementById('waterLevel');
        this.scoreValueEl = document.getElementById('scoreValue');
        this.systemNoticeTimer = null;
    }

    update(selfState) {
        if (!selfState) {
            this._clearPrompt();
            this._updateHudInventory({ apples: 0, arrows: 0, food: 0, water: 0, score: 0 });
            return;
        }

        this._updatePrompt(selfState);
        this._updateHudInventory({
            ...(selfState.inventory || {}),
            score: selfState.score,
        });
    }

    _updatePrompt(selfState) {
        if (!this.promptEl) return;

        if (selfState.status === 'dead') {
            const seconds = Math.max(1, Math.ceil((Number(selfState.respawnCountdownMs) || 0) / 1000));
            this.promptEl.innerHTML = `Voce morreu. Respawn em <kbd>${seconds}</kbd>s`;
            this.promptEl.classList.add('visible');
            return;
        }

        const availableActions = selfState.availableActions || {};
        const actionCooldownMs = Number(selfState.actionCooldownMs) || 0;
        const promptLines = [];
        let currentUseAction = null;
        let currentItemAction = null;

        if (availableActions.elevator_up) {
            currentUseAction = 'elevator_up';
        } else if (availableActions.elevator_down) {
            currentUseAction = 'elevator_down';
        } else if (availableActions.attack_sword) {
            currentUseAction = 'attack_sword';
        } else if (availableActions.shoot_arrow) {
            currentUseAction = 'shoot_arrow';
        } else if (availableActions.kick_ball) {
            currentUseAction = 'kick';
        } else if (availableActions.drink_water) {
            currentUseAction = 'drink';
        } else if (availableActions.eat_fruit) {
            currentUseAction = 'eat';
        }

        if (availableActions.drop_sword) {
            currentItemAction = 'drop_sword';
        } else if (availableActions.drop_bow) {
            currentItemAction = 'drop_bow';
        } else if (availableActions.drop_fruit) {
            currentItemAction = 'drop_fruit';
        } else if (availableActions.pick_sword) {
            currentItemAction = 'pick_sword';
        } else if (availableActions.pick_bow) {
            currentItemAction = 'pick_bow';
        } else if (availableActions.pick_fruit) {
            currentItemAction = 'pick_fruit';
        }

        if (actionCooldownMs <= 0) {
            if (currentUseAction === 'elevator_up') {
                promptLines.push('Pressione <kbd>E</kbd> para subir pelo elevador');
            } else if (currentUseAction === 'elevator_down') {
                promptLines.push('Pressione <kbd>E</kbd> para descer pelo elevador');
            } else if (currentUseAction === 'attack_sword') {
                promptLines.push('Pressione <kbd>E</kbd> para golpear com a espada');
            } else if (currentUseAction === 'shoot_arrow') {
                promptLines.push('Pressione <kbd>E</kbd> para atirar com o arco');
            } else if (currentUseAction === 'kick') {
                promptLines.push('Pressione <kbd>E</kbd> para chutar a bola');
            } else if (currentUseAction === 'drink') {
                promptLines.push('Pressione <kbd>E</kbd> para beber agua');
            } else if (currentUseAction === 'eat') {
                promptLines.push('Pressione <kbd>E</kbd> para comer a maca');
            }

            if (currentItemAction === 'pick_sword') {
                promptLines.push('Pressione <kbd>F</kbd> para pegar a espada');
            } else if (currentItemAction === 'drop_sword') {
                promptLines.push('Pressione <kbd>F</kbd> para soltar a espada');
            } else if (currentItemAction === 'pick_bow') {
                promptLines.push('Pressione <kbd>F</kbd> para pegar o arco');
            } else if (currentItemAction === 'drop_bow') {
                promptLines.push('Pressione <kbd>F</kbd> para soltar o arco');
            } else if (currentItemAction === 'pick_fruit') {
                promptLines.push('Pressione <kbd>F</kbd> para pegar a maca');
            } else if (currentItemAction === 'drop_fruit') {
                promptLines.push('Pressione <kbd>F</kbd> para soltar a maca');
            }
        }

        if (promptLines.length > 0) {
            this.promptEl.innerHTML = promptLines.join('<br>');
            this.promptEl.classList.add('visible');
            return;
        }

        this._clearPrompt();
    }

    _clearPrompt() {
        if (!this.promptEl) return;
        this.promptEl.classList.remove('visible');
    }

    _updateHudInventory(inventory) {
        if (this.applesCountEl) {
            this.applesCountEl.textContent = Number.isFinite(inventory.apples) ? inventory.apples : 0;
        }

        if (this.arrowsCountEl) {
            this.arrowsCountEl.textContent = Number.isFinite(inventory.arrows) ? inventory.arrows : 0;
        }

        if (this.scoreValueEl) {
            this.scoreValueEl.textContent = Number.isFinite(inventory.score) ? Math.max(0, Math.round(inventory.score)) : 0;
        }

        if (this.foodLevelEl) {
            const foodLevel = Number.isFinite(inventory.food) ? inventory.food : 0;
            this.foodLevelEl.textContent = `${Math.round(foodLevel)}%`;
            this._applyLevelTone(this.foodLevelEl, foodLevel);
        }

        if (this.waterLevelEl) {
            const waterLevel = Number.isFinite(inventory.water) ? inventory.water : 0;
            this.waterLevelEl.textContent = `${Math.round(waterLevel)}%`;
            this._applyLevelTone(this.waterLevelEl, waterLevel);
        }
    }

    _applyLevelTone(element, level) {
        if (!element) return;

        if (level < 20) {
            element.style.color = '#f87171';
        } else if (level < 50) {
            element.style.color = '#fbbf24';
        } else {
            element.style.color = '#38bd7e';
        }
    }

    showFloatingMessage(text, tone = 'success') {
        if (!this.floatingMsgEl) return;

        this.floatingMsgEl.textContent = text;
        this.floatingMsgEl.classList.toggle('error', tone === 'error');
        this.floatingMsgEl.classList.remove('show');

        void this.floatingMsgEl.offsetWidth;

        this.floatingMsgEl.classList.add('show');

        setTimeout(() => {
            this.floatingMsgEl.classList.remove('show');
        }, 1500);
    }

    showSystemNotice(text) {
        if (!this.systemNoticeEl) return;

        if (this.systemNoticeTimer) {
            window.clearTimeout(this.systemNoticeTimer);
        }

        this.systemNoticeEl.textContent = text;
        this.systemNoticeEl.classList.remove('show');
        void this.systemNoticeEl.offsetWidth;
        this.systemNoticeEl.classList.add('show');

        this.systemNoticeTimer = window.setTimeout(() => {
            this.systemNoticeEl.classList.remove('show');
            this.systemNoticeTimer = null;
        }, 2600);
    }
}

class ActionSoundboard {
    constructor() {
        this.AudioContextCtor = window.AudioContext || window.webkitAudioContext || null;
        this.audioContext = null;
        this.masterGain = null;
        this.noiseBuffer = null;
        this._unlockHandler = () => {
            this.prime();
        };

        if (this.AudioContextCtor) {
            window.addEventListener('pointerdown', this._unlockHandler, { passive: true });
            window.addEventListener('keydown', this._unlockHandler, { passive: true });
            window.addEventListener('touchstart', this._unlockHandler, { passive: true });
        }
    }

    _removeUnlockListeners() {
        window.removeEventListener('pointerdown', this._unlockHandler);
        window.removeEventListener('keydown', this._unlockHandler);
        window.removeEventListener('touchstart', this._unlockHandler);
    }

    _ensureContext() {
        if (!this.AudioContextCtor) {
            return null;
        }

        if (!this.audioContext) {
            this.audioContext = new this.AudioContextCtor();
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = 0.18;
            this.masterGain.connect(this.audioContext.destination);
        }

        if (this.audioContext.state === 'running') {
            this._removeUnlockListeners();
        }

        return this.audioContext;
    }

    prime() {
        const ctx = this._ensureContext();
        if (!ctx || ctx.state !== 'suspended') {
            return;
        }

        ctx.resume()
            .then(() => {
                this._removeUnlockListeners();
            })
            .catch(() => {});
    }

    playAction(action) {
        const ctx = this._ensureContext();
        if (!ctx) {
            return;
        }

        this.prime();

        const startAt = ctx.currentTime + 0.01;
        switch (action) {
            case 'ride_elevator':
                this._playElevator(startAt);
                break;
            case 'kick_ball':
                this._playKick(startAt);
                break;
            case 'drop_fruit':
                this._playDropFruit(startAt);
                break;
            case 'drop_sword':
                this._playDropSword(startAt);
                break;
            case 'drop_bow':
                this._playDropBow(startAt);
                break;
            case 'drink_water':
                this._playDrink(startAt);
                break;
            case 'attack_sword':
                this._playSwordAttack(startAt);
                break;
            case 'shoot_arrow':
                this._playShootArrow(startAt);
                break;
            case 'pick_sword':
                this._playPickSword(startAt);
                break;
            case 'pick_bow':
                this._playPickBow(startAt);
                break;
            case 'pick_fruit':
                this._playPickFruit(startAt);
                break;
            case 'eat_fruit':
                this._playEatFruit(startAt);
                break;
            default:
                break;
        }
    }

    _playElevator(startAt) {
        this._playTone(startAt, 0.22, {
            type: 'triangle',
            frequency: 220,
            frequencyEnd: 440,
            gain: 0.18,
            release: 0.16,
        });
        this._playTone(startAt + 0.06, 0.2, {
            type: 'sine',
            frequency: 330,
            frequencyEnd: 520,
            gain: 0.1,
            release: 0.18,
        });
    }

    _playKick(startAt) {
        this._playTone(startAt, 0.16, {
            type: 'triangle',
            frequency: 160,
            frequencyEnd: 64,
            gain: 0.34,
            release: 0.13,
        });
        this._playTone(startAt + 0.014, 0.08, {
            type: 'sine',
            frequency: 110,
            frequencyEnd: 72,
            gain: 0.12,
            release: 0.08,
        });
        this._playNoiseBurst(startAt, 0.07, {
            gain: 0.12,
            filterType: 'highpass',
            frequency: 1800,
            frequencyEnd: 900,
            q: 0.8,
        });
    }

    _playDrink(startAt) {
        this._playTone(startAt, 0.08, {
            type: 'sine',
            frequency: 760,
            frequencyEnd: 680,
            gain: 0.09,
            release: 0.08,
        });
        this._playTone(startAt + 0.07, 0.1, {
            type: 'sine',
            frequency: 690,
            frequencyEnd: 560,
            gain: 0.11,
            release: 0.1,
        });
        this._playTone(startAt + 0.15, 0.14, {
            type: 'sine',
            frequency: 560,
            frequencyEnd: 420,
            gain: 0.12,
            release: 0.14,
        });
    }

    _playPickFruit(startAt) {
        this._playTone(startAt, 0.11, {
            type: 'triangle',
            frequency: 340,
            frequencyEnd: 460,
            gain: 0.16,
            release: 0.1,
        });
        this._playTone(startAt + 0.045, 0.12, {
            type: 'sine',
            frequency: 520,
            frequencyEnd: 720,
            gain: 0.11,
            release: 0.12,
        });
    }

    _playDropFruit(startAt) {
        this._playTone(startAt, 0.1, {
            type: 'triangle',
            frequency: 420,
            frequencyEnd: 240,
            gain: 0.1,
            release: 0.1,
        });
        this._playNoiseBurst(startAt + 0.01, 0.05, {
            gain: 0.06,
            filterType: 'bandpass',
            frequency: 700,
            frequencyEnd: 420,
            q: 1.8,
        });
    }

    _playPickBow(startAt) {
        this._playTone(startAt, 0.09, {
            type: 'triangle',
            frequency: 250,
            frequencyEnd: 340,
            gain: 0.15,
            release: 0.09,
        });
        this._playTone(startAt + 0.05, 0.11, {
            type: 'sine',
            frequency: 420,
            frequencyEnd: 520,
            gain: 0.09,
            release: 0.11,
        });
    }

    _playPickSword(startAt) {
        this._playTone(startAt, 0.08, {
            type: 'triangle',
            frequency: 300,
            frequencyEnd: 420,
            gain: 0.15,
            release: 0.08,
        });
        this._playTone(startAt + 0.04, 0.11, {
            type: 'sine',
            frequency: 520,
            frequencyEnd: 660,
            gain: 0.08,
            release: 0.11,
        });
    }

    _playDropBow(startAt) {
        this._playTone(startAt, 0.13, {
            type: 'triangle',
            frequency: 300,
            frequencyEnd: 180,
            gain: 0.11,
            release: 0.11,
        });
        this._playNoiseBurst(startAt + 0.012, 0.06, {
            gain: 0.05,
            filterType: 'bandpass',
            frequency: 540,
            frequencyEnd: 320,
            q: 1.9,
        });
    }

    _playDropSword(startAt) {
        this._playTone(startAt, 0.12, {
            type: 'triangle',
            frequency: 360,
            frequencyEnd: 210,
            gain: 0.12,
            release: 0.1,
        });
        this._playNoiseBurst(startAt + 0.008, 0.05, {
            gain: 0.06,
            filterType: 'bandpass',
            frequency: 900,
            frequencyEnd: 520,
            q: 1.5,
        });
    }

    _playSwordAttack(startAt) {
        this._playNoiseBurst(startAt, 0.045, {
            gain: 0.08,
            filterType: 'highpass',
            frequency: 3200,
            frequencyEnd: 1800,
            q: 0.8,
        });
        this._playTone(startAt, 0.11, {
            type: 'triangle',
            frequency: 760,
            frequencyEnd: 260,
            gain: 0.12,
            release: 0.1,
        });
        this._playTone(startAt + 0.018, 0.09, {
            type: 'square',
            frequency: 180,
            frequencyEnd: 120,
            gain: 0.04,
            release: 0.08,
        });
    }

    _playShootArrow(startAt) {
        this._playNoiseBurst(startAt, 0.04, {
            gain: 0.06,
            filterType: 'highpass',
            frequency: 2600,
            frequencyEnd: 1400,
            q: 0.7,
        });
        this._playTone(startAt, 0.12, {
            type: 'triangle',
            frequency: 680,
            frequencyEnd: 220,
            gain: 0.12,
            release: 0.12,
        });
        this._playTone(startAt + 0.03, 0.09, {
            type: 'sine',
            frequency: 240,
            frequencyEnd: 160,
            gain: 0.05,
            release: 0.08,
        });
    }

    _playEatFruit(startAt) {
        this._playNoiseBurst(startAt, 0.05, {
            gain: 0.11,
            filterType: 'bandpass',
            frequency: 920,
            frequencyEnd: 700,
            q: 2.4,
        });
        this._playTone(startAt, 0.08, {
            type: 'square',
            frequency: 220,
            frequencyEnd: 170,
            gain: 0.09,
            release: 0.07,
        });
        this._playNoiseBurst(startAt + 0.095, 0.06, {
            gain: 0.08,
            filterType: 'bandpass',
            frequency: 820,
            frequencyEnd: 620,
            q: 2.2,
        });
        this._playTone(startAt + 0.1, 0.09, {
            type: 'triangle',
            frequency: 180,
            frequencyEnd: 140,
            gain: 0.08,
            release: 0.08,
        });
    }

    _playTone(startAt, duration, options = {}) {
        const ctx = this._ensureContext();
        if (!ctx || !this.masterGain) {
            return;
        }

        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        const frequency = Number(options.frequency) || 440;
        const frequencyEnd = Number.isFinite(options.frequencyEnd) ? options.frequencyEnd : frequency;
        const peakGain = Number.isFinite(options.gain) ? options.gain : 0.12;
        const attack = Math.max(0.001, Number(options.attack) || 0.003);
        const release = Math.max(0.01, Number(options.release) || duration);
        const stopAt = startAt + Math.max(0.02, duration);

        oscillator.type = options.type || 'sine';
        oscillator.frequency.setValueAtTime(frequency, startAt);
        oscillator.frequency.exponentialRampToValueAtTime(
            Math.max(1, frequencyEnd),
            stopAt
        );

        gainNode.gain.setValueAtTime(0.0001, startAt);
        gainNode.gain.exponentialRampToValueAtTime(peakGain, startAt + attack);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + release);

        oscillator.connect(gainNode);
        gainNode.connect(this.masterGain);
        oscillator.start(startAt);
        oscillator.stop(stopAt + 0.02);
    }

    _playNoiseBurst(startAt, duration, options = {}) {
        const ctx = this._ensureContext();
        if (!ctx || !this.masterGain) {
            return;
        }

        if (!this.noiseBuffer) {
            const length = Math.max(1, Math.floor(ctx.sampleRate * 0.35));
            this.noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
            const channel = this.noiseBuffer.getChannelData(0);
            for (let index = 0; index < length; index += 1) {
                channel[index] = (Math.random() * 2) - 1;
            }
        }

        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer;

        const filter = ctx.createBiquadFilter();
        filter.type = options.filterType || 'bandpass';
        filter.frequency.setValueAtTime(Number(options.frequency) || 1200, startAt);
        if (Number.isFinite(options.frequencyEnd)) {
            filter.frequency.exponentialRampToValueAtTime(
                Math.max(50, options.frequencyEnd),
                startAt + Math.max(0.02, duration)
            );
        }
        filter.Q.value = Number.isFinite(options.q) ? options.q : 1.2;

        const gainNode = ctx.createGain();
        const peakGain = Number.isFinite(options.gain) ? options.gain : 0.08;
        const release = startAt + Math.max(0.03, duration);

        gainNode.gain.setValueAtTime(0.0001, startAt);
        gainNode.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.003);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, release);

        source.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.masterGain);

        source.start(startAt);
        source.stop(release + 0.02);
    }
}
