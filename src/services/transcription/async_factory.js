import { fetch as tauriFetch, Body, ResponseType } from '@tauri-apps/api/http';
import i18n from '../../i18n';

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com';
const DEEPGRAM_DEFAULT_BASE_URL = 'https://api.deepgram.com';
const ASSEMBLYAI_BASE_URL = 'https://api.assemblyai.com';

function buildWav(pcmChunks) {
    const totalLength = pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const sampleRate = 16000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const headerSize = 44;
    const wav = new Uint8Array(headerSize + totalLength);
    const view = new DataView(wav.buffer);

    wav.set([0x52, 0x49, 0x46, 0x46], 0);
    view.setUint32(4, 36 + totalLength, true);
    wav.set([0x57, 0x41, 0x56, 0x45], 8);
    wav.set([0x66, 0x6D, 0x74, 0x20], 12);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    wav.set([0x64, 0x61, 0x74, 0x61], 36);
    view.setUint32(40, totalLength, true);

    let offset = headerSize;
    for (const chunk of pcmChunks) {
        wav.set(chunk, offset);
        offset += chunk.length;
    }

    return wav;
}

function blobFromWav(pcmChunks) {
    return new Blob([buildWav(pcmChunks)], { type: 'audio/wav' });
}

function getAsyncStrategy(serviceName) {
    switch (serviceName) {
        case 'openai_whisper_stt':
            return {
                label: 'OpenAI Whisper async',
                transcribe: transcribeWithOpenAIWhisper,
            };
        case 'deepgram_stt':
            return {
                label: 'Deepgram prerecorded',
                transcribe: transcribeWithDeepgram,
            };
        case 'assemblyai_stt':
            return {
                label: 'AssemblyAI batch',
                transcribe: transcribeWithAssemblyAI,
            };
        default:
            return null;
    }
}

async function parseJsonResponse(response) {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(text);
    }
}

async function transcribeWithOpenAIWhisper(config, pcmChunks, signal) {
    const { apiKey, serverUrl, model } = config;
    if (!apiKey && !serverUrl) {
        throw new Error('API key is required. Please add it in Settings.');
    }

    const baseUrl = (serverUrl ?? OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, '');
    const form = new FormData();
    form.append('file', new File([blobFromWav(pcmChunks)], 'voice-anywhere.wav', { type: 'audio/wav' }));
    form.append('model', model ?? 'whisper-1');

    const response = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        body: form,
        signal,
    });

    const data = await parseJsonResponse(response);
    if (!response.ok) {
        throw new Error(data?.error?.message ?? `Whisper API error: ${response.status}`);
    }

    return data?.text?.trim() ?? '';
}

async function transcribeWithDeepgram(config, pcmChunks, signal) {
    const { apiKey, token, sourceLanguage, model = 'nova-3', smartFormat = true } = config;
    if (!apiKey && !token) {
        throw new Error('Deepgram API key is required. Please add it in Settings.');
    }

    const wavBytes = buildWav(pcmChunks);
    console.info('[VoiceAnywhere][DeepgramAsync] sending prerecorded request', {
        bytes: wavBytes.byteLength,
        model,
        sourceLanguage: sourceLanguage ?? 'auto',
    });
    if (signal?.aborted) {
        const abortError = new Error('Request aborted');
        abortError.name = 'AbortError';
        throw abortError;
    }
    const query = new URLSearchParams({
        model,
        punctuate: 'true',
        smart_format: smartFormat ? 'true' : 'false',
    });
    if (sourceLanguage) {
        query.set('language', sourceLanguage);
    } else {
        query.set('detect_language', 'true');
    }

    const response = await tauriFetch(`${DEEPGRAM_DEFAULT_BASE_URL}/v1/listen?${query.toString()}`, {
        method: 'POST',
        headers: {
            Authorization: `Token ${apiKey ?? token}`,
            'Content-Type': 'audio/wav',
        },
        body: Body.bytes(Array.from(wavBytes)),
        responseType: ResponseType.Text,
        timeout: 60,
    });

    const bodyText = typeof response.data === 'string' ? response.data : '';
    console.info('[VoiceAnywhere][DeepgramAsync] response', {
        status: response.status,
        bodyPreview: bodyText.slice(0, 300),
    });

    let data = {};
    if (bodyText) {
        try {
            data = JSON.parse(bodyText);
        } catch {
            throw new Error(`Deepgram returned a non-JSON response (${response.status}).`);
        }
    }

    if (!response.ok) {
        throw new Error(
            data?.err_msg ??
                data?.error ??
                data?.message ??
                `Deepgram API error (${response.status}).`
        );
    }

    const channels = Array.isArray(data?.results?.channels) ? data.results.channels : [];
    const alternatives = Array.isArray(channels?.[0]?.alternatives) ? channels[0].alternatives : [];
    const transcript = alternatives?.[0]?.transcript?.trim?.() ?? '';
    console.info('[VoiceAnywhere][DeepgramAsync] parsed response', {
        requestId: data?.metadata?.request_id ?? null,
        duration: data?.metadata?.duration ?? null,
        channelCount: channels.length,
        alternativeCount: alternatives.length,
        transcriptLength: transcript.length,
        transcriptPreview: transcript.slice(0, 120),
    });
    if (!transcript) {
        throw new Error(data?.metadata?.request_id
            ? i18n.t('voice_anywhere.errors.no_speech_detected_with_request_id', {
                requestId: data.metadata.request_id,
            })
            : i18n.t('voice_anywhere.errors.no_speech_detected')
        );
    }

    console.info('[VoiceAnywhere][DeepgramAsync] response metadata', data?.metadata ?? {});
    return transcript;
}

