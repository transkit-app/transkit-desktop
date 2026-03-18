import { Input, Button, Select, SelectItem, Chip } from '@nextui-org/react';
import toast, { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';

import { INSTANCE_NAME_CONFIG_KEY } from '../../../utils/service_instance';
import { useConfig } from '../../../hooks/useConfig';
import { useToastStyle } from '../../../hooks';
import { tts, Language } from './index';

const EDGE_VOICES = [
    { key: 'vi-VN-HoaiMyNeural', label: 'vi-VN-HoaiMyNeural (Female)' },
    { key: 'vi-VN-NamMinhNeural', label: 'vi-VN-NamMinhNeural (Male)' },
    { key: 'en-US-EmmaMultilingualNeural', label: 'en-US-EmmaMultilingualNeural' },
    { key: 'en-US-AndrewNeural', label: 'en-US-AndrewNeural (Male)' },
    { key: 'en-US-AriaNeural', label: 'en-US-AriaNeural (Female)' },
    { key: 'en-GB-SoniaNeural', label: 'en-GB-SoniaNeural (Female)' },
    { key: 'zh-CN-XiaoxiaoNeural', label: 'zh-CN-XiaoxiaoNeural (Female)' },
    { key: 'zh-CN-YunxiNeural', label: 'zh-CN-YunxiNeural (Male)' },
    { key: 'ja-JP-NanamiNeural', label: 'ja-JP-NanamiNeural (Female)' },
    { key: 'ko-KR-SunHiNeural', label: 'ko-KR-SunHiNeural (Female)' },
    { key: 'fr-FR-DeniseNeural', label: 'fr-FR-DeniseNeural (Female)' },
    { key: 'de-DE-KatjaNeural', label: 'de-DE-KatjaNeural (Female)' },
    { key: 'es-ES-ElviraNeural', label: 'es-ES-ElviraNeural (Female)' },
];

export function Config(props) {
    const { instanceKey, updateServiceList, onClose } = props;
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);
    const toastStyle = useToastStyle();

    const [config, setConfig] = useConfig(
        instanceKey,
        {
            [INSTANCE_NAME_CONFIG_KEY]: t('services.tts.edge_tts.title'),
            voice: 'vi-VN-HoaiMyNeural',
            rate: '+0%',
            pitch: '+0Hz',
        },
        { sync: false }
    );

    return (
        config !== null && (
            <>
                <Toaster />
                <div className='config-item'>
                    <Input
                        label={t('services.instance_name')}
                        labelPlacement='outside-left'
                        value={config[INSTANCE_NAME_CONFIG_KEY]}
                        variant='bordered'
                        classNames={{
                            base: 'justify-between',
                            label: 'text-[length:--nextui-font-size-medium]',
                            mainWrapper: 'max-w-[50%]',
                        }}
                        onValueChange={v => setConfig({ ...config, [INSTANCE_NAME_CONFIG_KEY]: v })}
                    />
                </div>
                <div className='config-item'>
                    <Chip size='sm' color='success' variant='flat'>
                        {t('services.tts.edge_tts.builtin')}
                    </Chip>
                    <p className='text-xs text-default-400 my-auto'>
                        {t('services.tts.edge_tts.builtin_hint')}
                    </p>
                </div>
                <div className='config-item'>
                    <h3 className='my-auto'>{t('services.tts.edge_tts.voice')}</h3>
                    <Select
                        size='sm'
                        className='max-w-[55%]'
                        selectedKeys={new Set([config.voice ?? 'vi-VN-HoaiMyNeural'])}
                        onSelectionChange={keys => setConfig({ ...config, voice: [...keys][0] })}
                    >
                        {EDGE_VOICES.map(v => (
                            <SelectItem key={v.key}>{v.label}</SelectItem>
                        ))}
                    </Select>
                </div>
                <div className='config-item'>
                    <Input
                        label={t('services.tts.edge_tts.rate')}
                        labelPlacement='outside-left'
                        value={config.rate ?? '+0%'}
                        variant='bordered'
                        classNames={{
                            base: 'justify-between',
                            label: 'text-[length:--nextui-font-size-medium]',
                            mainWrapper: 'max-w-[50%]',
                        }}
                        onValueChange={v => setConfig({ ...config, rate: v })}
                    />
                </div>
                <div className='config-item'>
                    <Input
                        label={t('services.tts.edge_tts.pitch')}
                        labelPlacement='outside-left'
                        value={config.pitch ?? '+0Hz'}
                        variant='bordered'
                        classNames={{
                            base: 'justify-between',
                            label: 'text-[length:--nextui-font-size-medium]',
                            mainWrapper: 'max-w-[50%]',
                        }}
                        onValueChange={v => setConfig({ ...config, pitch: v })}
                    />
                </div>
                <div>
                    <Button
                        isLoading={isLoading}
                        fullWidth
                        color='primary'
                        onPress={() => {
                            setIsLoading(true);
                            setConfig(config, true);
                            updateServiceList(instanceKey);
                            tts('xin chào', Language.vi, { config }).then(
                                () => {
                                    setIsLoading(false);
                                    onClose();
                                },
                                e => {
                                    setIsLoading(false);
                                    toast.error(t('config.service.test_failed') + e.toString(), { style: toastStyle });
                                }
                            );
                        }}
                    >
                        {t('common.save')}
                    </Button>
                </div>
            </>
        )
    );
}
