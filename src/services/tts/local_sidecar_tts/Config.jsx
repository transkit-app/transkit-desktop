import { Select, SelectItem, Slider, Button } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/tauri';
import React, { useState, useEffect } from 'react';
import { MdCheckCircle, MdHourglassEmpty } from 'react-icons/md';

import { useConfig } from '../../../hooks/useConfig';

const DEFAULT_VOICES = [
    'af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky',
    'am_adam', 'am_michael', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis',
];

export function Config(props) {
    const { instanceKey, updateServiceList, onClose } = props;
    const { t } = useTranslation();

    const [config, setConfig] = useConfig(
        instanceKey,
        { voice: 'af_heart', speed: 1.0 },
        { sync: false }
    );

    const [status, setStatus] = useState(null);
    const [voices, setVoices] = useState(DEFAULT_VOICES);

    useEffect(() => {
        invoke('local_sidecar_status').then(s => {
            setStatus(s);
            if (s?.running && s?.port) {
                fetch(`http://127.0.0.1:${s.port}/v1/tts/voices`)
                    .then(r => r.json())
                    .then(d => { if (d?.voices?.length) setVoices(d.voices); })
                    .catch(() => {});
            }
        }).catch(() => {});
    }, []);

    const handleSave = () => {
        setConfig(config, true);
        updateServiceList(instanceKey);
        onClose();
    };

    return (
        config !== null && (
            <div className='flex flex-col gap-4'>
                {status && (
                    <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                        status.running
                            ? 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400'
                            : 'bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-400'
                    }`}>
                        {status.running
                            ? <MdCheckCircle className='text-lg flex-shrink-0' />
                            : <MdHourglassEmpty className='text-lg flex-shrink-0' />}
                        <span>
                            {status.running
                                ? t('config.local_sidecar.startup.status_running', { defaultValue: `Running on port ${status.port}` })
                                : t('config.local_sidecar.setup.not_installed', { defaultValue: 'Local Model not running. Enable in Settings → Local Model.' })}
                        </span>
                    </div>
                )}

                <div className='config-item'>
                    <h3 className='my-auto text-sm'>
                        {t('config.local_sidecar.tts.voice', { defaultValue: 'Voice' })}
                    </h3>
                    <Select
                        variant='bordered'
                        selectedKeys={[config.voice ?? 'af_heart']}
                        className='max-w-[60%]'
                        onSelectionChange={keys => {
                            const v = Array.from(keys)[0];
                            if (v) setConfig({ ...config, voice: v });
                        }}
                    >
                        {voices.map(v => <SelectItem key={v}>{v}</SelectItem>)}
                    </Select>
                </div>

                <div className='config-item'>
                    <h3 className='my-auto text-sm'>
                        {t('config.local_sidecar.tts.speed', { defaultValue: 'Speed' })}
                    </h3>
                    <Slider
                        minValue={0.5}
                        maxValue={2.0}
                        step={0.1}
                        value={config.speed ?? 1.0}
                        onChange={v => setConfig({ ...config, speed: v })}
                        className='max-w-[50%]'
                        aria-label='Speed'
                    />
                    <span className='text-sm text-default-500 w-8 text-right'>{(config.speed ?? 1.0).toFixed(1)}×</span>
                </div>

                <Button fullWidth color='primary' size='sm' onPress={handleSave}>
                    {t('common.save', { defaultValue: 'Save' })}
                </Button>
            </div>
        )
    );
}
