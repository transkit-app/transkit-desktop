import React, { useState, useEffect, useCallback } from 'react';
import { Button, Input, Select, SelectItem } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/tauri';
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
            asrModel: '',
        },
        { sync: false }
    );

    const [models, setModels] = useState([]);

    useEffect(() => {
        invoke('onnx_model_list').then(setModels).catch(() => {});
    }, []);

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

            {/* Active model selector */}
            <div className='config-item flex-col items-start gap-1'>
                {models.length > 0 ? (
                    <>
                        <Select
                            label={t('config.onnx_stt.model.active', { defaultValue: 'Model' })}
                            labelPlacement='outside'
                            variant='bordered'
                            className='w-full'
                            classNames={{ label: 'text-xs text-default-500 pb-1' }}
                            selectedKeys={config.asrModel ? [config.asrModel] : []}
                            onSelectionChange={(keys) => {
                                const v = Array.from(keys)[0];
                                if (v) setConfig({ ...config, asrModel: v });
                            }}
                        >
                            {models.map(m => (
                                <SelectItem key={m.repo_id} textValue={m.repo_id}>
                                    <span className='font-mono text-xs'>{m.repo_id}</span>
                                </SelectItem>
                            ))}
                        </Select>
                        <p className='text-xs text-default-400'>
                            {t('config.onnx_stt.model.select_hint', { defaultValue: 'Select from downloaded models' })}
                        </p>
                    </>
                ) : (
                    <>
                        <Input
                            label={t('config.onnx_stt.model.active', { defaultValue: 'Model' })}
                            labelPlacement='outside'
                            placeholder='e.g. hynt/Zipformer-30M-RNNT-6000h'
                            variant='bordered'
                            className='w-full'
                            classNames={{ label: 'text-xs text-default-500 pb-1' }}
                            value={config.asrModel ?? ''}
                            onValueChange={v => setConfig({ ...config, asrModel: v })}
                        />
                        <p className='text-xs text-default-400'>
                            {t('config.onnx_stt.model.active_hint', { defaultValue: 'HuggingFace repo ID of the downloaded model' })}
                        </p>
                    </>
                )}
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
