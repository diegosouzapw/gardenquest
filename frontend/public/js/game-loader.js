import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

window.THREE = THREE;

const gameScriptSources = [
    'js/player.js?v=21',
    'js/world.js?v=30',
    'js/actions.js?v=18',
    'js/game.js?v=46',
];

for (const src of gameScriptSources) {
    await loadClassicScript(src);
}

function loadClassicScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = false;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.body.appendChild(script);
    });
}
