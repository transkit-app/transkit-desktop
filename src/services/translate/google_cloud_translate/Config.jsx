import { INSTANCE_NAME_CONFIG_KEY } from '../../../utils/service_instance';
import { Input, Button } from '@nextui-org/react';
import toast, { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';

import { useConfig } from '../../../hooks/useConfig';
import { useToastStyle } from '../../../hooks';
import { translate } from './index';
import { Language } from './index';

const BASE = 'services.translate.google_cloud_translate';

export function Config(props) {
    const { instanceKey, updateServiceList, onClose } = props;
    const { t } = useTranslation();
    const [config, setConfig] = useConfig(
        instanceKey,
        {
            [INSTANCE_NAME_CONFIG_KEY]: t(`${BASE}.title`, { defaultValue: 'Google Cloud Translation' }),
            apiKey: '',
        },
        { sync: false }
    );
    const [isLoading, setIsLoading] = useState(false);
    const toastStyle = useToastStyle();

    return (
        config !== null && (
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    setIsLoading(true);
                    translate('hello', Language.auto, Language.en, { config }).then(
                        () => {
                            setIsLoading(false);
                            setConfig(config, true);
                            updateServiceList(instanceKey);
                            onClose();
                        },
                        (err) => {
                            setIsLoading(false);
                            toast.error(t('config.service.test_failed') + String(err), { style: toastStyle });
                        }
                    );
                }}
            >
                <Toaster />
                <div className='config-item'>
                    <Input
                        label={t('services.instance_name')}
                        labelPlacement='outside'
                        value={config[INSTANCE_NAME_CONFIG_KEY] ?? ''}
                        variant='bordered'
                        classNames={{ label: 'text-xs text-default-500 pb-1' }}
                        onValueChange={(value) =>
                            setConfig({ ...config, [INSTANCE_NAME_CONFIG_KEY]: value })
                        }
                    />
                </div>
                <div className='config-item'>
                    <Input
                        label={t(`${BASE}.api_key`, { defaultValue: 'API Key' })}
                        labelPlacement='outside'
                        type='password'
                        value={config.apiKey ?? ''}
                        variant='bordered'
                        placeholder='AIza…'
                        classNames={{ label: 'text-xs text-default-500 pb-1' }}
                        onValueChange={(value) => setConfig({ ...config, apiKey: value })}
                    />
                    <p className='text-xs text-default-400 mt-1'>
                        {t(`${BASE}.api_key_hint`, { defaultValue: 'Get your API key at' })}{' '}
                        <span className='text-primary'>
                            console.cloud.google.com/apis/credentials
                        </span>
                        {' — '}
                        {t(`${BASE}.api_key_hint_enable`, {
                            defaultValue: 'enable Cloud Translation API first.',
                        })}
                    </p>
                </div>
                <Button type='submit' isLoading={isLoading} color='primary' fullWidth>
                    {t('common.save')}
                </Button>
            </form>
        )
    );
}
