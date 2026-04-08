/**
 * TranskitCloudSTTClient
 *
 * A transparent proxy client for Transkit Cloud STT.
 *
 * On connect():
 *   1. Calls getCloudCredentials('stt', options) — backend validates JWT,
 *      checks quota, picks the active provider, generates short-lived credentials.
 *   2. Instantiates the matching inner client (DeepgramClient / SonioxClient / GladiaClient).
 *   3. Injects the received credentials and delegates all calls to the inner client.
 *   4. Fires onCloudSession({ session_id, remaining_seconds, debited_seconds }) so
 *      Monitor can set up the quota countdown and report usage when the session ends.
 *
 * The inner client is a drop-in replacement: all existing callback contracts
 * (onOriginal, onTranslation, onProvisional, onStatusChange, onError, onReconnect)
 * are forwarded unchanged.
 *
 * Master API keys are never present on the client — only short-lived session
 * credentials returned by the backend are used.
 */

import { DeepgramClient } from '../deepgram_stt/client';
import { SonioxClient } from '../soniox_stt/client';
import { GladiaClient } from '../gladia_stt/client';
import { getCloudCredentials, getUser, CLOUD_ENABLED } from '../../../lib/transkit-cloud';

export class TranskitCloudSTTClient {
    constructor() {
        this._innerClient = null;
        this._config = null;
        this._sessionId = null;
        this._debitedSeconds = 0;
        this._startTime = null;
        this._intentionalDisconnect = false;
        this._connectController = null; // AbortController for in-flight credential request

        // Standard provider callbacks — same interface as all other STT clients
        this.onOriginal = null;      // (text, speaker) => {}
        this.onTranslation = null;   // (text) => {}
        this.onProvisional = null;   // (text) => {}
        this.onStatusChange = null;  // (status) => {}
        this.onError = null;         // (message) => {}
        this.onReconnect = null;     // () => {}

        // Cloud-specific callbacks
        // Fired while waiting for backend credentials (true = loading, false = done).
        // Monitor uses this to show a "Requesting credentials…" indicator.
        this.onCredentialRequest = null; // (loading: boolean) => {}

        // Fired once credentials are ready — Monitor registers the session for countdown + reporting.
        // Signature: ({ session_id, remaining_seconds, debited_seconds }) => {}
        this.onCloudSession = null;
    }

    /**
     * Start a cloud STT session.
     * config is the standard transcription config from Monitor (sourceLanguage,
     * targetLanguage, customContext, etc.) — credentials are fetched from the backend.
     */
    connect(config) {
        if (!CLOUD_ENABLED) {
            this._setStatus('error');
            this.onError?.('Transkit Cloud is not available in this build.');
            return;
        }

        // Abort any in-flight credential request from a previous connect() call.
        // This prevents duplicate sessions when connect() is called twice before
        // the first getCloudCredentials() round-trip completes.
        if (this._connectController) {
            this._connectController.abort();
        }
        this._connectController = new AbortController();

        this._config = config;
        this._intentionalDisconnect = false;
        this._sessionId = null;
        this._startTime = null;
        this._doConnect(config, this._connectController.signal);
    }

    async _doConnect(config, signal) {
        try {
            await this._doConnectInner(config, signal);
        } catch (err) {
            // Ignore aborts — they happen when a newer connect() call supersedes this one.
            if (err?.name === 'AbortError') return;
            // Safety net: catch any unexpected throw so it never becomes an
            // unhandled promise rejection (e.g. Supabase auth lock conflicts).
            this.onCredentialRequest?.(false);
            if (this._intentionalDisconnect) return;
            this._setStatus('error');
            const msg = err?.message ?? '';
            if (msg.includes('Lock') && msg.includes('auth-token')) {
                this.onError?.('', { code: 'auth_lock_conflict' });
            } else {
                console.error('[transkit-cloud] unexpected error in _doConnect:', err);
                this.onError?.('Connection failed unexpectedly. Please try again.');
            }
        }
    }

