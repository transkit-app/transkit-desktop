import { Button, Textarea } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import React from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { MdCheckCircle, MdHourglassEmpty } from 'react-icons/md';

import { useConfig } from '../../../hooks/useConfig';

const DEFAULT_SYSTEM_PROMPT =
    'You are a professional translation engine. Translate the given text accurately and naturally, preserving tone and meaning. Output only the translated text without any explanation or additional commentary.';

export function Config({ instanceKey, updateServiceList, onClose }) {
    const { t } = useTranslation();
    const [config, setConfig] = useConfig(
        instanceKey,
        { systemPrompt: DEFAULT_SYSTEM_PROMPT },
        { sync: false }
    );
    const [status, setStatus] = React.useState(null);

    React.useEffect(() => {
        invoke('local_sidecar_status').then(setStatus).catch(() => {});
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
                                : t('config.local_sidecar.setup.not_installed', { defaultValue: 'Local Model is not running. Enable it in Settings → Local Model.' })}
                        </span>
                    </div>
                )}

                <div className='flex flex-col gap-1'>
                    <h3 className='text-sm font-medium'>
                        {t('services.translate.local_sidecar.system_prompt', { defaultValue: 'System Prompt' })}
                    </h3>
                    <p className='text-xs text-default-400'>
                        {t('services.translate.local_sidecar.system_prompt_hint', { defaultValue: 'Customize the LLM system prompt for translation. Use $text and $to as placeholders.' })}
                    </p>
                    <Textarea
                        variant='bordered'
                        minRows={4}
                        value={config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT}
                        onValueChange={(v) => setConfig({ ...config, systemPrompt: v })}
                        classNames={{ input: 'text-xs font-mono' }}
                    />
                </div>

                <Button fullWidth color='primary' size='sm' onPress={handleSave}>
                    {t('common.save', { defaultValue: 'Save' })}
                </Button>
            </div>
        )
    );
}
