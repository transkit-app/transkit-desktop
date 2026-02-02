import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Accordion, AccordionItem } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import React from 'react';

import * as builtinServices from '../../../../../../services/translate';
import { createServiceInstanceKey } from '../../../../../../utils/service_instance';

// Global services - shown by default
const globalServices = [
    'deepl',
    'google',
    'bing',
    'openai',
    'geminipro',
    'openrouter',
    'groq',
    'ollama',
    'yandex',
    'lingva',
];

// Advanced/More services
const advancedServices = [
    'baidu',
    'baidu_field',
    'tencent',
    'volcengine',
    'alibaba',
    'niutrans',
    'youdao',
    'caiyun',
    'chatglm',
    'transmart',
    'bing_dict',
    'cambridge_dict',
    'ecdict',
];

export default function SelectModal(props) {
    const { isOpen, onOpenChange, setCurrentConfigKey, onConfigOpen } = props;
    const { t } = useTranslation();

    const renderServiceButton = (serviceName, onClose) => {
        const service = builtinServices[serviceName];
        if (!service) return null;

        return (
            <div key={serviceName}>
                <Button
                    fullWidth
                    variant='flat'
                    color='default'
                    className='justify-start'
                    onPress={() => {
                        setCurrentConfigKey(createServiceInstanceKey(serviceName));
                        onConfigOpen();
                        onClose();
                    }}
                    startContent={
                        <img
                            src={service.info.icon}
                            className='h-[24px] w-[24px]'
                            alt=''
                        />
                    }
                >
                    {t(`services.translate.${service.info.name}.title`)}
                </Button>
            </div>
        );
    };

    return (
        <Modal
            isOpen={isOpen}
            onOpenChange={onOpenChange}
            scrollBehavior='inside'
        >
            <ModalContent className='max-h-[80vh]'>
                {(onClose) => (
                    <>
                        <ModalHeader>{t('config.service.add_service')}</ModalHeader>
                        <ModalBody>
                            {/* Global Services */}
                            <div className='flex flex-col gap-2'>
                                {globalServices.map((serviceName) => renderServiceButton(serviceName, onClose))}
                            </div>

                            {/* Advanced/More Services */}
                            <Accordion className='px-0 mt-2'>
                                <AccordionItem
                                    key='advanced'
                                    aria-label='More Services'
                                    title={t('config.service.more_services')}
                                    classNames={{
                                        title: 'text-default-600 text-sm',
                                        trigger: 'py-2',
                                    }}
                                >
                                    <div className='flex flex-col gap-2'>
                                        {advancedServices.map((serviceName) => renderServiceButton(serviceName, onClose))}
                                    </div>
                                </AccordionItem>
                            </Accordion>
                        </ModalBody>
                        <ModalFooter>
                            <Button
                                color='danger'
                                variant='light'
                                onPress={onClose}
                            >
                                {t('common.cancel')}
                            </Button>
                        </ModalFooter>
                    </>
                )}
            </ModalContent>
        </Modal>
    );
}
