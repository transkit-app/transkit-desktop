import { Input, Button, Divider, Card, CardBody, CardHeader } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import { AiFillEye, AiFillEyeInvisible } from 'react-icons/ai';
import { MdMicNone } from 'react-icons/md';
import React, { useState } from 'react';
import { useConfig } from '../../../../../hooks';
import toast, { Toaster } from 'react-hot-toast';
import { useToastStyle } from '../../../../../hooks';
import { open } from '@tauri-apps/api/shell';

export default function Audio() {
    const { t } = useTranslation();
    const toastStyle = useToastStyle();
    const [apiKey, setApiKey] = useConfig('soniox_api_key', '');
    const [isVisible, setIsVisible] = useState(false);

    const handleSave = async () => {
        toast.success(t('config.service.audio.saved'), { style: toastStyle });
    };

    return (
        <div className='config-page flex flex-col gap-4 p-1'>
            <Toaster />
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdMicNone className='text-[20px] text-primary' />
                    <p className='text-sm font-semibold'>{t('config.service.audio.title')}</p>
                </CardHeader>
                <CardBody className='flex flex-col gap-4'>
                    <div className='flex flex-col gap-1'>
                        <p className='text-xs text-default-500'>{t('config.service.audio.api_key_label')}</p>
                        <Input
                            size='sm'
                            type={isVisible ? 'text' : 'password'}
                            value={apiKey ?? ''}
                            placeholder={t('config.service.audio.api_key_placeholder')}
                            onValueChange={setApiKey}
                            endContent={
                                <Button
                                    isIconOnly
                                    size='sm'
                                    variant='light'
                                    className='h-6 w-6 min-w-0'
                                    onPress={() => setIsVisible(!isVisible)}
                                >
                                    {isVisible ? (
                                        <AiFillEyeInvisible className='text-default-500' />
                                    ) : (
                                        <AiFillEye className='text-default-500' />
                                    )}
                                </Button>
                            }
                        />
                        <p className='text-xs text-default-400'>
                            {t('config.service.audio.api_key_hint')}{' '}
                            <span
                                className='text-primary cursor-pointer hover:underline'
                                onClick={() => open('https://console.soniox.com/signup')}
                            >
                                console.soniox.com
                            </span>
                        </p>
                    </div>
                    <Divider />
                    <div className='flex flex-col gap-1'>
                        <p className='text-xs text-default-500'>{t('config.service.audio.info_label')}</p>
                        <p className='text-xs text-default-400'>{t('config.service.audio.info_desc')}</p>
                    </div>
                </CardBody>
            </Card>
        </div>
    );
}
