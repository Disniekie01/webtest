/*
 * Official Isaac 6 local WebRTC viewer — NVIDIA sample defaults.
 * One Chromium client only. Host/ports from /stream-config.json (49100/47998).
 */
import './index.css';
import {
    AppStreamer,
    DirectConfig,
    StreamEvent,
    StreamType,
    EventAction,
    EventStatus,
} from '@nvidia/ov-web-rtc';
import ReactDOM from 'react-dom/client';
import OVAppStreamer from './react-component/OVAppStreamer';
import type { ViewProps } from './react-component/OVAppStreamConfig';

interface AppState {
    streamReady: boolean;
    streamFailed: boolean;
    errorMessage: string;
}

class StreamingApp {
    private reactRoot: ReturnType<typeof ReactDOM.createRoot> | null = null;
    private state: AppState = {
        streamReady: false,
        streamFailed: false,
        errorMessage: 'FAILED TO CONNECT TO STREAM',
    };

    private updateUI() {
        const reactStreamRoot = document.getElementById('react-stream-root');
        const loadingStreamMessage = document.getElementById('loading-stream-message');
        const errorMessage = document.getElementById('error-message');
        if (!reactStreamRoot || !loadingStreamMessage || !errorMessage) return;
        const setDisplay = (el: HTMLElement | null, val: string) => {
            if (el) el.style.display = val;
        };
        setDisplay(reactStreamRoot, 'block');
        reactStreamRoot.style.width = '100%';
        reactStreamRoot.style.height = '100%';
        if (this.state.streamFailed) {
            setDisplay(loadingStreamMessage, 'none');
            setDisplay(errorMessage, 'flex');
            const errorText = document.getElementById('error-message-text');
            if (errorText) errorText.textContent = this.state.errorMessage;
        } else if (this.state.streamReady) {
            setDisplay(loadingStreamMessage, 'none');
            setDisplay(errorMessage, 'none');
        } else {
            setDisplay(loadingStreamMessage, 'flex');
            setDisplay(errorMessage, 'none');
        }
    }

    public async initialize() {
        const cfg = await this.resolveConfig();
        console.log('WebRTC config', cfg);
        this.renderReactStreamView(cfg);
        this.updateUI();
    }

    private async resolveConfig(): Promise<{ host: string; signalingPort: number; mediaPort: number }> {
        try {
            const res = await fetch('/stream-config.json', { cache: 'no-store' });
            if (res.ok) {
                const j = await res.json();
                if (j?.host) {
                    return {
                        host: String(j.host),
                        signalingPort: Number(j.signalingPort) || 49100,
                        mediaPort: Number(j.mediaPort) || 47998,
                    };
                }
            }
        } catch {
            /* fall through */
        }
        return { host: '127.0.0.1', signalingPort: 49100, mediaPort: 47998 };
    }

    private renderReactStreamView(cfg: { host: string; signalingPort: number; mediaPort: number }) {
        const host = document.getElementById('react-stream-root');
        if (!host) return;
        if (!this.reactRoot) this.reactRoot = ReactDOM.createRoot(host);

        // Match NVIDIA sample + Isaac Livestream Clients defaults
        const streamConfig: DirectConfig = {
            videoElementId: 'remote-video',
            audioElementId: 'remote-audio',
            server: cfg.host,
            signalingServer: cfg.host,
            signalingPort: cfg.signalingPort,
            mediaServer: cfg.host,
            mediaPort: cfg.mediaPort,
            forceWSS: false,
            width: 1920,
            height: 1080,
            fps: 60,
            fitStreamResolution: true,
            authenticate: false,
            maxReconnects: 5,
            reconnectDelay: 3000,
            onStart: (message: StreamEvent) => {
                console.log('Stream start:', message);
                if (message.action === EventAction.START) {
                    if (message.status === EventStatus.SUCCESS) {
                        this.state.streamReady = true;
                        this.state.streamFailed = false;
                        this.updateUI();
                        try {
                            if (window.parent && window.parent !== window) {
                                window.parent.postMessage(
                                    { type: 'citylab-stream-ready', label: 'Live', percent: 100 },
                                    '*',
                                );
                            }
                        } catch {
                            /* ignore */
                        }
                    } else if (message.status === EventStatus.ERROR) {
                        this.state.streamFailed = true;
                        this.state.errorMessage = `${message.info || 'Unknown error'}`;
                        this.updateUI();
                    }
                }
            },
            onUpdate: (message: StreamEvent) => {
                console.log('Stream update:', message.status, message.info);
            },
            onStop: (message: StreamEvent) => {
                console.log('Stream stopped:', message);
                this.state.streamReady = false;
                this.state.streamFailed = false;
                this.updateUI();
            },
        };

        const viewProps: ViewProps = {
            stream: {
                streamSource: StreamType.DIRECT,
                streamConfig,
            },
        };
        this.reactRoot.render(<OVAppStreamer {...viewProps} />);
    }
}

const app = new StreamingApp();

function releaseStreamSlot() {
    try {
        const bc = new BroadcastChannel('citylab-stream-slot');
        bc.postMessage({ type: 'release' });
        setTimeout(() => bc.close(), 500);
    } catch {
        /* ignore */
    }
    try {
        void AppStreamer.terminate(false);
    } catch {
        /* ignore */
    }
}

if (new URLSearchParams(window.location.search).get('release') === '1') {
    releaseStreamSlot();
    const loading = document.getElementById('loading-stream-message');
    if (loading) {
        loading.style.display = 'flex';
        loading.textContent = 'Stream slot released — close extra tabs';
    }
} else {
    void app.initialize();
}
