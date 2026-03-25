const LOCAL_API_URL_STORAGE_KEY = 'gardenquest.localApiUrl';
const SHARED_API_URL_STORAGE_KEY = 'img_platform_api_url';

function normalizeApiUrl(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return '';
    }

    try {
        const parsed = new URL(value.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return '';
        }

        return parsed.origin;
    } catch (error) {
        return '';
    }
}

function isLocalHostname(hostname) {
    const normalizedHostname = String(hostname || '')
        .trim()
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .toLowerCase();

    return (
        normalizedHostname === 'localhost' ||
        normalizedHostname === '127.0.0.1' ||
        normalizedHostname === '::1' ||
        normalizedHostname === '::' ||
        !normalizedHostname
    );
}

function resolveLocalApiUrlOverride() {
    const searchParams = new URLSearchParams(window.location.search);
    const queryOverride =
        normalizeApiUrl(searchParams.get('api')) ||
        normalizeApiUrl(searchParams.get('apiUrl')) ||
        normalizeApiUrl(searchParams.get('api_url'));

    if (queryOverride) {
        try {
            window.localStorage.setItem(LOCAL_API_URL_STORAGE_KEY, queryOverride);
            window.localStorage.setItem(SHARED_API_URL_STORAGE_KEY, queryOverride);
        } catch (error) {
            // Ignore storage failures and still use the explicit query override.
        }
        return queryOverride;
    }

    let storedLocalOverride = '';
    let storedSharedOverride = '';

    try {
        storedLocalOverride = normalizeApiUrl(window.localStorage.getItem(LOCAL_API_URL_STORAGE_KEY));
        storedSharedOverride = normalizeApiUrl(window.localStorage.getItem(SHARED_API_URL_STORAGE_KEY));
    } catch (error) {
        storedLocalOverride = '';
        storedSharedOverride = '';
    }

    return storedLocalOverride || storedSharedOverride;
}

window.API_URL =
    isLocalHostname(window.location.hostname)
        ? resolveLocalApiUrlOverride() || window.location.origin
        : '';

console.info(`[GardenQuest-Config] API URL resolved to: ${window.API_URL || '(relative)'}`);
