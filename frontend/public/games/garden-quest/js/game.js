(async function () {
    const GAME_CONFIG = Object.freeze({
        slug: typeof window.PLATFORM_GAME_CONFIG?.slug === 'string' && window.PLATFORM_GAME_CONFIG.slug.trim()
            ? window.PLATFORM_GAME_CONFIG.slug.trim()
            : 'garden-quest',
        hubPath: typeof window.PLATFORM_GAME_CONFIG?.hubPath === 'string' && window.PLATFORM_GAME_CONFIG.hubPath.trim()
            ? window.PLATFORM_GAME_CONFIG.hubPath.trim()
            : '/hub.html',
        loginPath: typeof window.PLATFORM_GAME_CONFIG?.loginPath === 'string' && window.PLATFORM_GAME_CONFIG.loginPath.trim()
            ? window.PLATFORM_GAME_CONFIG.loginPath.trim()
            : '/index.html',
        apiBasePath: typeof window.PLATFORM_GAME_CONFIG?.apiBasePath === 'string' && window.PLATFORM_GAME_CONFIG.apiBasePath.trim()
            ? window.PLATFORM_GAME_CONFIG.apiBasePath.trim()
            : '/api/v1/ai-game',
    });
    
    let isGameRunning = true;
    let movementSyncInterval = null;
    let statePollTimeout = null;
    let stateStreamSource = null;
    let stateStreamConnected = false;
    let heldMovementFlushTimeout = null;
    let loadingScreenTimeout = null;
    let animationId = null;
    let renderer = null;
    let memoryHeartbeatInterval = null;
    let isGameCleanedUp = false;
    
    // MASTER CLEANUP CONTROLLER: The only way to truly "kill" all window/document listeners
    const cleanupController = new AbortController();
    const cleanupSignal = { signal: cleanupController.signal };

    // MALICIOUS LEAK DETECTOR: Proper variable assignment to allow cleanup
    let leakDetectorInterval = setInterval(() => {
        if (isGameCleanedUp) {
            console.error('[LEAK-DETECTED] ⚠️ Malicious thread is STILL ALIVE after cleanup!');
            window.Platform?.trackEvent?.({
                event: 'DEBUG_FATAL_LEAK',
                details: 'Game closure still executing tasks after cleanup.'
            }).catch(() => {});
        }
    }, 2000);

    // Heartbeat with Freeze Detector and Memory Monitoring
    let gameHeartbeatInterval = setInterval(() => {
        if (!isGameRunning) return;

        let jsHeap = 'N/A';
        if (window.performance && window.performance.memory) {
            const mem = window.performance.memory;
            jsHeap = `${(mem.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB / ${(mem.totalJSHeapSize / 1024 / 1024).toFixed(2)}MB`;
        }
        console.log(`[GAME-HEARTBEAT] 🎮 Alive at ${new Date().toLocaleTimeString()} | 🧠 Memory: ${jsHeap}`);
    }, 1000);

    function logMemoryUsage() {
        if (!isGameRunning || !renderer) return;

        const memInfo = renderer.info.memory;
        const renderInfo = renderer.info.render;
        const programsInfo = renderer.info.programs?.length || 0;
        
        let jsHeap = 'N/A';
        if (window.performance && window.performance.memory) {
            const mem = window.performance.memory;
            const toMB = (bytes) => (bytes / (1024 * 1024)).toFixed(2);
            jsHeap = `${toMB(mem.usedJSHeapSize)}MB / ${toMB(mem.totalJSHeapSize)}MB (Limit: ${toMB(mem.jsHeapSizeLimit)}MB)`;
        }

        console.group(`[MEMORY-LOGGER] 📊 ${new Date().toLocaleTimeString()}`);
        console.log(`%cJS Heap: %c${jsHeap}`, 'font-weight: bold', 'color: #3b82f6');
        console.log(`%cThree.js Memory: %cGeometries: ${memInfo.geometries}, Textures: ${memInfo.textures}, Programs: ${programsInfo}`, 'font-weight: bold', 'color: #10b981');
        console.log(`%cThree.js Render: %cCalls: ${renderInfo.calls}, Triangles: ${renderInfo.triangles}, Points: ${renderInfo.points}, Lines: ${renderInfo.lines}`, 'font-weight: bold', 'color: #f59e0b');
        console.groupEnd();
    }

    memoryHeartbeatInterval = setInterval(logMemoryUsage, 30000);

    function getGameApiUrl(path = '') {
        return `${getApiUrl()}${GAME_CONFIG.apiBasePath}${path}`;
    }

    function redirectToLogin() {
        window.location.replace(GAME_CONFIG.loginPath);
    }

    function goToHub() {
        console.info('[Game] Navigating to Hub with NUCLEAR RELOAD and GPU RESET...');
        
        // 1. Start cleanup immediately
        cleanupGame();
        
        // 2. Clear platform cache to force fresh bootstrap on return
        if (window.Platform && typeof window.Platform.getBootstrap === 'function') {
            console.debug('[Game] Clearing Platform bootstrap cache...');
            // Assuming we can't directly nullify internal cache, but we will force refresh in hub.js
        }

        // 3. Give the browser more time to actually run the GC and release GPU before navigation
        setTimeout(() => {
            const hubWithCacheBust = `${GAME_CONFIG.hubPath}?t=${Date.now()}&ref=game_exit`;
            
            console.info('[Game] Triggering navigation to Hub...');
            if (window.Platform?.backToHub) {
                try {
                    window.Platform.backToHub({ replace: true });
                    return;
                } catch (e) {
                    console.error('[Game] Platform.backToHub retry-fail', e);
                }
            }
            window.location.replace(hubWithCacheBust);
        }, 500); // Increased delay slightly
    }

    function cleanupGame() {
        if (isGameCleanedUp) return;
        console.info('[Game] %c>>> STARTING NUCLEAR CLEANUP <<<', 'color: #f87171; font-weight: bold; font-size: 1.2em;');
        
        isGameRunning = false;
        isGameCleanedUp = true;

        // 1. Clear all Intervals/Timeouts
        console.debug('[Cleanup] Clearing loops and timers...');
        if (gameHeartbeatInterval) clearInterval(gameHeartbeatInterval);
        if (memoryHeartbeatInterval) clearInterval(memoryHeartbeatInterval);
        if (leakDetectorInterval) clearInterval(leakDetectorInterval);
        if (animationId) cancelAnimationFrame(animationId);
        if (movementSyncInterval) clearInterval(movementSyncInterval);
        if (statePollTimeout) clearTimeout(statePollTimeout);
        if (stateStreamSource) {
            stateStreamSource.close();
            stateStreamSource = null;
        }
        stateStreamConnected = false;
        if (heldMovementFlushTimeout) clearTimeout(heldMovementFlushTimeout);
        if (loadingScreenTimeout) clearTimeout(loadingScreenTimeout);

        // 2. Kill World and Global Entities
        console.debug('[Cleanup] Destroying game entities...');
        if (world && typeof world.destroy === 'function') {
            world.destroy();
        }
        if (localPlayer && typeof localPlayer.destroy === 'function') {
            localPlayer.destroy();
        }
        if (aiPlayer && typeof aiPlayer.destroy === 'function') {
            aiPlayer.destroy();
        }
        
        // 3. Kill Remote Players
        if (remotePlayers && remotePlayers.size > 0) {
            console.debug(`[Cleanup] Cleaning up ${remotePlayers.size} remote players...`);
            remotePlayers.forEach((p) => {
                if (p && typeof p.destroy === 'function') p.destroy();
            });
            remotePlayers.clear();
        }

        // 4. Kill Soundboard (Hardware Audio)
        if (actionSoundboard) {
            console.debug('[Cleanup] Killing soundboard...');
            if (typeof actionSoundboard.destroy === 'function') {
                actionSoundboard.destroy();
            }
        }

        // 5. Nuclear Renderer Disposal (The GPU context is critical)
        if (renderer) {
            console.info('[Cleanup] %cDisposing WebGL renderer and forcing GPU context loss...', 'color: #fb923c');
            try {
                renderer.setAnimationLoop(null);
                
                // Unbind all textures and geoms from GPU
                if (renderer.renderLists) renderer.renderLists.dispose();
                
                // Force loss of context to ensure GPU memory is purged immediately
                const gl = renderer.getContext();
                const extension = gl.getExtension('WEBGL_lose_context');
                if (extension) {
                    console.warn('[Cleanup] WEBGL_lose_context extension found, losing context now.');
                    extension.loseContext();
                }

                renderer.dispose();
                
                if (renderer.domElement && renderer.domElement.parentNode) {
                    renderer.domElement.parentNode.removeChild(renderer.domElement);
                }
            } catch (e) {
                console.error('[Cleanup] Error during nuclear renderer disposal:', e);
            }
        }

        // 6. ATOMIC EVENT CLEANUP
        console.debug('[Cleanup] Aborting all event listeners...');
        cleanupController.abort();

        // 7. NULLIFY EVERYTHING for GC
        console.debug('[Cleanup] Nullifying global references...');
        renderer = null;
        world = null;
        localPlayer = null;
        aiPlayer = null;
        remotePlayers = null;
        actionSoundboard = null;

        console.log('%c[Game] >>> NUCLEAR CLEANUP COMPLETE <<<', 'color: #4ade80; font-weight: bold;');
    }

    /**
     * Suppression of BFCache (Back-Forward Cache) to prevent memory accumulation
     * and force synchronous cleanup when the user navigates away.
     */
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            console.warn('[BFCache] Page restored from cache, forcing hard reload...');
            window.location.reload();
        }
    }, { signal: cleanupController.signal });

    window.addEventListener('beforeunload', () => {
        console.info('[Game] beforeunload triggered, forcing synchronous cleanup...');
        cleanupGame();
    });

    const user = await checkAuth();
    if (!user || user.error) {
        document.body.innerHTML = `
            <div style="color: white; padding: 40px; font-family: sans-serif; text-align: left;">
                <h2>Acesso negado</h2>
                <p>Por favor, faca login novamente.</p>
                <br>
                <button onclick="window.location.href='${GAME_CONFIG.loginPath}'" style="padding: 10px 20px; font-size: 16px;">Ir para Login</button>
            </div>
        `;
        return;
    }

    const STATE_POLL_INTERVAL_MS = 200;
    const STATE_POLL_BACKOFF_MS = 1000;
    const INPUT_SYNC_INTERVAL_MS = 80;
    const DEFAULT_SIMULATION_TICK_MS = 50;
    const INPUT_RELEASE_HOLD_MARGIN_MS = 12;
    const REMOTE_INTERPOLATION_BACK_TIME_MS = 140;
    const REMOTE_EXTRAPOLATION_MAX_MS = 110;
    const SERVER_TIME_OFFSET_BLEND = 0.18;
    const SELF_AUTHORITY_PREDICTION_MAX_SECONDS = 0.35;
    const SELF_AUTHORITY_MOVING_DEADZONE = 1.1;
    const SELF_AUTHORITY_MOVING_SNAP_DISTANCE = 9;
    const SELF_AUTHORITY_MOVING_POSITION_STRENGTH = 2.4;
    const SELF_AUTHORITY_MOVING_ROTATION_STRENGTH = 7;
    const LEADERBOARD_RENDER_LIMIT = 5;
    const PLAYER_CHAT_RENDER_LIMIT = 20;
    const DEFAULT_OUTFIT_COLOR = '#2563eb';
    const PLAYER_NICKNAME_MAX_LENGTH = 24;
    const SOCCER_GOAL_CELEBRATION_MS = 3000;
    const PROFILE_STORAGE_KEY_PREFIX = 'garden-quest-player-profile:';
    const CHAT_WIDGET_STORAGE_KEY = 'garden-quest-player-chat:minimized';
    const LEADERBOARD_PANEL_STORAGE_KEY = 'garden-quest-leaderboard:minimized';
    const TOUCH_MOVEMENT_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright', 'shift', 'e', 'f', ' ']);
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches || Number(navigator.maxTouchPoints || 0) > 0;

    const hudName = document.getElementById('hudName');
    const hudAvatar = document.getElementById('hudAvatar');
    const loadingScreen = document.getElementById('loadingScreen');
    const mobileControls = document.getElementById('mobileControls');
    const canvas = document.getElementById('gameCanvas');
    const chatWidget = document.getElementById('chatWidget');
    const chatPanel = document.getElementById('chatPanel');
    const chatFeed = document.getElementById('chatFeed');
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const chatCounter = document.getElementById('chatCounter');
    const chatCollapsedToggle = document.getElementById('chatCollapsedToggle');
    const chatCollapsedBadge = document.getElementById('chatCollapsedBadge');
    const chatMinimizeBtn = document.getElementById('chatMinimizeBtn');
    const leaderboardPanel = document.getElementById('leaderboardPanel');
    const leaderboardSections = document.getElementById('leaderboardSections');
    const leaderboardMinimizeBtn = document.getElementById('leaderboardMinimizeBtn');
    const leaderboardBody = document.getElementById('leaderboardBody');
    const leaderboardUpdated = document.getElementById('leaderboardUpdated');
    const soccerLeaderboardBody = document.getElementById('soccerLeaderboardBody');
    const soccerLeaderboardUpdated = document.getElementById('soccerLeaderboardUpdated');
    const commandsPanel = document.getElementById('commandsPanel');
    const commandsToggleBtn = document.getElementById('commandsToggleBtn');
    const commandsCloseBtn = document.getElementById('commandsCloseBtn');
    const profilePanel = document.getElementById('profilePanel');
    const profileForm = document.getElementById('profileForm');
    const profileToggleBtn = document.getElementById('profileToggleBtn');
    const profileCloseBtn = document.getElementById('profileCloseBtn');
    const profileNicknameInput = document.getElementById('profileNicknameInput');
    const profileColorInput = document.getElementById('profileColorInput');
    const profileColorValue = document.getElementById('profileColorValue');
    const profileStatus = document.getElementById('profileStatus');
    const profileSaveBtn = document.getElementById('profileSaveBtn');
    let chatMaxChars = Number(chatInput?.maxLength) || 72;
    let nicknameMaxChars = Number(profileNicknameInput?.maxLength) || PLAYER_NICKNAME_MAX_LENGTH;
    let isChatMinimized = loadChatWidgetMinimized();
    let isLeaderboardMinimized = loadLeaderboardPanelMinimized();

    const defaultProfile = buildDefaultProfile(user);
    const initialProfile = loadStoredProfile(user);
    const hasLocalProfileOverride = hasCustomStoredProfile(user);
    let didAttemptStoredProfileMigration = false;

    if (hudName) hudName.textContent = initialProfile.nickname || 'Jogador';
    if (hudAvatar) {
        console.debug('[Game] Setting HUD avatar...');
        if (user.picture) {
            hudAvatar.src = user.picture;
        }
        hudAvatar.onerror = () => {
            console.warn('[Game] HUD avatar load failed, using fallback.');
            hudAvatar.onerror = null;
            const fallbackName = encodeURIComponent(user.name || 'Player');
            hudAvatar.src = `https://ui-avatars.com/api/?name=${fallbackName}&background=random`;
        };
    }
    if (profileNicknameInput) profileNicknameInput.value = initialProfile.nickname || '';
    if (profileColorInput) profileColorInput.value = initialProfile.outfitColor;
    if (profileColorValue) profileColorValue.textContent = initialProfile.outfitColor;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xc8e6ff, 40, 80);

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
    const PLAYER_CAMERA_FOCUS_HEIGHT = 3.35;
    const CAMERA_MIN_DISTANCE = 0.05;
    const CAMERA_MIN_RELATIVE_HEIGHT = 1.1;
    const cameraState = {
        yaw: 0.75,
        pitch: 0.52,
        distance: 20,
        minDistance: CAMERA_MIN_DISTANCE,
        maxDistance: 28,
        minPitch: -0.9,
        maxPitch: 1.05,
        isPointerLocked: false,
    };

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    function sanitizeHexColor(value, fallback = DEFAULT_OUTFIT_COLOR) {
        const normalized = String(value || '').trim().toLowerCase();
        return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : fallback;
    }

    function sanitizeNickname(value, maxLength = PLAYER_NICKNAME_MAX_LENGTH) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, maxLength);
    }

    function normalizeComparableName(value) {
        return sanitizeNickname(value, 255)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
    }

    function isNicknamePrivate(nickname, realName) {
        const normalizedNickname = normalizeComparableName(nickname);
        const normalizedRealName = normalizeComparableName(realName);
        return Boolean(normalizedNickname) && normalizedNickname !== normalizedRealName;
    }

    function buildProfileStorageKey(userId) {
        return `${PROFILE_STORAGE_KEY_PREFIX}${String(userId || 'anonymous')}`;
    }

    function buildDefaultProfile(accountUser) {
        return {
            nickname: `Jardineiro ${1000 + (hashString(accountUser?.id) % 9000)}`,
            outfitColor: DEFAULT_OUTFIT_COLOR,
        };
    }

    function normalizeStoredProfile(profile, accountUser) {
        const fallbackProfile = buildDefaultProfile(accountUser);
        const nickname = sanitizeNickname(profile?.nickname);
        return {
            nickname: nickname && isNicknamePrivate(nickname, accountUser?.name)
                ? nickname
                : fallbackProfile.nickname,
            outfitColor: sanitizeHexColor(profile?.outfitColor, fallbackProfile.outfitColor),
        };
    }

    function loadStoredProfile(accountUser) {
        const fallbackProfile = buildDefaultProfile(accountUser);

        try {
            const rawValue = window.localStorage.getItem(buildProfileStorageKey(accountUser?.id));
            if (!rawValue) {
                return fallbackProfile;
            }

            return normalizeStoredProfile(JSON.parse(rawValue), accountUser);
        } catch (error) {
            return fallbackProfile;
        }
    }

    function hasCustomStoredProfile(accountUser) {
        const fallbackProfile = buildDefaultProfile(accountUser);

        try {
            const rawValue = window.localStorage.getItem(buildProfileStorageKey(accountUser?.id));
            if (!rawValue) {
                return false;
            }

            const normalizedProfile = normalizeStoredProfile(JSON.parse(rawValue), accountUser);
            return normalizedProfile.nickname !== fallbackProfile.nickname
                || normalizedProfile.outfitColor !== fallbackProfile.outfitColor;
        } catch (error) {
            return false;
        }
    }

    function saveStoredProfile(accountUser, profile) {
        try {
            const normalizedProfile = normalizeStoredProfile(profile, accountUser);
            window.localStorage.setItem(
                buildProfileStorageKey(accountUser?.id),
                JSON.stringify(normalizedProfile)
            );
        } catch (error) {}
    }

    function profilesMatch(leftProfile, rightProfile) {
        return sanitizeNickname(leftProfile?.nickname, nicknameMaxChars) === sanitizeNickname(rightProfile?.nickname, nicknameMaxChars)
            && sanitizeHexColor(leftProfile?.outfitColor) === sanitizeHexColor(rightProfile?.outfitColor);
    }

    function loadChatWidgetMinimized() {
        try {
            return window.localStorage.getItem(CHAT_WIDGET_STORAGE_KEY) === '1';
        } catch (error) {
            return false;
        }
    }

    function saveChatWidgetMinimized(value) {
        try {
            window.localStorage.setItem(CHAT_WIDGET_STORAGE_KEY, value ? '1' : '0');
        } catch (error) {}
    }

    function loadLeaderboardPanelMinimized() {
        try {
            return window.localStorage.getItem(LEADERBOARD_PANEL_STORAGE_KEY) === '1';
        } catch (error) {
            return false;
        }
    }

    function saveLeaderboardPanelMinimized(value) {
        try {
            window.localStorage.setItem(LEADERBOARD_PANEL_STORAGE_KEY, value ? '1' : '0');
        } catch (error) {}
    }

    function hexColorToNumber(hexColor) {
        return Number.parseInt(sanitizeHexColor(hexColor).slice(1), 16);
    }

    function shiftHexColor(hexColor, delta) {
        const normalized = sanitizeHexColor(hexColor);
        const numeric = hexColorToNumber(normalized);
        const red = clamp((numeric >> 16) + delta, 0, 255);
        const green = clamp(((numeric >> 8) & 0xff) + delta, 0, 255);
        const blue = clamp((numeric & 0xff) + delta, 0, 255);
        return `#${[red, green, blue].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
    }

    function buildAppearancePalette(appearance = {}) {
        const outfitColor = sanitizeHexColor(appearance?.outfitColor);
        return {
            shirtColor: hexColorToNumber(outfitColor),
            pantsColor: hexColorToNumber(shiftHexColor(outfitColor, -40)),
            shoeColor: hexColorToNumber(shiftHexColor(outfitColor, -78)),
            hairColor: 0x3d2314,
        };
    }

    function getAppearanceSignature(appearance = {}) {
        return sanitizeHexColor(appearance?.outfitColor);
    }

    function applyAppearanceToPlayer(player, appearance = {}) {
        if (!player || typeof player.setColors !== 'function') {
            return;
        }

        player.setColors(buildAppearancePalette(appearance));
    }

    function setProfileStatus(message = '', tone = '') {
        if (!profileStatus) return;
        profileStatus.textContent = message;
        profileStatus.className = 'profile-status';
        if (tone) {
            profileStatus.classList.add(tone);
        }
    }

    function setProfileFormValues(profile) {
        if (profileNicknameInput) {
            profileNicknameInput.value = sanitizeNickname(profile?.nickname, nicknameMaxChars);
        }

        const nextColor = sanitizeHexColor(profile?.outfitColor);
        if (profileColorInput) {
            profileColorInput.value = nextColor;
        }

        if (profileColorValue) {
            profileColorValue.textContent = nextColor;
        }
    }

    function readProfileFormValues() {
        return {
            nickname: sanitizeNickname(profileNicknameInput?.value, nicknameMaxChars),
            outfitColor: sanitizeHexColor(profileColorInput?.value),
        };
    }

    function formatRelativeTimestamp(isoString) {
        if (!isoString) {
            return 'Aguardando...';
        }

        const timestamp = new Date(isoString);
        if (Number.isNaN(timestamp.getTime())) {
            return 'Aguardando...';
        }

        const diffSeconds = Math.max(0, Math.round((Date.now() - timestamp.getTime()) / 1000));

        if (diffSeconds < 5) return 'Agora';
        if (diffSeconds < 60) return `${diffSeconds}s atras`;

        const diffMinutes = Math.round(diffSeconds / 60);
        if (diffMinutes < 60) return `${diffMinutes}min atras`;

        return timestamp.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    function formatClockTimestamp(isoString) {
        if (!isoString) {
            return '--:--';
        }

        const timestamp = new Date(isoString);
        if (Number.isNaN(timestamp.getTime())) {
            return '--:--';
        }

        return timestamp.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    function scrollChatFeedToBottom() {
        if (!chatFeed) return;
        chatFeed.scrollTop = chatFeed.scrollHeight;
    }

    function isChatFeedNearBottom() {
        if (!chatFeed) {
            return true;
        }

        return (chatFeed.scrollHeight - chatFeed.scrollTop - chatFeed.clientHeight) < 32;
    }

    function updateCollapsedChatBadge() {
        if (!chatCollapsedBadge) return;

        const boundedCount = Math.min(unreadChatCount, 99);
        chatCollapsedBadge.textContent = String(boundedCount);
        chatCollapsedBadge.hidden = boundedCount === 0;
    }

    function setChatMinimized(nextValue) {
        isChatMinimized = Boolean(nextValue);

        if (chatWidget) {
            chatWidget.classList.toggle('minimized', isChatMinimized);
        }

        if (chatPanel) {
            chatPanel.hidden = isChatMinimized;
        }

        if (chatCollapsedToggle) {
            chatCollapsedToggle.hidden = !isChatMinimized;
            chatCollapsedToggle.setAttribute('aria-expanded', String(!isChatMinimized));
        }

        if (!isChatMinimized) {
            unreadChatCount = 0;
            updateCollapsedChatBadge();
            window.requestAnimationFrame(scrollChatFeedToBottom);
        }

        saveChatWidgetMinimized(isChatMinimized);
    }

    function setLeaderboardMinimized(nextValue) {
        isLeaderboardMinimized = Boolean(nextValue);

        if (leaderboardPanel) {
            leaderboardPanel.classList.toggle('minimized', isLeaderboardMinimized);
        }

        if (leaderboardSections) {
            leaderboardSections.hidden = isLeaderboardMinimized;
        }

        if (leaderboardMinimizeBtn) {
            leaderboardMinimizeBtn.textContent = isLeaderboardMinimized ? '+' : '-';
            leaderboardMinimizeBtn.setAttribute('aria-expanded', String(!isLeaderboardMinimized));
            leaderboardMinimizeBtn.setAttribute(
                'aria-label',
                isLeaderboardMinimized ? 'Expandir recordes' : 'Minimizar recordes'
            );
            leaderboardMinimizeBtn.title = isLeaderboardMinimized ? 'Expandir recordes' : 'Minimizar recordes';
        }

        saveLeaderboardPanelMinimized(isLeaderboardMinimized);
    }

    function syncTopMenuToggles() {
        if (commandsToggleBtn) {
            commandsToggleBtn.classList.toggle('active', isCommandsOpen);
            commandsToggleBtn.setAttribute('aria-expanded', String(isCommandsOpen));
        }

        if (profileToggleBtn) {
            profileToggleBtn.classList.toggle('active', isProfileOpen);
            profileToggleBtn.setAttribute('aria-expanded', String(isProfileOpen));
        }
    }

    function pauseGameInputForOverlay() {
        Object.keys(keys).forEach((key) => {
            keys[key] = false;
        });
        clearTouchMovementKeys();
        cancelHeldMovementInput();
        lastInputSignature = '__stale__';
        flushMovementInput({ forceRelease: true });

        if (document.exitPointerLock) {
            document.exitPointerLock();
        }
    }

    function setMobileControlsVisibility() {
        if (!mobileControls) {
            return;
        }

        mobileControls.hidden = !isTouchDevice;
        document.body.classList.toggle('touch-device', isTouchDevice);
    }

    function bindMobileMovementControls() {
        if (!mobileControls || !isTouchDevice) {
            return;
        }

        const buttons = mobileControls.querySelectorAll('button[data-key]');

        buttons.forEach((button) => {
            const movementKey = String(button.dataset.key || '').toLowerCase();
            if (!movementKey) {
                return;
            }

            const releasePointer = (pointerId = null) => {
                if (pointerId != null && activeTouchMovementPointers.get(pointerId) !== movementKey) {
                    return;
                }

                keys[movementKey] = false;
                button.classList.remove('active');

                if (pointerId != null) {
                    activeTouchMovementPointers.delete(pointerId);
                }

                flushMovementInput();
            };

            button.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                event.stopPropagation();

                if (isChatOpen || isProfileOpen || isCommandsOpen || stateSync.selfStatus === 'dead') {
                    return;
                }

                activeTouchMovementPointers.set(event.pointerId, movementKey);
                keys[movementKey] = true;
                button.classList.add('active');

                if (movementKey === 'e') handlePrimaryActionInput();
                if (movementKey === 'f') handleSecondaryActionInput();
                if (movementKey === ' ') jumpLocalPlayer();

                if (typeof button.setPointerCapture === 'function') {
                    button.setPointerCapture(event.pointerId);
                }

                if (movementKey !== 'e' && movementKey !== 'f' && movementKey !== ' ') {
                    flushMovementInput();
                }
            });

            button.addEventListener('pointerup', (event) => {
                event.preventDefault();
                event.stopPropagation();
                releasePointer(event.pointerId);
            });

            button.addEventListener('pointercancel', (event) => {
                releasePointer(event.pointerId);
            });

            button.addEventListener('lostpointercapture', (event) => {
                releasePointer(event.pointerId);
            });
        });
    }

    function buildChatEntryNode(entry) {
        const item = document.createElement('article');
        item.className = 'chat-entry';

        if (entry?.isSelf) {
            item.classList.add('self');
        }

        const meta = document.createElement('div');
        meta.className = 'chat-entry-meta';

        const author = document.createElement('span');
        author.className = 'chat-entry-author';
        author.textContent = entry?.playerName || 'Jogador';

        const time = document.createElement('span');
        time.className = 'chat-entry-time';
        time.textContent = formatClockTimestamp(entry?.createdAt);

        const message = document.createElement('p');
        message.className = 'chat-entry-message';
        message.textContent = entry?.message || '';

        meta.append(author, time);
        item.append(meta, message);
        return item;
    }

    function renderPlayerChat(chatState) {
        if (!chatFeed) return;

        const entries = Array.isArray(chatState?.entries)
            ? chatState.entries.slice(-PLAYER_CHAT_RENDER_LIMIT)
            : [];
        const shouldStickToBottom = isChatFeedNearBottom();
        const latestEntryId = entries.reduce((highestId, entry) => {
            const entryId = Number(entry?.id) || 0;
            return Math.max(highestId, entryId);
        }, 0);

        if (hasRenderedPlayerChat && isChatMinimized && latestEntryId > lastChatEntryId) {
            unreadChatCount += entries.filter((entry) => (Number(entry?.id) || 0) > lastChatEntryId).length;
            updateCollapsedChatBadge();
        }

        chatFeed.replaceChildren();

        if (entries.length === 0) {
            const emptyState = document.createElement('p');
            emptyState.className = 'chat-empty';
            emptyState.textContent = 'As mensagens dos jogadores aparecem aqui.';
            chatFeed.appendChild(emptyState);
        } else {
            const fragment = document.createDocumentFragment();
            entries.forEach((entry) => {
                fragment.appendChild(buildChatEntryNode(entry));
            });
            chatFeed.appendChild(fragment);
        }

        if (shouldStickToBottom || isChatMinimized || !hasRenderedPlayerChat) {
            scrollChatFeedToBottom();
        }

        lastChatEntryId = latestEntryId;
        hasRenderedPlayerChat = true;
    }

    function renderTableLeaderboard(bodyEl, updatedEl, leaderboardState, {
        emptyText,
        valueClassName,
        valueFormatter,
    }) {
        if (!bodyEl) return;

        const entries = Array.isArray(leaderboardState?.entries)
            ? leaderboardState.entries.slice(0, LEADERBOARD_RENDER_LIMIT)
            : [];
        bodyEl.replaceChildren();

        if (updatedEl) {
            updatedEl.textContent = formatRelativeTimestamp(leaderboardState?.updatedAt);
        }

        if (entries.length === 0) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 4;
            cell.className = 'leaderboard-empty';
            cell.textContent = emptyText;
            row.appendChild(cell);
            bodyEl.appendChild(row);
            return;
        }

        entries.forEach((entry) => {
            const row = document.createElement('tr');

            const rankCell = document.createElement('td');
            rankCell.className = 'leaderboard-rank';
            rankCell.textContent = String(entry.rank || '-');

            const nameCell = document.createElement('td');
            nameCell.className = 'leaderboard-name';
            nameCell.textContent = entry.actorName || 'Jogador';
            nameCell.title = entry.actorName || 'Jogador';

            const typeCell = document.createElement('td');
            typeCell.className = 'leaderboard-type';
            typeCell.textContent = entry.actorType === 'ai' ? 'IA' : 'Jogador';

            const valueCell = document.createElement('td');
            valueCell.className = valueClassName;
            valueCell.textContent = valueFormatter(entry);

            row.appendChild(rankCell);
            row.appendChild(nameCell);
            row.appendChild(typeCell);
            row.appendChild(valueCell);
            bodyEl.appendChild(row);
        });
    }

    function renderLeaderboard(leaderboardState) {
        renderTableLeaderboard(leaderboardBody, leaderboardUpdated, leaderboardState, {
            emptyText: 'Sem recordes ainda.',
            valueClassName: 'leaderboard-best',
            valueFormatter: (entry) => String(Number.isFinite(entry.bestScore) ? entry.bestScore : 0),
        });
    }

    function renderSoccerLeaderboard(leaderboardState) {
        renderTableLeaderboard(soccerLeaderboardBody, soccerLeaderboardUpdated, leaderboardState, {
            emptyText: 'Ninguem marcou gol ainda.',
            valueClassName: 'leaderboard-goals',
            valueFormatter: (entry) => String(Number.isFinite(entry.soccerGoals) ? entry.soccerGoals : 0),
        });
    }

    function drawRoundedRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    function createCanvasSprite(width, height, scaleX, scaleY, maxCloseDistance = 14) {
        const spriteCanvas = document.createElement('canvas');
        spriteCanvas.width = width;
        spriteCanvas.height = height;

        const texture = new THREE.CanvasTexture(spriteCanvas);
        texture.colorSpace = THREE.SRGBColorSpace;

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
        });

        const sprite = new THREE.Sprite(material);
        sprite.scale.set(scaleX, scaleY, 1);
        sprite.renderOrder = 10;
        sprite.userData.canvas = spriteCanvas;
        sprite.userData.ctx = spriteCanvas.getContext('2d');
        sprite.userData.texture = texture;
        sprite.userData.baseScaleX = scaleX;
        sprite.userData.baseScaleY = scaleY;
        sprite.userData.maxCloseDistance = Math.max(0.001, Number(maxCloseDistance) || 14);
        return sprite;
    }

    function createLabelSprite(text, options) {
        const sprite = createCanvasSprite(
            options.width || 256,
            options.height || 64,
            options.scaleX || 3,
            options.scaleY || 0.75,
            options.maxCloseDistance || 14
        );
        updateLabelSprite(sprite, text, options);
        return sprite;
    }

    function updateLabelSprite(sprite, text, options) {
        const canvasEl = sprite.userData.canvas;
        const ctx = sprite.userData.ctx;

        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        ctx.fillStyle = options.backgroundColor || 'rgba(0,0,0,0.5)';
        drawRoundedRect(ctx, 0, 0, canvasEl.width, canvasEl.height, 14);
        ctx.fill();

        ctx.font = 'bold 28px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = options.textColor || '#ffffff';
        ctx.fillText(String(text || '').slice(0, 32), canvasEl.width / 2, canvasEl.height / 2);
        sprite.userData.texture.needsUpdate = true;
    }

    function createBubbleSprite() {
        return createCanvasSprite(340, 124, 4.2, 1.5, 16);
    }

    function createVitalsSprite() {
        return createCanvasSprite(360, 96, 4.5, 1.08, 15);
    }

    function createActionSprite() {
        return createCanvasSprite(320, 72, 4.1, 0.95, 15);
    }

    function getVitalTone(level) {
        if (level < 20) {
            return '#f87171';
        }

        if (level < 50) {
            return '#fbbf24';
        }

        return '#4ade80';
    }

    function getVitalsIndicatorKey(actorState) {
        const food = Math.round(Number(actorState?.vitals?.food) || 0);
        const water = Math.round(Number(actorState?.vitals?.water) || 0);
        const status = typeof actorState?.status === 'string' ? actorState.status : '';
        return `${food}:${water}:${status}`;
    }

    function updateVitalsSprite(sprite, actorState) {
        const canvasEl = sprite.userData.canvas;
        const ctx = sprite.userData.ctx;
        const vitals = actorState?.vitals;

        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        if (!vitals) {
            sprite.visible = false;
            sprite.userData.texture.needsUpdate = true;
            return;
        }

        const foodLevel = Math.max(0, Math.min(100, Math.round(Number(vitals.food) || 0)));
        const waterLevel = Math.max(0, Math.min(100, Math.round(Number(vitals.water) || 0)));
        const barStartX = 114;
        const barWidth = 216;
        const barHeight = 18;
        const trackColor = 'rgba(15, 23, 42, 0.9)';
        const borderColor = 'rgba(148, 163, 184, 0.2)';

        ctx.fillStyle = 'rgba(5, 10, 18, 0.86)';
        drawRoundedRect(ctx, 8, 8, canvasEl.width - 16, canvasEl.height - 16, 18);
        ctx.fill();

        const drawVitalBar = (label, value, y, fillColor) => {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.font = '700 18px Outfit, sans-serif';
            ctx.fillStyle = '#e2e8f0';
            ctx.fillText(label, 24, y);

            ctx.fillStyle = trackColor;
            drawRoundedRect(ctx, barStartX, y - (barHeight / 2), barWidth, barHeight, 8);
            ctx.fill();

            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 2;
            drawRoundedRect(ctx, barStartX, y - (barHeight / 2), barWidth, barHeight, 8);
            ctx.stroke();

            const fillWidth = Math.max(0, (barWidth - 4) * (value / 100));
            if (fillWidth > 0) {
                ctx.fillStyle = fillColor;
                drawRoundedRect(ctx, barStartX + 2, y - (barHeight / 2) + 2, fillWidth, barHeight - 4, 6);
                ctx.fill();
            }
        };

        ctx.textBaseline = 'middle';
        drawVitalBar('COMIDA', foodLevel, 34, getVitalTone(foodLevel));
        drawVitalBar('AGUA', waterLevel, 63, waterLevel < 20 ? '#f87171' : waterLevel < 50 ? '#38bdf8' : '#22c55e');

        sprite.visible = true;
        sprite.userData.texture.needsUpdate = true;
    }

    function getActionIndicatorKey(actorState) {
        if (typeof actorState === 'string') {
            return actorState.trim();
        }

        if (!actorState || typeof actorState !== 'object') {
            return '';
        }

        if (actorState.status === 'dead') {
            const seconds = Math.max(1, Math.ceil((Number(actorState.respawnCountdownMs) || 0) / 1000));
            return `dead:${seconds}`;
        }

        return typeof actorState.currentAction === 'string' ? actorState.currentAction : '';
    }

    function getActionIndicatorConfig(actorState) {
        if (actorState && typeof actorState === 'object' && actorState.status === 'dead') {
            const seconds = Math.max(1, Math.ceil((Number(actorState.respawnCountdownMs) || 0) / 1000));
            return {
                label: `RESPAWN ${seconds}s`,
                backgroundColor: 'rgba(127, 29, 29, 0.94)',
                textColor: '#fee2e2',
            };
        }

        const action = typeof actorState === 'string'
            ? actorState
            : typeof actorState?.currentAction === 'string'
                ? actorState.currentAction
                : '';

        switch (action) {
            case 'ride_elevator':
                return {
                    label: 'ELEVADOR',
                    backgroundColor: 'rgba(120, 53, 15, 0.92)',
                    textColor: '#fef3c7',
                };
            case 'attack_sword':
                return {
                    label: 'GOLPE DE ESPADA',
                    backgroundColor: 'rgba(100, 116, 139, 0.94)',
                    textColor: '#f8fafc',
                };
            case 'shoot_arrow':
                return {
                    label: 'ATIRANDO FLECHA',
                    backgroundColor: 'rgba(120, 53, 15, 0.94)',
                    textColor: '#fef3c7',
                };
            case 'drop_sword':
                return {
                    label: 'SOLTANDO ESPADA',
                    backgroundColor: 'rgba(68, 64, 60, 0.92)',
                    textColor: '#f8fafc',
                };
            case 'kick_ball':
                return {
                    label: 'CHUTANDO BOLA',
                    backgroundColor: 'rgba(37, 99, 235, 0.92)',
                    textColor: '#eff6ff',
                };
            case 'drop_bow':
                return {
                    label: 'SOLTANDO ARCO',
                    backgroundColor: 'rgba(68, 64, 60, 0.92)',
                    textColor: '#fef3c7',
                };
            case 'drop_fruit':
                return {
                    label: 'SOLTANDO MACA',
                    backgroundColor: 'rgba(120, 53, 15, 0.92)',
                    textColor: '#ffedd5',
                };
            case 'drink_water':
                return {
                    label: 'BEBENDO AGUA',
                    backgroundColor: 'rgba(8, 145, 178, 0.92)',
                    textColor: '#ecfeff',
                };
            case 'pick_fruit':
                return {
                    label: 'PEGANDO MACA',
                    backgroundColor: 'rgba(194, 65, 12, 0.92)',
                    textColor: '#fff7ed',
                };
            case 'pick_sword':
                return {
                    label: 'PEGANDO ESPADA',
                    backgroundColor: 'rgba(71, 85, 105, 0.92)',
                    textColor: '#f8fafc',
                };
            case 'pick_bow':
                return {
                    label: 'PEGANDO ARCO',
                    backgroundColor: 'rgba(120, 53, 15, 0.92)',
                    textColor: '#fff7ed',
                };
            case 'eat_fruit':
                return {
                    label: 'COMENDO MACA',
                    backgroundColor: 'rgba(21, 128, 61, 0.92)',
                    textColor: '#f0fdf4',
                };
            default:
                return null;
        }
    }

    function updateActionSprite(sprite, actorState) {
        const canvasEl = sprite.userData.canvas;
        const ctx = sprite.userData.ctx;
        const config = getActionIndicatorConfig(actorState);

        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        if (!config) {
            sprite.visible = false;
            sprite.userData.texture.needsUpdate = true;
            return;
        }

        ctx.fillStyle = config.backgroundColor;
        drawRoundedRect(ctx, 12, 10, canvasEl.width - 24, canvasEl.height - 20, 18);
        ctx.fill();

        ctx.font = '700 24px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = config.textColor;
        ctx.fillText(config.label, canvasEl.width / 2, canvasEl.height / 2);

        sprite.visible = true;
        sprite.userData.texture.needsUpdate = true;
    }

    function wrapText(ctx, text, maxWidth, maxLines) {
        const words = String(text || '').split(/\s+/).filter(Boolean);
        const lines = [];
        let currentLine = '';

        for (let index = 0; index < words.length; index += 1) {
            const word = words[index];
            const nextLine = currentLine ? `${currentLine} ${word}` : word;
            const fits = ctx.measureText(nextLine).width <= maxWidth;

            if (fits || !currentLine) {
                currentLine = nextLine;
                continue;
            }

            lines.push(currentLine);
            currentLine = word;

            if (lines.length === maxLines - 1) {
                break;
            }
        }

        if (currentLine && lines.length < maxLines) {
            lines.push(currentLine);
        }

        if (words.length > 0 && lines.length > 0) {
            const consumedWords = lines.join(' ').split(/\s+/).filter(Boolean).length;
            if (consumedWords < words.length) {
                const lastLine = lines[lines.length - 1];
                lines[lines.length - 1] = `${lastLine.slice(0, Math.max(0, lastLine.length - 1))}...`;
            }
        }

        return lines;
    }

    function updateBubbleSprite(sprite, text) {
        const canvasEl = sprite.userData.canvas;
        const ctx = sprite.userData.ctx;

        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        if (!text) {
            sprite.visible = false;
            sprite.userData.texture.needsUpdate = true;
            return;
        }

        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        drawRoundedRect(ctx, 10, 10, canvasEl.width - 20, canvasEl.height - 20, 24);
        ctx.fill();

        ctx.fillStyle = '#14532d';
        ctx.font = '700 32px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const lines = wrapText(ctx, text, canvasEl.width - 42, 2);
        const lineHeight = 36;
        const startY = canvasEl.height / 2 - ((lines.length - 1) * lineHeight) / 2 - 2;

        lines.forEach((line, index) => {
            ctx.fillText(line, canvasEl.width / 2, startY + (index * lineHeight));
        });

        sprite.visible = true;
        sprite.userData.texture.needsUpdate = true;
    }

    function hashString(value) {
        let hash = 0;
        for (let index = 0; index < String(value || '').length; index += 1) {
            hash = ((hash << 5) - hash) + String(value).charCodeAt(index);
            hash |= 0;
        }
        return Math.abs(hash);
    }

    function layoutActorUi(renderState) {
        if (!renderState) return;

        if (renderState.vitals) {
            renderState.vitals.position.y = 4.72;
        }

        if (renderState.action) {
            renderState.action.position.y = renderState.vitals?.visible ? 5.62 : 4.75;
        }

        if (renderState.speech) {
            renderState.speech.position.y = renderState.action?.visible
                ? 7.0
                : renderState.vitals?.visible
                    ? 5.95
                    : 5.1;
        }
    }

    function updateSpriteScaleForCamera(sprite, distanceToCamera) {
        if (!sprite) {
            return;
        }

        const baseScaleX = Number(sprite.userData.baseScaleX) || sprite.scale.x || 1;
        const baseScaleY = Number(sprite.userData.baseScaleY) || sprite.scale.y || 1;
        const maxCloseDistance = Math.max(0.001, Number(sprite.userData.maxCloseDistance) || 14);
        const scaleFactor = Math.min(1, Math.max(0.001, distanceToCamera) / maxCloseDistance);

        sprite.scale.set(baseScaleX * scaleFactor, baseScaleY * scaleFactor, 1);
    }

    const actorUiWorldPosition = new THREE.Vector3();

    function updateActorUiScale(renderState, actor) {
        if (!renderState || !actor?.group) {
            return;
        }

        actor.group.getWorldPosition(actorUiWorldPosition);
        const distanceToCamera = camera.position.distanceTo(actorUiWorldPosition);

        updateSpriteScaleForCamera(renderState.label, distanceToCamera);
        updateSpriteScaleForCamera(renderState.vitals, distanceToCamera);
        updateSpriteScaleForCamera(renderState.action, distanceToCamera);
        updateSpriteScaleForCamera(renderState.speech, distanceToCamera);
    }

    function attachActorUi(actor, name, options = {}) {
        const {
            showLabel = true,
            showVitals = true,
            ...labelOptions
        } = options;
        const label = createLabelSprite(name, labelOptions);
        label.position.y = 3.8;
        label.visible = showLabel;
        actor.group.add(label);

        const vitals = createVitalsSprite();
        vitals.visible = false;
        actor.group.add(vitals);

        const action = createActionSprite();
        action.visible = false;
        actor.group.add(action);

        const speech = createBubbleSprite();
        speech.visible = false;
        actor.group.add(speech);

        const renderState = {
            actor,
            label,
            vitals,
            action,
            speech,
            showLabel,
            showVitals,
            speechText: '',
            vitalsKey: '',
            actionKey: '',
            equipmentKey: '',
            modelActionName: '',
            lastHitAt: '',
        };
        layoutActorUi(renderState);
        return renderState;
    }

    function getActorEquipmentKey(actorState) {
        const swordEquipped = Boolean(actorState?.equipment?.sword);
        const bowEquipped = Boolean(actorState?.equipment?.bow);
        return `${swordEquipped ? 1 : 0}:${bowEquipped ? 1 : 0}`;
    }

    function updateActorVitals(renderState, actorState) {
        if (!renderState.showVitals) {
            renderState.vitals.visible = false;
            renderState.vitalsKey = '';
            layoutActorUi(renderState);
            return;
        }

        const nextVitalsKey = getVitalsIndicatorKey(actorState);
        if (nextVitalsKey === renderState.vitalsKey) {
            return;
        }

        renderState.vitalsKey = nextVitalsKey;
        updateVitalsSprite(renderState.vitals, actorState);
        layoutActorUi(renderState);
    }

    function updateActorSpeech(renderState, speechText) {
        if (speechText === renderState.speechText) {
            return;
        }

        renderState.speechText = speechText;
        updateBubbleSprite(renderState.speech, speechText);
    }

    function updateActorAction(renderState, actorState) {
        const nextActionKey = getActionIndicatorKey(actorState);
        if (nextActionKey === renderState.actionKey) {
            return;
        }

        renderState.actionKey = nextActionKey;
        updateActionSprite(renderState.action, actorState);
        layoutActorUi(renderState);
    }

    function updateActorModelState(renderState, actorState) {
        if (!renderState?.actor) {
            return;
        }

        if (actorState?.equipment && typeof renderState.actor.setEquipment === 'function') {
            const nextEquipmentKey = getActorEquipmentKey(actorState);
            if (nextEquipmentKey !== renderState.equipmentKey) {
                renderState.equipmentKey = nextEquipmentKey;
                renderState.actor.setEquipment(actorState.equipment);
            }
        }

        const nextModelActionName = typeof actorState?.currentAction === 'string'
            ? actorState.currentAction
            : '';
        const canCheckActionPlayback = typeof renderState.actor.isActionPlaying === 'function';
        const isSwordAttackPlaying = canCheckActionPlayback
            ? renderState.actor.isActionPlaying('attack_sword')
            : false;
        const shouldReplaySwordAttack = nextModelActionName === 'attack_sword'
            && (
                nextModelActionName !== renderState.modelActionName
                || !isSwordAttackPlaying
            );

        const isShootArrowPlaying = canCheckActionPlayback
            ? renderState.actor.isActionPlaying('shoot_arrow')
            : false;
        const shouldReplayShootArrow = nextModelActionName === 'shoot_arrow'
            && (
                nextModelActionName !== renderState.modelActionName
                || !isShootArrowPlaying
            );

        if (nextModelActionName === renderState.modelActionName && !shouldReplaySwordAttack && !shouldReplayShootArrow) {
            return;
        }

        renderState.modelActionName = nextModelActionName;
        if (shouldReplaySwordAttack && typeof renderState.actor.playAction === 'function') {
            renderState.actor.playAction('attack_sword');
        } else if (shouldReplayShootArrow && typeof renderState.actor.playAction === 'function') {
            renderState.actor.playAction('shoot_arrow');
        }
    }

    function updateActorHitFeedback(renderState, actorState) {
        if (!renderState?.actor || typeof renderState.actor.triggerHitFlash !== 'function') {
            return;
        }

        const nextLastHitAt = typeof actorState?.lastHitAt === 'string' ? actorState.lastHitAt : '';
        if (!nextLastHitAt || nextLastHitAt === renderState.lastHitAt) {
            return;
        }

        renderState.lastHitAt = nextLastHitAt;
        renderState.actor.triggerHitFlash(Math.max(220, Number(actorState?.hitFlashRemainingMs) || 0));

        if (actorState?.lastHitType === 'sword' && typeof renderState.actor.jump === 'function') {
            renderState.actor.jump();
        }
    }

    function getPredictedEquipmentAfterLocalAction(actionName) {
        const currentEquipment = typeof localPlayer.getEquipmentState === 'function'
            ? localPlayer.getEquipmentState()
            : { sword: false, bow: false };

        switch (actionName) {
            case 'pick_sword':
                return {
                    ...currentEquipment,
                    sword: true,
                    bow: false,
                };
            case 'drop_sword':
                return {
                    ...currentEquipment,
                    sword: false,
                };
            case 'pick_bow':
                return {
                    ...currentEquipment,
                    bow: true,
                    sword: false,
                };
            case 'drop_bow':
                return {
                    ...currentEquipment,
                    bow: false,
                };
            default:
                return currentEquipment;
        }
    }

    function applyRuntimeSettings(settings) {
        if (!settings) {
            return;
        }

        if (Number.isFinite(settings.simulationTickMs) && settings.simulationTickMs > 0) {
            stateSync.simulationTickMs = settings.simulationTickMs;
        }

        if (Number.isFinite(settings.playerMoveSpeed)) {
            stateSync.playerMoveSpeed = settings.playerMoveSpeed;
        }

        if (Number.isFinite(settings.playerRunSpeed)) {
            stateSync.playerRunSpeed = settings.playerRunSpeed;
        }

        if (Number.isFinite(settings.chatMaxChars) && settings.chatMaxChars > 0) {
            chatMaxChars = settings.chatMaxChars;
            if (chatInput) {
                chatInput.maxLength = String(chatMaxChars);
            }
            updateChatCounter();
        }

        if (Number.isFinite(settings.nicknameMaxChars) && settings.nicknameMaxChars > 0) {
            nicknameMaxChars = settings.nicknameMaxChars;
            if (profileNicknameInput) {
                profileNicknameInput.maxLength = String(nicknameMaxChars);
            }
        }
    }

    function parseServerTimeMs(isoString) {
        const serverTimeMs = Date.parse(String(isoString || ''));
        return Number.isFinite(serverTimeMs) ? serverTimeMs : 0;
    }

    function updateServerTimeEstimate(serverTimeIso) {
        const serverTimeMs = parseServerTimeMs(serverTimeIso);
        if (serverTimeMs <= 0) {
            return 0;
        }

        const nextOffsetMs = serverTimeMs - Date.now();
        if (!Number.isFinite(stateSync.serverTimeOffsetMs)) {
            stateSync.serverTimeOffsetMs = nextOffsetMs;
        } else {
            stateSync.serverTimeOffsetMs += (nextOffsetMs - stateSync.serverTimeOffsetMs) * SERVER_TIME_OFFSET_BLEND;
        }

        return serverTimeMs;
    }

    function getEstimatedServerTimeMs() {
        if (!Number.isFinite(stateSync.serverTimeOffsetMs)) {
            return Date.now();
        }

        return Date.now() + stateSync.serverTimeOffsetMs;
    }

    function pushActorSample(samples, actorState, serverTimeMs) {
        if (!Array.isArray(samples) || !actorState?.position || !Number.isFinite(serverTimeMs) || serverTimeMs <= 0) {
            return;
        }

        const sample = {
            serverTimeMs,
            position: new THREE.Vector3(
                Number(actorState.position.x) || 0,
                Number(actorState.position.y) || 0,
                Number(actorState.position.z) || 0
            ),
            rotationY: typeof actorState.rotationY === 'number' ? actorState.rotationY : 0,
            status: actorState.status || 'idle',
        };
        const previousSample = samples[samples.length - 1];

        if (previousSample && previousSample.serverTimeMs === sample.serverTimeMs) {
            previousSample.position.copy(sample.position);
            previousSample.rotationY = sample.rotationY;
            previousSample.status = sample.status;
            return;
        }

        samples.push(sample);
        if (samples.length > 8) {
            samples.splice(0, samples.length - 8);
        }
    }

    function interpolateActorSample(samples, renderServerTimeMs) {
        if (!Array.isArray(samples) || samples.length === 0) {
            return null;
        }

        if (samples.length === 1 || !Number.isFinite(renderServerTimeMs)) {
            return {
                position: samples[0].position.clone(),
                rotationY: samples[0].rotationY,
            };
        }

        let previousSample = samples[0];
        let nextSample = null;

        for (let index = 1; index < samples.length; index += 1) {
            nextSample = samples[index];
            if (renderServerTimeMs <= nextSample.serverTimeMs) {
                break;
            }
            previousSample = nextSample;
            nextSample = null;
        }

        if (nextSample) {
            const spanMs = Math.max(1, nextSample.serverTimeMs - previousSample.serverTimeMs);
            const blend = clamp((renderServerTimeMs - previousSample.serverTimeMs) / spanMs, 0, 1);
            return {
                position: previousSample.position.clone().lerp(nextSample.position, blend),
                rotationY: THREE.MathUtils.lerp(previousSample.rotationY, nextSample.rotationY, blend),
            };
        }

        const latestSample = samples[samples.length - 1];
        const priorSample = samples[samples.length - 2];
        const deltaMs = latestSample.serverTimeMs - priorSample.serverTimeMs;
        const extrapolationMs = clamp(renderServerTimeMs - latestSample.serverTimeMs, 0, REMOTE_EXTRAPOLATION_MAX_MS);
        const extrapolatedPosition = latestSample.position.clone();

        if (deltaMs > 0 && extrapolationMs > 0) {
            const velocity = latestSample.position.clone().sub(priorSample.position).multiplyScalar(1 / deltaMs);
            extrapolatedPosition.addScaledVector(velocity, extrapolationMs);
        }

        return {
            position: extrapolatedPosition,
            rotationY: latestSample.rotationY,
        };
    }

    async function fetchBootstrapState() {
        const response = await fetch(getGameApiUrl('/bootstrap-state'), {
            cache: 'no-store',
            credentials: 'include',
        });

        if (response.status === 401) {
            redirectToLogin();
            return null;
        }

        if (!response.ok) {
            throw new Error(`Bootstrap request failed with ${response.status}`);
        }

        return response.json();
    }

    let bootstrapState = null;
    try {
        bootstrapState = await fetchBootstrapState();
    } catch (error) {
        console.error('Failed to fetch bootstrap state:', error);
    }

    const initialWorldState = bootstrapState?.world || {};
    const initialSettings = bootstrapState?.settings || {};

    let world = new World(scene, initialWorldState);
    const actionHud = new ActionHud();
    let actionSoundboard = new ActionSoundboard({ signal: cleanupController.signal });
    const initialPalette = buildAppearancePalette(initialProfile);

    let localPlayer = new Player(scene, initialProfile.nickname, {
        spawnPosition: { x: -8, y: 0, z: 26 },
        shirtColor: initialPalette.shirtColor,
        pantsColor: initialPalette.pantsColor,
        shoeColor: initialPalette.shoeColor,
        hairColor: initialPalette.hairColor,
    });
    const localUi = attachActorUi(localPlayer, initialProfile.nickname, {
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        textColor: '#ffffff',
        width: 256,
        height: 64,
        scaleX: 3,
        scaleY: 0.75,
        maxCloseDistance: 15,
        showLabel: false,
        showVitals: false,
    });

    let aiPlayer = new Player(scene, 'Jardineiro IA', {
        spawnPosition: { x: -3, y: 0, z: 15 },
        shirtColor: 0x16a34a,
        pantsColor: 0x14532d,
        hairColor: 0x2b2118,
    });
    const aiUi = attachActorUi(aiPlayer, 'Jardineiro IA', {
        backgroundColor: 'rgba(6, 78, 59, 0.88)',
        textColor: '#dcfce7',
        width: 300,
        height: 64,
        scaleX: 3.5,
        scaleY: 0.8,
        maxCloseDistance: 15,
    });

    let remotePlayers = new Map();
    const playerFocus = new THREE.Vector3();
    const scenicFocus = new THREE.Vector3();
    const lookTarget = new THREE.Vector3();
    const targetCamPos = new THREE.Vector3();

    const stateSync = {
        isFetching: false,
        introBlend: 1,
        selfTargetPosition: new THREE.Vector3(localPlayer.group.position.x, 0, localPlayer.group.position.z),
        selfTargetRotationY: localPlayer.group.rotation.y,
        selfSnapshotReceivedAt: performance.now(),
        selfSnapshotServerTimeMs: 0,
        selfInitialized: false,
        selfStatus: 'idle',
        worldBounds: Number.isFinite(initialWorldState?.bounds) && initialWorldState.bounds > 0 ? initialWorldState.bounds : 45,
        simulationTickMs: Number.isFinite(initialSettings?.simulationTickMs) && initialSettings.simulationTickMs > 0
            ? initialSettings.simulationTickMs
            : DEFAULT_SIMULATION_TICK_MS,
        playerMoveSpeed: Number.isFinite(initialSettings?.playerMoveSpeed) ? initialSettings.playerMoveSpeed : 8,
        playerRunSpeed: Number.isFinite(initialSettings?.playerRunSpeed) ? initialSettings.playerRunSpeed : 12.5,
        aiTargetPosition: new THREE.Vector3(-3, 0, 15),
        aiTargetRotationY: Math.PI,
        aiSamples: [],
        aiInitialized: false,
        remotePresenceInitialized: false,
        serverTimeOffsetMs: parseServerTimeMs(bootstrapState?.serverTime) > 0
            ? parseServerTimeMs(bootstrapState?.serverTime) - Date.now()
            : 0,
        lastSnapshotTick: -1,
        worldVersion: Number(bootstrapState?.worldVersion || initialWorldState?.version) || 0,
    };

    const keys = {};
    let isChatOpen = false;
    let isCommandsOpen = false;
    let isProfileOpen = false;
    let actionCommandInFlight = false;
    let inputCommandInFlight = false;
    let profileCommandInFlight = false;
    let lastInputSignature = '0.000:0.000:0';
    let lastObservedInputSignature = lastInputSignature;
    let lastMovementErrorAt = 0;
    let lastDispatchedMovementInput = { moveX: 0, moveZ: 0, isRunning: false };
    let heldMovementInput = { moveX: 0, moveZ: 0, isRunning: false };
    let heldMovementReleaseAtMs = 0;
    let unreadChatCount = 0;
    let lastChatEntryId = 0;
    let hasRenderedPlayerChat = false;
    let lastSoccerGoalSequence = null;
    let soccerBallCarrierId = '';
    const activeTouchMovementPointers = new Map();
    const activeTouchLookPointers = new Map();

    applyRuntimeSettings(initialSettings);

    function formatInputSignature(input) {
        return `${input.moveX.toFixed(3)}:${input.moveZ.toFixed(3)}:${input.isRunning ? 1 : 0}`;
    }

    function cloneMovementInput(input = {}) {
        return {
            moveX: Number(input.moveX) || 0,
            moveZ: Number(input.moveZ) || 0,
            isRunning: Boolean(input.isRunning),
        };
    }

    function clearTouchMovementKeys() {
        TOUCH_MOVEMENT_KEYS.forEach((key) => {
            keys[key] = false;
        });

        activeTouchMovementPointers.clear();
        activeTouchLookPointers.clear();

        document.querySelectorAll('.mobile-move-btn.active, .mobile-action-btn.active').forEach((button) => {
            button.classList.remove('active');
        });
    }

    function hasMovementInput(input) {
        return Math.abs(input.moveX) > 0.001 || Math.abs(input.moveZ) > 0.001;
    }

    function computeMovementVector() {
        const isRunning = Boolean(keys.shift);

        if (isChatOpen || isProfileOpen || isCommandsOpen || stateSync.selfStatus === 'dead') {
            return { moveX: 0, moveZ: 0, isRunning: false };
        }

        const inputForward = (keys.w || keys.arrowup ? 1 : 0) - (keys.s || keys.arrowdown ? 1 : 0);
        const inputRight = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);

        if (inputForward === 0 && inputRight === 0) {
            return { moveX: 0, moveZ: 0, isRunning };
        }

        const forwardX = -Math.sin(cameraState.yaw);
        const forwardZ = -Math.cos(cameraState.yaw);
        const rightX = Math.cos(cameraState.yaw);
        const rightZ = -Math.sin(cameraState.yaw);

        const moveX = rightX * inputRight + forwardX * inputForward;
        const moveZ = rightZ * inputRight + forwardZ * inputForward;
        const magnitude = Math.sqrt((moveX * moveX) + (moveZ * moveZ)) || 1;

        return {
            moveX: moveX / magnitude,
            moveZ: moveZ / magnitude,
            isRunning,
        };
    }

    function clearHeldMovementFlush() {
        if (heldMovementFlushTimeout) {
            window.clearTimeout(heldMovementFlushTimeout);
            heldMovementFlushTimeout = null;
        }
    }

    function cancelHeldMovementInput() {
        clearHeldMovementFlush();
        heldMovementReleaseAtMs = 0;
        heldMovementInput = { moveX: 0, moveZ: 0, isRunning: false };
    }

    function getInputReleaseHoldMs() {
        const simulationTickMs = Number.isFinite(stateSync.simulationTickMs) && stateSync.simulationTickMs > 0
            ? stateSync.simulationTickMs
            : DEFAULT_SIMULATION_TICK_MS;
        return simulationTickMs + INPUT_RELEASE_HOLD_MARGIN_MS;
    }

    function scheduleHeldMovementFlush(delayMs) {
        clearHeldMovementFlush();
        heldMovementFlushTimeout = window.setTimeout(() => {
            heldMovementFlushTimeout = null;
            flushMovementInput({ forceRelease: true });
        }, Math.max(1, Math.ceil(delayMs)));
    }

    function getEffectiveMovementInput(rawInput = computeMovementVector()) {
        if (isChatOpen || isProfileOpen || isCommandsOpen || stateSync.selfStatus === 'dead') {
            clearHeldMovementFlush();
            heldMovementReleaseAtMs = 0;
            heldMovementInput = { moveX: 0, moveZ: 0, isRunning: false };
            return cloneMovementInput(rawInput);
        }

        if (hasMovementInput(rawInput)) {
            return cloneMovementInput(rawInput);
        }

        if (!hasMovementInput(heldMovementInput) || heldMovementReleaseAtMs <= 0) {
            return cloneMovementInput(rawInput);
        }

        const nowServerMs = getEstimatedServerTimeMs();
        if (nowServerMs >= heldMovementReleaseAtMs) {
            heldMovementReleaseAtMs = 0;
            heldMovementInput = { moveX: 0, moveZ: 0, isRunning: false };
            return cloneMovementInput(rawInput);
        }

        return cloneMovementInput(heldMovementInput);
    }

    function getMovementSpeedForInput(input) {
        if (!hasMovementInput(input)) {
            return stateSync.playerMoveSpeed;
        }

        return input.isRunning ? stateSync.playerRunSpeed : stateSync.playerMoveSpeed;
    }

    function parseRetryAfterMs(response) {
        const retryAfterHeader = Number.parseInt(response.headers.get('Retry-After') || '', 10);
        if (Number.isFinite(retryAfterHeader) && retryAfterHeader > 0) {
            return retryAfterHeader * 1000;
        }

        return STATE_POLL_BACKOFF_MS;
    }

    function scheduleNextStateFetch(delayMs = STATE_POLL_INTERVAL_MS) {
        if (statePollTimeout) {
            window.clearTimeout(statePollTimeout);
        }

        statePollTimeout = window.setTimeout(() => {
            if (!isGameRunning) return;
            fetchGameState();
        }, delayMs);
    }

    function stopStateStream() {
        if (stateStreamSource) {
            stateStreamSource.close();
            stateStreamSource = null;
        }
        stateStreamConnected = false;
    }

    function startStateStream() {
        if (typeof window.EventSource !== 'function') {
            return false;
        }

        stopStateStream();

        try {
            const streamUrl = getGameApiUrl('/stream');
            const source = new EventSource(streamUrl, { withCredentials: true });
            stateStreamSource = source;

            source.onopen = () => {
                stateStreamConnected = true;
                if (statePollTimeout) {
                    window.clearTimeout(statePollTimeout);
                    statePollTimeout = null;
                }
            };

            source.addEventListener('snapshot', (event) => {
                try {
                    const snapshot = JSON.parse(event.data || '{}');
                    applySnapshot(snapshot);
                } catch (error) {
                    console.error('Failed to parse snapshot SSE payload:', error);
                }
            });

            source.addEventListener('delta', () => {
                // Current client authority logic expects full snapshots.
                // Request a one-shot full state refresh when delta updates are enabled.
                fetchGameState().catch(() => {});
            });

            source.addEventListener('world_event_batch', () => {});

            source.onerror = () => {
                if (!isGameRunning) return;
                stopStateStream();
                scheduleNextStateFetch(STATE_POLL_BACKOFF_MS);
            };

            return true;
        } catch (error) {
            console.error('Failed to initialize SSE stream:', error);
            stopStateStream();
            return false;
        }
    }

    async function sendCommand(type, payload = {}, { suppressErrorToast = false } = {}) {
        const response = await fetch(getGameApiUrl('/command'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ type, payload }),
        });

        let data = {};
        try {
            data = await response.json();
        } catch (error) {
            data = {};
        }

        if (!response.ok) {
            const message = data.error || 'Nao foi possivel processar o comando.';
            if (!suppressErrorToast) {
                actionHud.showFloatingMessage(message, 'error');
            }
            throw new Error(message);
        }

        return data;
    }

    async function saveProfile(profile, { suppressErrorToast = false, showSuccessToast = false } = {}) {
        const nextProfile = {
            nickname: sanitizeNickname(profile?.nickname, nicknameMaxChars),
            outfitColor: sanitizeHexColor(profile?.outfitColor),
        };

        if (!nextProfile.nickname) {
            const message = 'Informe um apelido ficticio.';
            setProfileStatus(message, 'error');
            if (!suppressErrorToast) {
                actionHud.showFloatingMessage(message, 'error');
            }
            throw new Error(message);
        }

        if (!isNicknamePrivate(nextProfile.nickname, user.name)) {
            const message = 'Por privacidade, use um apelido diferente do seu nome real.';
            setProfileStatus(message, 'error');
            if (!suppressErrorToast) {
                actionHud.showFloatingMessage(message, 'error');
            }
            throw new Error(message);
        }

        profileCommandInFlight = true;
        if (profileSaveBtn) {
            profileSaveBtn.disabled = true;
        }
        setProfileStatus('Salvando perfil...');

        try {
            const result = await sendCommand('update_profile', nextProfile, { suppressErrorToast });
            const appliedProfile = {
                nickname: result?.profile?.name || nextProfile.nickname,
                outfitColor: sanitizeHexColor(result?.profile?.appearance?.outfitColor, nextProfile.outfitColor),
            };

            saveStoredProfile(user, appliedProfile);
            setProfileFormValues(appliedProfile);
            if (hudName) {
                hudName.textContent = appliedProfile.nickname;
            }
            applyAppearanceToPlayer(localPlayer, { outfitColor: appliedProfile.outfitColor });
            updateLabelSprite(localUi.label, appliedProfile.nickname, {
                backgroundColor: 'rgba(0, 0, 0, 0.55)',
                textColor: '#ffffff',
            });
            setProfileStatus('Perfil salvo no jogo.', 'success');

            if (showSuccessToast) {
                actionHud.showFloatingMessage('Perfil atualizado.');
            }

            return appliedProfile;
        } catch (error) {
            setProfileStatus(error.message || 'Nao foi possivel salvar o perfil.', 'error');
            throw error;
        } finally {
            profileCommandInFlight = false;
            if (profileSaveBtn) {
                profileSaveBtn.disabled = false;
            }
        }
    }

    function maybeMigrateStoredProfile(selfState) {
        if (didAttemptStoredProfileMigration || !hasLocalProfileOverride || !selfState) {
            return;
        }

        didAttemptStoredProfileMigration = true;

        const serverProfile = {
            nickname: selfState.name || defaultProfile.nickname,
            outfitColor: sanitizeHexColor(selfState.appearance?.outfitColor, defaultProfile.outfitColor),
        };

        if (profilesMatch(serverProfile, defaultProfile) && !profilesMatch(initialProfile, defaultProfile)) {
            saveProfile(initialProfile, { suppressErrorToast: true }).catch((error) => {
                console.error('Stored profile migration failed:', error);
            });
        }
    }

    function handleSoccerGoalEvent(goalEvent) {
        const sequence = Number(goalEvent?.sequence) || 0;
        const createdAt = Number(goalEvent?.createdAt) || 0;
        const remainingCelebrationMs = createdAt > 0
            ? Math.max(0, SOCCER_GOAL_CELEBRATION_MS - (Date.now() - createdAt))
            : SOCCER_GOAL_CELEBRATION_MS;
        const playerName = String(goalEvent?.playerName || 'Alguem').trim() || 'Alguem';
        const shouldShowCelebration = sequence > 0 && remainingCelebrationMs > 0;

        if (lastSoccerGoalSequence == null) {
            lastSoccerGoalSequence = sequence;
            if (shouldShowCelebration) {
                world.showSoccerGoalBanner(goalEvent, remainingCelebrationMs);
                actionHud.showSystemNotice(`Gol de ${playerName}!`);
            }
            return;
        }

        if (sequence <= 0 || sequence === lastSoccerGoalSequence) {
            return;
        }

        lastSoccerGoalSequence = sequence;
        if (shouldShowCelebration) {
            world.showSoccerGoalBanner(goalEvent, remainingCelebrationMs);
        }
        actionHud.showSystemNotice(`Gol de ${playerName}!`);
    }

    async function flushMovementInput({ forceRelease = false } = {}) {
        const rawInput = computeMovementVector();
        const rawSignature = formatInputSignature(rawInput);

        if (rawSignature !== lastObservedInputSignature) {
            lastObservedInputSignature = rawSignature;
            if (hasMovementInput(rawInput)) {
                clearHeldMovementFlush();
                heldMovementReleaseAtMs = 0;
                heldMovementInput = cloneMovementInput(rawInput);
            }
        }

        const shouldDeferRelease = !forceRelease
            && !hasMovementInput(rawInput)
            && hasMovementInput(lastDispatchedMovementInput)
            && heldMovementReleaseAtMs > getEstimatedServerTimeMs();

        if (shouldDeferRelease) {
            scheduleHeldMovementFlush(heldMovementReleaseAtMs - getEstimatedServerTimeMs());
            return;
        }

        const nextInput = cloneMovementInput(rawInput);
        const nextSignature = formatInputSignature(nextInput);

        if (inputCommandInFlight || nextSignature === lastInputSignature) {
            return;
        }

        inputCommandInFlight = true;
        lastDispatchedMovementInput = cloneMovementInput(nextInput);

        if (hasMovementInput(nextInput)) {
            clearHeldMovementFlush();
            heldMovementInput = cloneMovementInput(nextInput);
            heldMovementReleaseAtMs = getEstimatedServerTimeMs() + getInputReleaseHoldMs();
        } else {
            clearHeldMovementFlush();
            heldMovementReleaseAtMs = 0;
            heldMovementInput = { moveX: 0, moveZ: 0, isRunning: false };
        }

        try {
            await sendCommand('set_input', nextInput, { suppressErrorToast: true });
            lastInputSignature = nextSignature;
        } catch (error) {
            const now = Date.now();
            if ((now - lastMovementErrorAt) > 2500) {
                actionHud.showFloatingMessage('Falha ao sincronizar movimento.', 'error');
                lastMovementErrorAt = now;
            }
        } finally {
            inputCommandInFlight = false;

            const currentSignature = formatInputSignature(computeMovementVector());
            if (currentSignature !== lastInputSignature) {
                flushMovementInput();
            }
        }
    }

    function getPredictedSelfAuthorityState(input = getEffectiveMovementInput()) {
        const predictedPosition = stateSync.selfTargetPosition.clone();
        const moving = hasMovementInput(input);
        let predictedRotationY = stateSync.selfTargetRotationY;

        if (moving) {
            const movementSpeed = getMovementSpeedForInput(input);
            const elapsedMs = stateSync.selfSnapshotServerTimeMs > 0
                ? Math.max(0, getEstimatedServerTimeMs() - stateSync.selfSnapshotServerTimeMs)
                : Math.max(0, performance.now() - stateSync.selfSnapshotReceivedAt);
            const elapsedSeconds = Math.min(elapsedMs / 1000, SELF_AUTHORITY_PREDICTION_MAX_SECONDS);
            const nextPredictedPosition = world.resolveActorMovement(
                predictedPosition,
                {
                    x: predictedPosition.x + (input.moveX * movementSpeed * elapsedSeconds),
                    y: predictedPosition.y,
                    z: predictedPosition.z + (input.moveZ * movementSpeed * elapsedSeconds),
                }
            );

            predictedPosition.set(
                nextPredictedPosition.x,
                nextPredictedPosition.y,
                nextPredictedPosition.z
            );
            predictedRotationY = Math.atan2(input.moveX, input.moveZ);
        }

        return {
            moving,
            position: predictedPosition,
            rotationY: predictedRotationY,
        };
    }

    function getSelfPredictionLeadSeconds(authoritativePosition, input = getEffectiveMovementInput()) {
        if (!stateSync.selfInitialized || !authoritativePosition) {
            return 0;
        }

        if (!hasMovementInput(input)) {
            return 0;
        }

        const movementSpeed = getMovementSpeedForInput(input);
        if (!Number.isFinite(movementSpeed) || movementSpeed <= 0.001) {
            return 0;
        }

        const offsetX = localPlayer.group.position.x - (Number(authoritativePosition.x) || 0);
        const offsetZ = localPlayer.group.position.z - (Number(authoritativePosition.z) || 0);
        const projectedLead = (offsetX * input.moveX) + (offsetZ * input.moveZ);
        return clamp(projectedLead / movementSpeed, 0, SELF_AUTHORITY_PREDICTION_MAX_SECONDS);
    }

    function activateChatInputMode() {
        if (isCommandsOpen) {
            closeCommandsPanel();
        }

        if (isProfileOpen) {
            closeProfilePanel();
        }

        if (isChatMinimized) {
            setChatMinimized(false);
        }

        if (!isChatOpen) {
            isChatOpen = true;
            Object.keys(keys).forEach((key) => {
                keys[key] = false;
            });
            clearTouchMovementKeys();
            cancelHeldMovementInput();
            lastInputSignature = '__stale__';
            flushMovementInput({ forceRelease: true });

            if (document.exitPointerLock) {
                document.exitPointerLock();
            }
        }

        if (chatPanel) {
            chatPanel.classList.add('focused');
        }

        updateChatCounter();
    }

    function deactivateChatInputMode({ clearInput = false, blurInput = true } = {}) {
        const wasChatOpen = isChatOpen;
        isChatOpen = false;

        if (chatPanel) {
            chatPanel.classList.remove('focused');
        }

        if (clearInput) {
            chatInput.value = '';
            updateChatCounter();
        }

        if (blurInput && document.activeElement === chatInput) {
            chatInput.blur();
        }

        if (wasChatOpen) {
            cancelHeldMovementInput();
            lastInputSignature = '__stale__';
            flushMovementInput({ forceRelease: true });
        }
    }

    function openChat() {
        activateChatInputMode();
        if (document.activeElement !== chatInput) {
            chatInput.focus();
        }
    }

    function closeChat(clearInput = false) {
        deactivateChatInputMode({ clearInput, blurInput: true });
    }

    function openCommandsPanel() {
        if (isChatOpen) {
            closeChat(false);
        }

        if (isProfileOpen) {
            closeProfilePanel();
        }

        isCommandsOpen = true;
        pauseGameInputForOverlay();

        if (commandsPanel) {
            commandsPanel.hidden = false;
        }

        syncTopMenuToggles();
    }

    function closeCommandsPanel() {
        isCommandsOpen = false;

        if (commandsPanel) {
            commandsPanel.hidden = true;
        }

        if (commandsCloseBtn && document.activeElement === commandsCloseBtn) {
            commandsCloseBtn.blur();
        }

        syncTopMenuToggles();
        cancelHeldMovementInput();
        lastInputSignature = '__stale__';
        flushMovementInput({ forceRelease: true });
    }

    function toggleCommandsPanel() {
        if (isCommandsOpen) {
            closeCommandsPanel();
            return;
        }

        openCommandsPanel();
    }

    function openProfilePanel() {
        if (isCommandsOpen) {
            closeCommandsPanel();
        }

        if (isChatOpen) {
            closeChat(false);
        }

        isProfileOpen = true;
        pauseGameInputForOverlay();

        if (profilePanel) {
            profilePanel.hidden = false;
        }

        setProfileStatus('');
        syncTopMenuToggles();
        if (profileNicknameInput) {
            profileNicknameInput.focus();
            profileNicknameInput.select();
        }
    }

    function closeProfilePanel() {
        isProfileOpen = false;

        if (profilePanel) {
            profilePanel.hidden = true;
        }

        if (profileNicknameInput) {
            profileNicknameInput.blur();
        }

        setProfileStatus('');
        syncTopMenuToggles();
        cancelHeldMovementInput();
        lastInputSignature = '__stale__';
        flushMovementInput({ forceRelease: true });
    }

    function toggleProfilePanel() {
        if (isProfileOpen) {
            closeProfilePanel();
            return;
        }

        openProfilePanel();
    }

    function updateChatCounter() {
        if (!chatCounter) return;
        chatCounter.textContent = `${chatInput.value.length}/${chatMaxChars}`;
    }

    async function sendUseActionCommand() {
        if (actionCommandInFlight) {
            return;
        }

        if (stateSync.selfStatus === 'dead') {
            actionHud.showFloatingMessage('Aguarde o respawn.', 'error');
            return;
        }

        actionCommandInFlight = true;
        actionSoundboard.prime();

        try {
            const result = await sendCommand('use_action');
            if (!result?.action) {
                return;
            }
            if (result.position) {
                localPlayer.setTransform(result.position, typeof result.rotationY === 'number' ? result.rotationY : localPlayer.group.rotation.y);
                stateSync.selfTargetPosition.set(
                    result.position.x || 0,
                    result.position.y || 0,
                    result.position.z || 0
                );
                if (typeof result.rotationY === 'number') {
                    stateSync.selfTargetRotationY = result.rotationY;
                }
                stateSync.selfSnapshotReceivedAt = performance.now();
                stateSync.selfSnapshotServerTimeMs = getEstimatedServerTimeMs();
                stateSync.selfInitialized = true;
            }
            updateActorModelState(localUi, {
                currentAction: result.action,
                equipment: result.action === 'attack_sword'
                    ? {
                        ...localPlayer.getEquipmentState(),
                        sword: true,
                    }
                    : localPlayer.getEquipmentState(),
            });
            updateActorAction(localUi, { currentAction: result.action, status: 'acting' });
            actionSoundboard.playAction(result.action);
        } catch (error) {
            console.error('Action command failed:', error);
        } finally {
            actionCommandInFlight = false;
        }
    }

    async function sendFruitToggleCommand() {
        if (actionCommandInFlight) {
            return;
        }

        if (stateSync.selfStatus === 'dead') {
            actionHud.showFloatingMessage('Aguarde o respawn.', 'error');
            return;
        }

        actionCommandInFlight = true;
        actionSoundboard.prime();

        try {
            const result = await sendCommand('toggle_fruit');
            if (!result?.action) {
                return;
            }
            updateActorModelState(localUi, {
                currentAction: result.action,
                equipment: getPredictedEquipmentAfterLocalAction(result.action),
            });
            updateActorAction(localUi, { currentAction: result.action, status: 'acting' });
            actionSoundboard.playAction(result.action);
        } catch (error) {
            console.error('Fruit toggle command failed:', error);
        } finally {
            actionCommandInFlight = false;
        }
    }

    function jumpLocalPlayer() {
        if (stateSync.selfStatus === 'dead') {
            return;
        }

        localPlayer.jump();
    }

    chatForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const message = chatInput.value.trim();
        if (!message) {
            closeChat(true);
            return;
        }

        try {
            await sendCommand('chat', { message });
            updateActorSpeech(localUi, message);
            closeChat(true);
        } catch (error) {
            console.error('Chat command failed:', error);
        }
    });

    chatInput.addEventListener('input', updateChatCounter);
    chatInput.addEventListener('focus', activateChatInputMode);
    chatInput.addEventListener('blur', () => {
        deactivateChatInputMode({ blurInput: false });
    });
    updateChatCounter();
    updateCollapsedChatBadge();
    setChatMinimized(isChatMinimized);
    setLeaderboardMinimized(isLeaderboardMinimized);
    syncTopMenuToggles();
    setMobileControlsVisibility();
    bindMobileMovementControls();

    if (chatCollapsedToggle) {
        chatCollapsedToggle.addEventListener('click', openChat);
    }

    if (chatMinimizeBtn) {
        chatMinimizeBtn.addEventListener('click', () => {
            closeChat(false);
            setChatMinimized(true);
        });
    }

    if (leaderboardMinimizeBtn) {
        leaderboardMinimizeBtn.addEventListener('click', () => {
            setLeaderboardMinimized(!isLeaderboardMinimized);
        });
    }

    if (commandsToggleBtn) {
        commandsToggleBtn.addEventListener('click', toggleCommandsPanel);
    }

    if (commandsCloseBtn) {
        commandsCloseBtn.addEventListener('click', closeCommandsPanel);
    }

    if (profileColorInput) {
        profileColorInput.addEventListener('input', () => {
            if (profileColorValue) {
                profileColorValue.textContent = sanitizeHexColor(profileColorInput.value);
            }
            setProfileStatus('');
        });
    }

    if (profileNicknameInput) {
        profileNicknameInput.addEventListener('input', () => {
            setProfileStatus('');
        });
    }

    if (profileToggleBtn) {
        profileToggleBtn.addEventListener('click', toggleProfilePanel);
    }

    if (profileCloseBtn) {
        profileCloseBtn.addEventListener('click', closeProfilePanel);
    }

    if (profileForm) {
        profileForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            try {
                await saveProfile(readProfileFormValues(), { showSuccessToast: true });
                closeProfilePanel();
            } catch (error) {
                console.error('Profile update failed:', error);
            }
        });
    }

    window.addEventListener('keydown', (event) => {
        const key = event.key.toLowerCase();

        if (isChatOpen) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeChat(false);
            }
            return;
        }

        if (isProfileOpen) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeProfilePanel();
            }
            return;
        }

        if (isCommandsOpen) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeCommandsPanel();
            }
            return;
        }

        keys[key] = true;

        if (event.key === ' ') {
            event.preventDefault();
            jumpLocalPlayer();
            return;
        }

        if (key === 't') {
            event.preventDefault();
            openChat();
            return;
        }

        if (key === 'e') {
            if (event.repeat) {
                return;
            }
            handlePrimaryActionInput();
            return;
        }

        if (key === 'f') {
            if (event.repeat) {
                return;
            }
            handleSecondaryActionInput();
            return;
        }

        flushMovementInput();
    });

    window.addEventListener('keyup', (event) => {
        if (isChatOpen || isProfileOpen || isCommandsOpen) {
            return;
        }

        keys[event.key.toLowerCase()] = false;
        flushMovementInput();
    });

    window.addEventListener('blur', () => {
        Object.keys(keys).forEach((key) => {
            keys[key] = false;
        });
        clearTouchMovementKeys();
        cancelHeldMovementInput();
        lastInputSignature = '__stale__';
        flushMovementInput({ forceRelease: true });
    });

    function handlePrimaryActionInput() {
        if (isChatOpen || isProfileOpen || isCommandsOpen) {
            return;
        }

        sendUseActionCommand();
    }

    function handleSecondaryActionInput() {
        if (isChatOpen || isProfileOpen || isCommandsOpen) {
            return;
        }

        sendFruitToggleCommand();
    }

    function requestPointerLock() {
        if (isTouchDevice || isChatOpen || isProfileOpen || isCommandsOpen || document.pointerLockElement === canvas) return;
        canvas.requestPointerLock();
    }

    function handlePointerLockChange() {
        cameraState.isPointerLocked = document.pointerLockElement === canvas;
        document.body.classList.toggle('pointer-locked', cameraState.isPointerLocked);
    }

    function handlePointerLockError() {
        cameraState.isPointerLocked = false;
        document.body.classList.remove('pointer-locked');
    }

    function moveLockedCamera(event) {
        if (!cameraState.isPointerLocked) return;

        cameraState.yaw -= event.movementX * 0.0025;
        cameraState.pitch = clamp(cameraState.pitch - event.movementY * 0.0025, cameraState.minPitch, cameraState.maxPitch);
        stateSync.introBlend = 0;
    }

    function handleTouchLookStart(event) {
        if (!isTouchDevice || isChatOpen || isProfileOpen || isCommandsOpen) return;
        if (event.target.closest('.mobile-controls') || event.target.closest('.hud-top')) return;

        if (event.cancelable) event.preventDefault();

        activeTouchLookPointers.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY
        });
    }

    function handleTouchLookMove(event) {
        const lastPos = activeTouchLookPointers.get(event.pointerId);
        if (!lastPos) return;

        if (event.cancelable) event.preventDefault();

        const deltaX = event.clientX - lastPos.x;
        const deltaY = event.clientY - lastPos.y;

        const sensitivity = 0.0045;
        cameraState.yaw -= deltaX * sensitivity;
        cameraState.pitch = clamp(cameraState.pitch - deltaY * sensitivity, cameraState.minPitch, cameraState.maxPitch);
        stateSync.introBlend = 0;

        lastPos.x = event.clientX;
        lastPos.y = event.clientY;
    }

    function handleTouchLookEnd(event) {
        activeTouchLookPointers.delete(event.pointerId);
    }

    function zoomCamera(event) {
        cameraState.distance = clamp(
            cameraState.distance + event.deltaY * 0.01,
            cameraState.minDistance,
            cameraState.maxDistance
        );
        stateSync.introBlend = 0;
        event.preventDefault();
    }

    function updateCamera(delta, snap = false) {
        const playerPos = localPlayer.getPosition();
        const focusY = playerPos.y + PLAYER_CAMERA_FOCUS_HEIGHT;
        const horizontalDistance = cameraState.distance * Math.cos(cameraState.pitch);

        targetCamPos.set(
            playerPos.x + Math.sin(cameraState.yaw) * horizontalDistance,
            focusY + (Math.sin(cameraState.pitch) * cameraState.distance),
            playerPos.z + Math.cos(cameraState.yaw) * horizontalDistance
        );
        targetCamPos.y = Math.max(targetCamPos.y, playerPos.y + CAMERA_MIN_RELATIVE_HEIGHT);

        playerFocus.set(playerPos.x, focusY, playerPos.z);
        scenicFocus.set(
            (playerPos.x + world.lakePosition.x) * 0.5,
            2.6,
            (playerPos.z + world.lakePosition.z) * 0.5
        );
        lookTarget.lerpVectors(playerFocus, scenicFocus, stateSync.introBlend);

        if (snap) {
            camera.position.copy(targetCamPos);
        } else {
            camera.position.lerp(targetCamPos, Math.min(1, 4 * delta));
            stateSync.introBlend = Math.max(0, stateSync.introBlend - delta * 0.85);
        }

        const effectiveLookTarget = camera.position.distanceToSquared(lookTarget) < 0.0001
            ? lookTarget.clone().add(new THREE.Vector3(0, 0.001, 0))
            : lookTarget;

        camera.lookAt(effectiveLookTarget);
    }

    function createRemotePlayerState(playerState, serverTimeMs = 0) {
        const isAgent = playerState.actorType === 'agent';
        const palette = buildAppearancePalette(playerState.appearance);
        const agentPalette = isAgent ? {
            shirtColor: 0x0d9488,
            pantsColor: 0x134e4a,
            shoeColor: 0x475569,
            hairColor: 0x64748b,
        } : null;
        const remotePlayer = new Player(scene, playerState.name, {
            spawnPosition: playerState.position,
            shirtColor: isAgent ? agentPalette.shirtColor : palette.shirtColor,
            pantsColor: isAgent ? agentPalette.pantsColor : palette.pantsColor,
            shoeColor: isAgent ? agentPalette.shoeColor : palette.shoeColor,
            hairColor: isAgent ? agentPalette.hairColor : palette.hairColor,
        });
        const displayName = isAgent ? `\u{1F916} ${playerState.name || 'Agente'}` : playerState.name;
        const labelBg = isAgent ? 'rgba(13, 148, 136, 0.88)' : 'rgba(17, 24, 39, 0.84)';
        const labelColor = isAgent ? '#f0fdfa' : '#f8fafc';
        const remoteUi = attachActorUi(remotePlayer, displayName, {
            backgroundColor: labelBg,
            textColor: labelColor,
            width: 288,
            height: 64,
            scaleX: 3.2,
            scaleY: 0.76,
            maxCloseDistance: 15,
        });

        const remotePlayerState = {
            player: remotePlayer,
            label: remoteUi.label,
            vitals: remoteUi.vitals,
            action: remoteUi.action,
            speech: remoteUi.speech,
            labelSprite: remoteUi.label,
            vitalsSprite: remoteUi.vitals,
            actionSprite: remoteUi.action,
            speechSprite: remoteUi.speech,
            speechText: remoteUi.speechText,
            vitalsKey: remoteUi.vitalsKey,
            actionKey: remoteUi.actionKey,
            targetPosition: new THREE.Vector3(
                playerState.position?.x || 0,
                playerState.position?.y || 0,
                playerState.position?.z || 0
            ),
            targetRotationY: playerState.rotationY || Math.PI,
            appearanceSignature: getAppearanceSignature(playerState.appearance),
            samples: [],
            isAgent: isAgent,
        };

        pushActorSample(remotePlayerState.samples, playerState, serverTimeMs);
        return remotePlayerState;
    }

    function removeRemotePlayer(playerId) {
        const remoteState = remotePlayers.get(playerId);
        if (!remoteState) return;

        scene.remove(remoteState.player.group);
        remotePlayers.delete(playerId);
    }

    function syncSoccerBallCarrierVisual() {
        if (!soccerBallCarrierId) {
            world.setSoccerBallCarrierState(null);
            return;
        }

        if (soccerBallCarrierId === user.id) {
            world.setSoccerBallCarrierState({
                position: localPlayer.group.position,
                rotationY: localPlayer.group.rotation.y,
            });
            return;
        }

        const remoteState = remotePlayers.get(soccerBallCarrierId);
        if (remoteState?.player?.group) {
            world.setSoccerBallCarrierState({
                position: remoteState.player.group.position,
                rotationY: remoteState.player.group.rotation.y,
            });
            return;
        }

        world.setSoccerBallCarrierState(null);
    }

    function applySnapshot(snapshot) {
        if (!snapshot) return;

        const snapshotTick = Number(snapshot.tick);
        if (Number.isFinite(snapshotTick) && snapshotTick <= stateSync.lastSnapshotTick) {
            return;
        }

        if (Number.isFinite(snapshotTick)) {
            stateSync.lastSnapshotTick = snapshotTick;
        }

        const serverTimeMs = updateServerTimeEstimate(snapshot.serverTime);
        if (!stateSync.worldVersion && Number(snapshot.worldVersion) > 0) {
            stateSync.worldVersion = Number(snapshot.worldVersion);
        }

        if (snapshot.self && snapshot.self.position) {
            stateSync.selfStatus = snapshot.self.status || 'idle';
            stateSync.selfTargetPosition.set(
                snapshot.self.position.x || 0,
                snapshot.self.position.y || 0,
                snapshot.self.position.z || 0
            );
            stateSync.selfTargetRotationY = typeof snapshot.self.rotationY === 'number'
                ? snapshot.self.rotationY
                : stateSync.selfTargetRotationY;
            stateSync.selfSnapshotReceivedAt = performance.now();
            stateSync.selfSnapshotServerTimeMs = serverTimeMs > 0
                ? serverTimeMs - (getSelfPredictionLeadSeconds(snapshot.self.position) * 1000)
                : 0;

            if (!stateSync.selfInitialized) {
                localPlayer.setTransform(snapshot.self.position, snapshot.self.rotationY);
                stateSync.selfInitialized = true;
            }

            const selfNickname = snapshot.self.name || initialProfile.nickname;
            const selfOutfitColor = sanitizeHexColor(snapshot.self.appearance?.outfitColor, initialProfile.outfitColor);
            maybeMigrateStoredProfile(snapshot.self);

            if (hudName) {
                hudName.textContent = selfNickname;
            }

            applyAppearanceToPlayer(localPlayer, { outfitColor: selfOutfitColor });
            saveStoredProfile(user, {
                nickname: selfNickname,
                outfitColor: selfOutfitColor,
            });

            if (!isProfileOpen && !profileCommandInFlight) {
                setProfileFormValues({
                    nickname: selfNickname,
                    outfitColor: selfOutfitColor,
                });
            }

            updateLabelSprite(localUi.label, selfNickname, {
                backgroundColor: 'rgba(0, 0, 0, 0.55)',
                textColor: '#ffffff',
            });
            updateActorModelState(localUi, snapshot.self);
            updateActorVitals(localUi, snapshot.self);
            updateActorAction(localUi, snapshot.self);
            updateActorSpeech(localUi, snapshot.self.speechVisible ? snapshot.self.speech : '');
            updateActorHitFeedback(localUi, snapshot.self);
            actionHud.update(snapshot.self);
        }

        if (snapshot.settings) {
            applyRuntimeSettings(snapshot.settings);
        }

        if (snapshot.ai && snapshot.ai.position) {
            pushActorSample(stateSync.aiSamples, snapshot.ai, serverTimeMs);

            if (!stateSync.aiInitialized) {
                aiPlayer.setTransform(snapshot.ai.position, snapshot.ai.rotationY);
                stateSync.aiInitialized = true;
            }

            updateLabelSprite(aiUi.label, snapshot.ai.name || 'Jardineiro IA', {
                backgroundColor: 'rgba(6, 78, 59, 0.88)',
                textColor: '#dcfce7',
            });
            updateActorModelState(aiUi, snapshot.ai);
            updateActorVitals(aiUi, snapshot.ai);
            updateActorAction(aiUi, snapshot.ai);
            updateActorSpeech(aiUi, snapshot.ai.speechVisible ? snapshot.ai.speech : '');
            updateActorHitFeedback(aiUi, snapshot.ai);
        }

        if (snapshot.world && Array.isArray(snapshot.world.trees)) {
            world.syncTreeState(snapshot.world.trees);
        }

        if (snapshot.world) {
            world.syncDroppedApples(snapshot.world.droppedApples);
            world.syncSwordPickups(snapshot.world.swords);
            world.syncBowPickups(snapshot.world.bows);
            world.syncArrowProjectiles(snapshot.world.arrows);
            world.syncElevators(snapshot.world.elevators);
        }

        if (snapshot.world && Array.isArray(snapshot.world.graves)) {
            world.syncGraves(snapshot.world.graves);
        }

        if (snapshot.world && snapshot.world.soccer) {
            soccerBallCarrierId = String(snapshot.world.soccer.ball?.possessedByActorId || '').trim();
            world.syncSoccerState(snapshot.world.soccer);
            handleSoccerGoalEvent(snapshot.world.soccer.lastGoalEvent);
        }

        if (snapshot.world && Number.isFinite(snapshot.world.bounds)) {
            stateSync.worldBounds = snapshot.world.bounds;
            world.setWorldBounds(snapshot.world.bounds);
        }

        if (snapshot.leaderboard) {
            renderLeaderboard(snapshot.leaderboard);
        }

        if (snapshot.soccerLeaderboard) {
            renderSoccerLeaderboard(snapshot.soccerLeaderboard);
        }

        renderPlayerChat(snapshot.playerChat);

        const activeRemoteIds = new Set();
        const selfId = snapshot.self?.id || user.id;
        const players = Array.isArray(snapshot.players) ? snapshot.players : [];

        players.forEach((playerState) => {
            if (!playerState || playerState.id === selfId || !playerState.position) {
                return;
            }

            activeRemoteIds.add(playerState.id);
            const isNewRemotePlayer = !remotePlayers.has(playerState.id);

            if (isNewRemotePlayer) {
                remotePlayers.set(playerState.id, createRemotePlayerState(playerState, serverTimeMs));

                if (stateSync.remotePresenceInitialized) {
                    actionHud.showSystemNotice(`${playerState.name || 'Alguem'} entrou no jardim.`);
                }
            }

            const remoteState = remotePlayers.get(playerState.id);
            pushActorSample(remoteState.samples, playerState, serverTimeMs);

            const nextAppearanceSignature = getAppearanceSignature(playerState.appearance);
            if (remoteState.appearanceSignature !== nextAppearanceSignature) {
                applyAppearanceToPlayer(remoteState.player, playerState.appearance);
                remoteState.appearanceSignature = nextAppearanceSignature;
            }

            const isRemoteAgent = remoteState.isAgent || playerState.actorType === 'agent';
            const remoteLabelName = isRemoteAgent ? `\u{1F916} ${playerState.name || 'Agente'}` : (playerState.name || 'Jogador');
            updateLabelSprite(remoteState.labelSprite, remoteLabelName, {
                backgroundColor: isRemoteAgent ? 'rgba(13, 148, 136, 0.88)' : 'rgba(17, 24, 39, 0.84)',
                textColor: isRemoteAgent ? '#f0fdfa' : '#f8fafc',
            });
            updateActorModelState(remoteState, playerState);
            updateActorVitals(remoteState, playerState);
            updateActorAction(remoteState, playerState);
            updateActorSpeech(remoteState, playerState.speechVisible ? playerState.speech : '');
            updateActorHitFeedback(remoteState, playerState);
        });

        Array.from(remotePlayers.keys()).forEach((playerId) => {
            if (!activeRemoteIds.has(playerId)) {
                removeRemotePlayer(playerId);
            }
        });

        stateSync.remotePresenceInitialized = true;
    }

    async function fetchGameState() {
        if (stateSync.isFetching) {
            if (!stateStreamConnected) {
                scheduleNextStateFetch();
            }
            return;
        }

        stateSync.isFetching = true;
        let shouldScheduleNext = true;
        let nextDelayMs = STATE_POLL_INTERVAL_MS;

        try {
            const response = await fetch(getGameApiUrl('/public-state'), {
                cache: 'no-store',
                credentials: 'include',
            });

            if (response.status === 401) {
                shouldScheduleNext = false;
                redirectToLogin();
                return;
            }

            if (!response.ok) {
                if (response.status === 429) {
                    nextDelayMs = parseRetryAfterMs(response);
                }

                throw new Error(`Game state request failed with ${response.status}`);
            }

            const snapshot = await response.json();
            applySnapshot(snapshot);
        } catch (error) {
            console.error('Failed to fetch game state:', error);
        } finally {
            stateSync.isFetching = false;
            if (shouldScheduleNext && !stateStreamConnected) {
                scheduleNextStateFetch(nextDelayMs);
            }
        }
    }

    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('mousedown', (event) => {
        if (event.button === 2) {
            handleSecondaryActionInput();
            return;
        }

        if (event.button !== 0) {
            return;
        }

        handlePrimaryActionInput();
    });
    canvas.addEventListener('click', requestPointerLock);
    canvas.addEventListener('pointerdown', handleTouchLookStart);
    document.addEventListener('pointerlockchange', handlePointerLockChange, cleanupSignal);
    document.addEventListener('pointerlockerror', handlePointerLockError, cleanupSignal);
    window.addEventListener('mousemove', moveLockedCamera, cleanupSignal);
    window.addEventListener('pointermove', handleTouchLookMove, cleanupSignal);
    window.addEventListener('pointerup', handleTouchLookEnd, cleanupSignal);
    window.addEventListener('pointercancel', handleTouchLookEnd, cleanupSignal);
    canvas.addEventListener('wheel', zoomCamera, { passive: false });

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }, cleanupSignal);

    const clock = new THREE.Clock();
    let elapsedTime = 0;

    if (loadingScreen) {
        loadingScreenTimeout = setTimeout(() => {
            loadingScreen.classList.add('hidden');
            loadingScreenTimeout = null;
        }, 500);
    }

    saveStoredProfile(user, initialProfile);
    updateCamera(0, true);

    const streamStarted = startStateStream();
    if (!streamStarted) {
        fetchGameState();
    } else {
        scheduleNextStateFetch(1500);
    }
    movementSyncInterval = setInterval(flushMovementInput, INPUT_SYNC_INTERVAL_MS);

    function animate() {
        if (!isGameRunning) return;
        animationId = requestAnimationFrame(animate);

        const delta = Math.min(clock.getDelta(), 0.05);
        elapsedTime += delta;
        const rawLocalInput = computeMovementVector();
        const localInput = getEffectiveMovementInput(rawLocalInput);
        const localMovementKeys = (isChatOpen || isProfileOpen || isCommandsOpen || stateSync.selfStatus === 'dead') ? {} : keys;
        localPlayer.speed = getMovementSpeedForInput(localInput);

        localPlayer.update(delta, localMovementKeys, cameraState.yaw, {
            speed: localPlayer.speed,
            bound: stateSync.worldBounds,
            movementResolver: (currentPosition, nextPosition) => world.resolveActorMovement(currentPosition, nextPosition),
            inputVector: localInput,
        });
        const predictedSelfAuthority = getPredictedSelfAuthorityState(localInput);
        localPlayer.applyAuthorityCorrection(
            delta,
            predictedSelfAuthority.position,
            predictedSelfAuthority.rotationY,
            predictedSelfAuthority.moving
                ? {
                    deadzone: SELF_AUTHORITY_MOVING_DEADZONE,
                    snapDistance: SELF_AUTHORITY_MOVING_SNAP_DISTANCE,
                    positionStrength: SELF_AUTHORITY_MOVING_POSITION_STRENGTH,
                    rotationStrength: SELF_AUTHORITY_MOVING_ROTATION_STRENGTH,
                }
                : {
                    deadzone: 0.08,
                    snapDistance: 4,
                    positionStrength: 9,
                    rotationStrength: 10,
                }
        );

        const remoteRenderServerTimeMs = getEstimatedServerTimeMs() - REMOTE_INTERPOLATION_BACK_TIME_MS;
        const aiTransform = interpolateActorSample(stateSync.aiSamples, remoteRenderServerTimeMs);
        if (aiTransform) {
            stateSync.aiTargetPosition.copy(aiTransform.position);
            stateSync.aiTargetRotationY = aiTransform.rotationY;
        }
        aiPlayer.updateRemote(delta, stateSync.aiTargetPosition, stateSync.aiTargetRotationY);

        remotePlayers.forEach((remoteState) => {
            const remoteTransform = interpolateActorSample(remoteState.samples, remoteRenderServerTimeMs);
            if (remoteTransform) {
                remoteState.targetPosition.copy(remoteTransform.position);
                remoteState.targetRotationY = remoteTransform.rotationY;
            }
            remoteState.player.updateRemote(delta, remoteState.targetPosition, remoteState.targetRotationY);
        });

        localPlayer.refreshVisualEffects();
        aiPlayer.refreshVisualEffects();
        remotePlayers.forEach((remoteState) => {
            remoteState.player.refreshVisualEffects();
        });

        syncSoccerBallCarrierVisual();
        world.update(elapsedTime);
        updateCamera(delta);
        updateActorUiScale(localUi, localPlayer);
        updateActorUiScale(aiUi, aiPlayer);
        remotePlayers.forEach((remoteState) => {
            updateActorUiScale(remoteState, remoteState.player);
        });

        renderer.render(scene, camera);
    }

    animate();

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }

    const hubBtn = document.getElementById('hubBtn');
    if (hubBtn) {
        hubBtn.addEventListener('click', async () => {
            // Start cleanup immediately to free CPU
            cleanupGame();
            
            // Try to track the event (best effort)
            try {
                await window.Platform?.trackEvent?.({
                    event: 'platform_back_to_hub',
                    gameSlug: GAME_CONFIG.slug,
                });
            } catch (err) {}
            
            goToHub();
        });
    }

    // Safety fallback for unexpected navigation
    window.addEventListener('beforeunload', cleanupGame, cleanupSignal);
})();
