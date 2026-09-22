/**
 * Manages GObject signal connections to prevent leaks.
 * Every connect() must be paired with a disconnectAll() in disable().
 */
export class SignalManager {
    _connections = [];
    connect(source, signal, callback) {
        const id = source.connect(signal, callback);
        this._connections.push({ source, signalId: id });
        return id;
    }
    /**
     * Disconnect every connection registered against `source` and drop the
     * records. Needed for per-actor connections on objects that are destroyed
     * and rebuilt during a session (e.g. dock icons recreated on window
     * changes), otherwise the table would grow unbounded for the whole session.
     */
    disconnect(source) {
        for (let i = this._connections.length - 1; i >= 0; i--) {
            const conn = this._connections[i];
            if (conn.source !== source)
                continue;
            this._connections.splice(i, 1);
            try {
                conn.source.disconnect(conn.signalId);
            }
            catch (_e) {
                // Source already gone; nothing to disconnect.
            }
        }
    }
    disconnectAll() {
        for (const conn of this._connections) {
            try {
                conn.source.disconnect(conn.signalId);
            }
            catch (_e) {
                // Source already destroyed; skip it and keep cleaning the rest
                // so a single dead object cannot abort disable().
            }
        }
        this._connections = [];
    }
}
