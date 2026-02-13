/**
 * WebSocket client with automatic reconnection and message dispatch.
 */

export class WSClient {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.handlers = {};
        this.reconnectDelay = 1000;
        this.maxReconnectDelay = 30000;
        this.onStatusChange = null;
        this._shouldReconnect = true;
    }

    connect() {
        this._shouldReconnect = true;
        this._doConnect();
    }

    _doConnect() {
        try {
            this.ws = new WebSocket(this.url);
        } catch (e) {
            this._scheduleReconnect();
            return;
        }

        this.ws.onopen = () => {
            this.reconnectDelay = 1000;
            if (this.onStatusChange) this.onStatusChange('connected');
        };

        this.ws.onclose = () => {
            if (this.onStatusChange) this.onStatusChange('disconnected');
            if (this._shouldReconnect) this._scheduleReconnect();
        };

        this.ws.onerror = () => {
            this.ws.close();
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                const type = msg.type;
                const payload = msg.payload;
                if (this.handlers[type]) {
                    for (const cb of this.handlers[type]) {
                        cb(payload);
                    }
                }
            } catch (e) {
                console.error('WS message parse error:', e);
            }
        };
    }

    _scheduleReconnect() {
        setTimeout(() => {
            if (this._shouldReconnect) {
                this._doConnect();
                this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
            }
        }, this.reconnectDelay);
    }

    disconnect() {
        this._shouldReconnect = false;
        if (this.ws) this.ws.close();
    }

    send(type, payload = {}) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type, payload }));
        }
    }

    on(type, callback) {
        if (!this.handlers[type]) this.handlers[type] = [];
        this.handlers[type].push(callback);
    }

    off(type, callback) {
        if (this.handlers[type]) {
            this.handlers[type] = this.handlers[type].filter(cb => cb !== callback);
        }
    }

    get connected() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }
}