async function transcribeWithAssemblyAI(config, pcmChunks, signal) {
    const { apiKey, sourceLanguage } = config;
    if (!apiKey) {
        throw new Error('API key is required. Please add it in Settings.');
    }

    const uploadResponse = await fetch(`${ASSEMBLYAI_BASE_URL}/v2/upload`, {
        method: 'POST',
        headers: {
            Authorization: apiKey,
            'Content-Type': 'application/octet-stream',
        },
        body: blobFromWav(pcmChunks),
        signal,
    });

    const uploadData = await parseJsonResponse(uploadResponse);
    if (!uploadResponse.ok || !uploadData?.upload_url) {
        throw new Error(uploadData?.error ?? `AssemblyAI upload failed (${uploadResponse.status})`);
    }

    const transcriptBody = {
        audio_url: uploadData.upload_url,
        speech_model: 'universal',
    };
    if (sourceLanguage) {
        transcriptBody.language_code = sourceLanguage;
    }

    const transcriptResponse = await fetch(`${ASSEMBLYAI_BASE_URL}/v2/transcript`, {
        method: 'POST',
        headers: {
            Authorization: apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(transcriptBody),
        signal,
    });

    const transcriptData = await parseJsonResponse(transcriptResponse);
    if (!transcriptResponse.ok || !transcriptData?.id) {
        throw new Error(transcriptData?.error ?? `AssemblyAI transcript start failed (${transcriptResponse.status})`);
    }

    const pollSignal = signal;
    while (!pollSignal?.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const statusResponse = await fetch(`${ASSEMBLYAI_BASE_URL}/v2/transcript/${transcriptData.id}`, {
            headers: { Authorization: apiKey },
            signal: pollSignal,
        });
        const statusData = await parseJsonResponse(statusResponse);

        if (!statusResponse.ok) {
            throw new Error(statusData?.error ?? `AssemblyAI poll failed (${statusResponse.status})`);
        }
        if (statusData?.status === 'completed') {
            return statusData?.text?.trim() ?? '';
        }
        if (statusData?.status === 'error') {
            throw new Error(statusData?.error ?? 'AssemblyAI transcription failed.');
        }
    }

    return '';
}

class AsyncTranscriptionClient {
    constructor(serviceName, strategy) {
        this.serviceName = serviceName;
        this.strategy = strategy;
        this._config = null;
        this._audioChunks = [];
        this._abortController = null;
        this._intentionalDisconnect = false;
        this.isConnected = false;

        this.onOriginal = null;
        this.onTranslation = null;
        this.onProvisional = null;
        this.onStatusChange = null;
        this.onError = null;
        this.onReconnect = null;
    }

    connect(config) {
        this._config = config;
        this._audioChunks = [];
        this._intentionalDisconnect = false;
        this.isConnected = true;
        this._setStatus('connected');
    }

    sendAudio(pcmData) {
        if (!this.isConnected || this._intentionalDisconnect) return;
        this._audioChunks.push(new Uint8Array(pcmData));
    }

    async finalize() {
        if (!this.isConnected || this._intentionalDisconnect) return;
        if (this._audioChunks.length === 0) {
            this.onProvisional?.('');
            this._setStatus('disconnected');
            this.isConnected = false;
            return;
        }

        this._abortController?.abort();
        this._abortController = new AbortController();
        this._setStatus('processing');

        try {
            const text = await this.strategy.transcribe(this._config, this._audioChunks, this._abortController.signal);
            if (this._intentionalDisconnect) return;
            this.onProvisional?.('');
            if (text) {
                this.onOriginal?.(text, null);
                this.onTranslation?.(text);
            }
            this._setStatus('disconnected');
            this.isConnected = false;
        } catch (err) {
            if (this._intentionalDisconnect || err?.name === 'AbortError') return;
            this._setStatus('error');
            this.onProvisional?.('');
            this.onError?.(err?.message ?? `Async transcription failed for ${this.strategy.label}.`);
        }
    }

    disconnect() {
        this._intentionalDisconnect = true;
        this._abortController?.abort();
        this._abortController = null;
        this._audioChunks = [];
        this.isConnected = false;
        this._setStatus('disconnected');
    }

    _setStatus(status) {
        this.onStatusChange?.(status);
    }
}

export function supportsAsyncTranscription(serviceName) {
    return !!getAsyncStrategy(serviceName);
}

export function createAsyncTranscriptionClient(serviceName) {
    const strategy = getAsyncStrategy(serviceName);
    if (!strategy) return null;
    return new AsyncTranscriptionClient(serviceName, strategy);
}
