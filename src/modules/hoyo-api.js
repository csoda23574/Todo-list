/** HoYoLAB 연결 구현체(Electron IPC / Android Capacitor)를 같은 형태로 제공합니다. */

function getAndroidHoyoPlugin() {
    return window.Capacitor?.isNativePlatform?.()
        ? window.Capacitor?.Plugins?.HoyoLab
        : null;
}

export function getHoyoAPI() {
    if (window.electronAPI) {
        return {
            kind: 'electron',
            getHoyoConnections: () => window.electronAPI.getHoyoConnections(),
            getHoyoCredentialStorageStatus: () => window.electronAPI.getHoyoCredentialStorageStatus?.(),
            beginHoyoAuthentication: (game, rememberLogin) =>
                window.electronAPI.beginHoyoAuthentication(game, rememberLogin),
            completeHoyoConnection: connectionId => window.electronAPI.completeHoyoConnection(connectionId),
            closeHoyoAuthentication: connectionId => window.electronAPI.closeHoyoAuthentication(connectionId),
            getHoyoAuthState: connectionId => window.electronAPI.getHoyoAuthState(connectionId),
            checkHoyoStatus: connectionId => window.electronAPI.checkHoyoStatus(connectionId),
            onHoyoAuthState: callback => window.electronAPI.onHoyoAuthState(callback),
        };
    }

    const plugin = getAndroidHoyoPlugin();
    if (!plugin) return null;
    return {
        kind: 'android',
        getHoyoConnections: async () => (await plugin.getHoyoConnections()).connections || [],
        getHoyoCredentialStorageStatus: () => plugin.getHoyoCredentialStorageStatus(),
        beginHoyoAuthentication: (game, rememberLogin) =>
            plugin.beginHoyoAuthentication({ game, rememberLogin }),
        completeHoyoConnection: connectionId => plugin.completeHoyoConnection({ connectionId }),
        closeHoyoAuthentication: connectionId => plugin.closeHoyoAuthentication({ connectionId }),
        getHoyoAuthState: connectionId => plugin.getHoyoAuthState({ connectionId }),
        checkHoyoStatus: connectionId => plugin.checkHoyoStatus({ connectionId }),
        onHoyoAuthState: callback => plugin.addListener('hoyoAuthState', callback),
    };
}