    async _doConnectInner(config, signal) {
        this._setStatus('connecting');

        // Verify the user is logged in before hitting the network
        const user = await getUser();
        if (!user) {
            this._setStatus('error');
            this.onError?.('Sign in to your Transkit account to use Transkit Cloud, or add your own provider API key in Settings.');
            return;
        }

        // Bail out if a newer connect() was called while we awaited getUser().
        if (signal?.aborted) return;

        // Build session options for providers that need them at creation time (Gladia)
        const options = {
            sourceLanguage: config.sourceLanguage ?? null,
            targetLanguage: config.targetLanguage ?? null,
            context: config.customContext ?? {},
            endpointing: config.endpointing,
            speechThreshold: config.speechThreshold,
        };

        this.onCredentialRequest?.(true);
        let result;
        try {
            result = await getCloudCredentials('stt', options, signal);
        } catch (err) {
            this.onCredentialRequest?.(false);
            // Abort means a newer connect() superseded us — not an error.
            if (err?.name === 'AbortError') return;
            if (this._intentionalDisconnect) return;
            this._setStatus('error');
            this._handleCredentialError(err);
            return;
        }
        this.onCredentialRequest?.(false);

        if (this._intentionalDisconnect) return;

        this._sessionId = result.session_id;
        this._debitedSeconds = result.debited_seconds;

        // Notify Monitor so it can set up countdown and store session for reporting
        this.onCloudSession?.({
            session_id: result.session_id,
            remaining_seconds: result.remaining_seconds,
            debited_seconds: result.debited_seconds,
        });

        // Build the inner client matching the resolved provider
        let innerClient;
        let connectConfig;

        switch (result.provider) {
            case 'deepgram':
                innerClient = new DeepgramClient();
                // Cloud config stores endpointing in seconds; DeepgramClient expects ms
                connectConfig = {
                    ...config,
                    token: result.credentials.token,
                    apiKey: '',
                    endpointing: Math.round((config.endpointing ?? 0.3) * 1000),
                };
                break;

            case 'soniox':
                innerClient = new SonioxClient();
                connectConfig = { ...config, apiKey: result.credentials.api_key };
                break;

            case 'gladia':
                innerClient = new GladiaClient();
                // Gladia: pass the pre-created WSS URL; client skips HTTP init
                connectConfig = { ...config, _preCreatedUrl: result.credentials.url, apiKey: '' };
                break;

            default:
                this._setStatus('error');
                this.onError?.(`Unsupported provider received from cloud: ${result.provider}`);
                return;
        }

        // Forward all callbacks
        innerClient.onOriginal = (...args) => this.onOriginal?.(...args);
        innerClient.onTranslation = (...args) => this.onTranslation?.(...args);
        innerClient.onProvisional = (...args) => this.onProvisional?.(...args);
        innerClient.onStatusChange = (...args) => {
            if (args[0] === 'connected') this._startTime = Date.now();
            this.onStatusChange?.(...args);
        };
        innerClient.onError = (...args) => this.onError?.(...args);
        innerClient.onReconnect = (...args) => this.onReconnect?.(...args);

        this._innerClient = innerClient;
        innerClient.connect(connectConfig);
    }

    sendAudio(pcm) {
        this._innerClient?.sendAudio(pcm);
    }

    finalize() {
        this._innerClient?.finalize?.();
    }

    disconnect() {
        this._intentionalDisconnect = true;
        this._innerClient?.disconnect();
        this._innerClient = null;
        this._setStatus('disconnected');
    }

    // ─── Accessors used by Monitor for usage reporting ────────────────────────

    /** Session ID to pass to reportUsage() when stopping */
    get cloudSessionId() { return this._sessionId; }

    /** Pre-debited seconds — used to cap reported duration */
    get debitedSeconds() { return this._debitedSeconds; }

    /** Timestamp (ms) when the WebSocket actually connected — null until then */
    get startTime() { return this._startTime; }

    // ─── Internals ────────────────────────────────────────────────────────────

    _setStatus(status) {
        this.onStatusChange?.(status);
    }

    _handleCredentialError(err) {
        const msg = err?.message ?? 'server_error';

        // Supabase auth lock conflict — multiple concurrent requests raced to
        // refresh the token. Surface as a structured error so UI can show a
        // user-friendly message instead of hanging or showing a raw error code.
        if (msg.includes('Lock') && msg.includes('auth-token')) {
            this.onError?.('', { code: 'auth_lock_conflict' });
            return;
        }

        const code = msg;
        switch (code) {
            case 'quota_exceeded': {
                const used = err.used != null ? Math.ceil(err.used / 60) : null;
                const limit = err.limit != null ? Math.ceil(err.limit / 60) : null;
                this.onError?.('quota_exceeded', { code: 'quota_exceeded', used, limit });
                break;
            }
            case 'service_not_configured':
                this.onError?.('Transkit Cloud STT is not configured yet. Please contact support.');
                break;
            case 'cloud_disabled':
                this.onError?.('Transkit Cloud is not available in this build.');
                break;
            case 'auth_lock_conflict':
                this.onError?.('', { code: 'auth_lock_conflict' });
                break;
            default:
                this.onError?.(`Could not start cloud session: ${code}`);
        }
    }
}
