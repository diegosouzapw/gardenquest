(function resolvePlatformApiUrl() {
    const API_STORAGE_KEY = 'img_platform_api_url';

    function normalizeApiUrl(value) {
        if (typeof value !== 'string') {
            return '';
        }

        const trimmed = value.trim();
        if (!trimmed) {
            return '';
        }

        try {
            const parsed = new URL(trimmed);
            return parsed.origin;
        } catch (_error) {
            return '';
        }
    }

    const params = new URLSearchParams(window.location.search || '');
    const queryApiUrl = normalizeApiUrl(params.get('api'));
    const explicitApiUrl = normalizeApiUrl(window.API_URL);

    let storedApiUrl = '';
    try {
        storedApiUrl = normalizeApiUrl(window.localStorage.getItem(API_STORAGE_KEY));
    } catch (_error) {
        storedApiUrl = '';
    }

    if (queryApiUrl) {
        try {
            window.localStorage.setItem(API_STORAGE_KEY, queryApiUrl);
        } catch (_error) {
            // ignore storage failures in privacy mode
        }
    }

    const localhostDefault = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://localhost:8080'
        : '';

    window.API_URL = explicitApiUrl || queryApiUrl || storedApiUrl || localhostDefault;
    console.info(`[Platform-Config] API URL resolved to: ${window.API_URL || '(relative)'}`);
})();
