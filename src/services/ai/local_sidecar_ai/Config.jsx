import { Button } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import React from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { MdCheckCircle, MdHourglassEmpty } from 'react-icons/md';

export function Config({ instanceKey, updateServiceList, onClose }) {
    const { t } = useTranslation();
    const [status, setStatus] = React.useState(null);

    React.useEffect(() => {
        invoke('local_sidecar_status').then(setStatus).catch(() => {});
    }, []);

    return (
        <div className='flex flex-col gap-3 p-1'>
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
            <p className='text-xs text-default-400'>
                {t('services.ai.local_sidecar_ai.hint', { defaultValue: 'Uses the Local Model LLM for AI analysis. Configure the model in Settings → Local Model.' })}
            </p>
            <Button
                fullWidth
                color='primary'
                onPress={() => {
                    updateServiceList(instanceKey);
                    onClose();
                }}
            >
                {t('common.save')}
            </Button>
        </div>
    );
}
