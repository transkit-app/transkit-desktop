import React from 'react';
import { Button, Input } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import { MdSettings } from 'react-icons/md';

import { INSTANCE_NAME_CONFIG_KEY } from '../../../utils/service_instance';
import { useConfig } from '../../../hooks/useConfig';

export function Config(props) {
    const { instanceKey, updateServiceList, onClose } = props;
    const { t } = useTranslation();

    const [config, setConfig] = useConfig(
        instanceKey,
        {
            [INSTANCE_NAME_CONFIG_KEY]: t('services.transcription.onnx_stt.title', { defaultValue: 'Offline STT (ONNX)' }),
        },
        { sync: false }
    );

    // Active model is global — managed in Local Models settings (source of truth)
    const [activeModel] = useConfig('onnx_active_model', '');

    const handleSave = () => {
        setConfig(config, true);
        updateServiceList(instanceKey);
        onClose();
    };

    if (config === null) return null;

    return (
        <div className='flex flex-col gap-4'>

            {/* Instance name */}
            <div className='config-item flex-col items-stretch'>
                <Input
                    label={t('services.instance_name')}
                    labelPlacement='outside'
                    value={config[INSTANCE_NAME_CONFIG_KEY] ?? ''}
                    variant='bordered'
                    classNames={{ label: 'text-xs text-default-500 pb-1' }}
                    onValueChange={v => setConfig({ ...config, [INSTANCE_NAME_CONFIG_KEY]: v })}
                />
            </div>

            {/* Active model — read-only, managed in Local Models settings */}
            <div className='config-item flex-col items-start gap-1'>
                <Input
                    label={t('config.onnx_stt.model.active_readonly', { defaultValue: 'Active model (managed in Local Models settings)' })}
                    labelPlacement='outside'
                    variant='bordered'
                    className='w-full'
                    classNames={{ label: 'text-xs text-default-500 pb-1' }}
                    value={activeModel || t('config.onnx_stt.model.no_model', { defaultValue: 'No model selected — configure in Settings → Local Models' })}
                    isReadOnly
                />
            </div>

            {/* Link to settings */}
            <div className='flex items-center gap-1.5 p-2.5 rounded-lg bg-content2 text-xs text-default-500'>
                <MdSettings className='flex-shrink-0 text-sm' />
                <span>{t('config.onnx_stt.manage_in_settings', { defaultValue: 'Manage engine and models in Settings → Local Models' })}</span>
            </div>

            <Button fullWidth color='primary' size='sm' onPress={handleSave}>
                {t('common.save', { defaultValue: 'Save' })}
            </Button>
        </div>
    );
}
