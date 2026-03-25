(function initializePlatformSdk() {
    const DEFAULT_HUB_PATH = '/hub.html';
    const DEFAULT_LOGIN_PATH = '/index.html';
    let bootstrapCache = null;

    function resolveApiUrl() {
        if (typeof window.API_URL === 'string') {
            return window.API_URL;
        }

        if (typeof getApiUrl === 'function') {
            return getApiUrl();
        }

        return 'http://localhost:8080';
    }

    function normalizeFrontendPath(value, fallbackPath) {
        if (typeof value !== 'string' || !value.trim()) {
            return fallbackPath;
        }

        return value.trim().startsWith('/')
            ? value.trim()
            : fallbackPath;
    }

    function attachApiOverrideToRoute(route) {
        if (typeof route !== 'string' || !route.trim()) {
            return route;
        }

        const normalizedRoute = route.trim();
        let apiOrigin = '';

        try {
            apiOrigin = new URL(resolveApiUrl(), window.location.origin).origin;
        } catch (error) {
            apiOrigin = '';
        }

        if (!apiOrigin || apiOrigin === window.location.origin) {
            return normalizedRoute;
        }

        try {
            const targetUrl = new URL(normalizedRoute, window.location.origin);
            if (!targetUrl.searchParams.has('api')) {
                targetUrl.searchParams.set('api', apiOrigin);
            }

            if (targetUrl.origin === window.location.origin) {
                return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
            }

            return targetUrl.toString();
        } catch (error) {
            return normalizedRoute;
        }
    }

    async function safeReadJson(response) {
        try {
            return await response.json();
        } catch (error) {
            return null;
        }
    }

    async function fetchPlatform(path, { method = 'GET', body = null, cache = 'no-store', timeoutMs = 10000 } = {}) {
        const url = `${resolveApiUrl()}${path}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        
        console.debug(`[Platform] Requesting ${method} ${path}...`);
        const startTime = Date.now();

        try {
            const response = await fetch(url, {
                method,
                cache,
                credentials: 'include',
                signal: controller.signal,
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body: body ? JSON.stringify(body) : undefined,
            });

            clearTimeout(timeoutId);

            const duration = Date.now() - startTime;
            console.debug(`[Platform] Response from ${path}: ${response.status} (${duration}ms)`);

            if (response.status === 204) {
                return null;
            }

            const payload = await safeReadJson(response);

            if (!response.ok) {
                if (response.status === 401) {
                    bootstrapCache = null;
                }
                const error = new Error(payload?.error || `Platform request failed with ${response.status}`);
                error.status = response.status;
                error.payload = payload;
                error.isAuthError = response.status === 401;
                console.error(`[Platform] Error in ${method} ${path}:`, error.message);
                throw error;
            }

            return payload;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                console.error(`[Platform] Request to ${path} TIMEOUT (${timeoutMs}ms)`);
                const timeoutErr = new Error(`Network timeout requesting ${path}`);
                timeoutErr.status = 408;
                throw timeoutErr;
            }
            throw error;
        }
    }

    function getGameContext() {
        const config = window.PLATFORM_GAME_CONFIG || {};
        return {
            slug: typeof config.slug === 'string' ? config.slug : null,
            name: typeof config.name === 'string' ? config.name : null,
            gamePath: normalizeFrontendPath(config.gamePath, null),
            hubPath: normalizeFrontendPath(config.hubPath, DEFAULT_HUB_PATH),
            loginPath: normalizeFrontendPath(config.loginPath, DEFAULT_LOGIN_PATH),
            apiBasePath: normalizeFrontendPath(config.apiBasePath, '/api/v1/ai-game'),
            assetBasePath: normalizeFrontendPath(config.assetBasePath, '/'),
        };
    }

    async function getBootstrap({ force = false } = {}) {
        if (!force && bootstrapCache) {
            return bootstrapCache;
        }

        const payload = await fetchPlatform('/api/v1/platform/bootstrap');
        bootstrapCache = payload;
        return payload;
    }

    async function getUser(options = {}) {
        const payload = await getBootstrap(options);
        return payload?.user || null;
    }

    async function getGames(options = {}) {
        const payload = await getBootstrap(options);
        return Array.isArray(payload?.games)
            ? payload.games
            : [];
    }

    async function getGameBySlug(slug, options = {}) {
        const normalizedSlug = typeof slug === 'string'
            ? slug.trim().toLowerCase()
            : '';
        const games = await getGames(options);
        return games.find((game) => game.slug === normalizedSlug) || null;
    }

    function login(redirectPath = DEFAULT_HUB_PATH) {
        if (typeof loginWithGoogle === 'function') {
            loginWithGoogle(normalizeFrontendPath(redirectPath, DEFAULT_HUB_PATH));
            return;
        }

        const loginUrl = new URL(`${resolveApiUrl()}/auth/google`, window.location.origin);
        loginUrl.searchParams.set('redirect', normalizeFrontendPath(redirectPath, DEFAULT_HUB_PATH));
        window.location.assign(loginUrl.toString());
    }

    async function requireAuth({ redirectPath = window.location.pathname } = {}) {
        const path = normalizeFrontendPath(redirectPath, DEFAULT_HUB_PATH);
        const loopKey = `platform_auth_redirect:${path}`;
        const lastRedirect = Number(sessionStorage.getItem(loopKey)) || 0;
        const now = Date.now();

        console.debug(`[Platform] requireAuth for ${path}. Last redirect: ${lastRedirect ? new Date(lastRedirect).toLocaleTimeString() : 'none'}`);

        try {
            const user = await getUser({ force: true });
            console.info(`[Platform] Session valid for user id: ${user?.id}`);
            sessionStorage.removeItem(loopKey);
            return user;
        } catch (error) {
            if (error?.status === 401) {
                console.warn('[Platform] Session invalid (401).');
                if (now - lastRedirect < 10000) {
                    console.error('[Platform] Infinite redirect loop detected for', path);
                    throw new Error('Authentication loop detected. Please clear cookies.');
                }
                console.info(`[Platform] Redirecting to login for path: ${path}`);
                sessionStorage.setItem(loopKey, String(now));
                login(path);
                return null;
            }

            console.error('[Platform] Unexpected error in requireAuth:', error);
            throw error;
        }
    }

    async function logout({ redirectPath = DEFAULT_LOGIN_PATH } = {}) {
        try {
            await fetch(`${resolveApiUrl()}/auth/logout`, {
                method: 'POST',
                credentials: 'include',
            });
        } catch (error) {
            console.error('Platform logout error:', error);
        }

        bootstrapCache = null;
        window.location.replace(normalizeFrontendPath(redirectPath, DEFAULT_LOGIN_PATH));
    }

    async function openGame(slug, { replace = false } = {}) {
        const game = await getGameBySlug(slug, { force: true });

        if (!game?.route) {
            throw new Error(`Game "${slug}" is not registered.`);
        }

        const targetRoute = attachApiOverrideToRoute(game.route);

        if (replace) {
            window.location.replace(targetRoute);
            return;
        }

        window.location.assign(targetRoute);
    }

    function backToHub({ replace = false } = {}) {
        const hubPath = attachApiOverrideToRoute(getGameContext().hubPath || DEFAULT_HUB_PATH);

        if (replace) {
            window.location.replace(hubPath);
            return;
        }

        window.location.assign(hubPath);
    }

    async function trackEvent({ event, gameSlug = null, details = '' }) {
        if (typeof event !== 'string' || !event.trim()) {
            return false;
        }

        try {
            await fetchPlatform('/api/v1/platform/events', {
                method: 'POST',
                body: {
                    event: event.trim(),
                    gameSlug: typeof gameSlug === 'string' && gameSlug.trim()
                        ? gameSlug.trim()
                        : undefined,
                    details: typeof details === 'string' ? details.trim() : '',
                },
            });
            return true;
        } catch (error) {
            if (error?.status !== 401) {
                console.warn('Platform event tracking failed:', error);
            }

            return false;
        }
    }

    window.Platform = Object.freeze({
        backToHub,
        getBootstrap,
        getGameBySlug,
        getGameContext,
        getGames,
        getHubPath: () => getGameContext().hubPath || DEFAULT_HUB_PATH,
        getLoginPath: () => getGameContext().loginPath || DEFAULT_LOGIN_PATH,
        getUser,
        login,
        logout,
        openGame,
        requireAuth,
        trackEvent,
    });
})();
