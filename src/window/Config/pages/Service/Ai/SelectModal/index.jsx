import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import React from 'react';

import { createServiceInstanceKey } from '../../../../../../utils/service_instance';
import * as builtinServices from '../../../../../../services/ai';

export default function SelectModal(props) {
    const { isOpen, onOpenChange, setCurrentConfigKey, onConfigOpen } = props;
    const { t } = useTranslation();

    return (
        <Modal isOpen={isOpen} onOpenChange={onOpenChange} scrollBehavior='inside'>
            <ModalContent className='max-h-[80vh]'>
                {(onClose) => (
                    <>
                        <ModalHeader>{t('config.service.add_service')}</ModalHeader>
                        <ModalBody>
                            {Object.keys(builtinServices).map((x) => (
                                <div key={x}>
                                    <Button
                                        fullWidth
                                        variant='flat'
                                        color='default'
                                        className='justify-start'
                                        onPress={() => {
                                            setCurrentConfigKey(createServiceInstanceKey(x));
                                            onConfigOpen();
                                        }}
                                        startContent={
                                            <img
                                                src={builtinServices[x].info.icon}
                                                className='h-[24px] w-[24px]'
                                                alt=''
                                            />
                                        }
                                    >
                                        {t(`services.ai.${builtinServices[x].info.name}.title`)}
                                    </Button>
                                </div>
                            ))}
                        </ModalBody>
                        <ModalFooter>
                            <Button color='danger' variant='light' onPress={onClose}>
                                {t('common.cancel')}
                            </Button>
                        </ModalFooter>
                    </>
                )}
            </ModalContent>
        </Modal>
    );
}
