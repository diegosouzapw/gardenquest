function getApiUrl() {
    return typeof window.API_URL === 'string' ? window.API_URL : 'http://localhost:8080';
}

function loginWithGoogle(redirectPath = '') {
    const loginUrl = new URL(`${getApiUrl()}/auth/google`, window.location.origin);

    if (typeof redirectPath === 'string' && redirectPath.trim()) {
        loginUrl.searchParams.set('redirect', redirectPath.trim());
    }

    window.location.href = loginUrl.toString();
}

async function checkAuth() {
    try {
        const response = await fetch(`${getApiUrl()}/auth/me`, {
            credentials: 'include'
        });

        if (!response.ok) {
            return null;
        }

        return await response.json();
    } catch (err) {
        console.error('Auth check error:', err);
        return null;
    }
}

async function logout() {
    try {
        await fetch(`${getApiUrl()}/auth/logout`, {
            method: 'POST',
            credentials: 'include'
        });
    } catch (err) {
        console.error('Logout error:', err);
    }

    window.location.replace('/index.html');
}

function sanitize(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
