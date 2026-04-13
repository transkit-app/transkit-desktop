import { Card, CardBody, Button, Chip, Link, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure } from '@nextui-org/react';
import { appLogDir, appConfigDir } from '@tauri-apps/api/path';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/api/shell';
import { invoke } from '@tauri-apps/api';
import React, { useState } from 'react';
import {
    BsGlobe,
    BsGithub,
    BsChatDots,
    BsPeople,
    BsDownload,
    BsFolder,
    BsFileText,
    BsHeartFill,
    BsBoxArrowUpRight,
    BsArrowCounterclockwise,
} from 'react-icons/bs';

import { store } from '../../../../utils/store';

import { appVersion } from '../../../../utils/env';

export default function About() {
    const { t } = useTranslation();
    const { isOpen, onOpen, onOpenChange } = useDisclosure();
    const [isResetting, setIsResetting] = useState(false);

    async function handleReset(keepCredentials) {
        setIsResetting(true);
        try {
            const allKeys = await store.keys();
            for (const key of allKeys) {
                if (keepCredentials) {
                    // Keep: service instance configs (contain '@'), known credential keys,
                    // and old-style service name keys whose value is a plain object.
                    const value = await store.get(key);
                    const isCredential =
                        key.includes('@') ||
                        key === 'soniox_api_key' ||
                        (value !== null &&
                            typeof value === 'object' &&
                            !Array.isArray(value));
                    if (!isCredential) {
                        await store.delete(key);
                    }
                } else {
                    await store.delete(key);
                }
            }
            await store.save();
            await invoke('restart_app');
        } finally {
            setIsResetting(false);
        }
    }

    const ActionCard = ({ icon: Icon, title, description, onClick, color = 'default' }) => {
        const colorClasses = {
            primary: 'bg-primary/10 text-primary',
            default: 'bg-default/10 text-default-700',
            warning: 'bg-warning/10 text-warning',
            secondary: 'bg-secondary/10 text-secondary',
        };

        return (
            <Card
                isPressable
                onPress={onClick}
                className='hover:scale-105 transition-transform duration-200'
            >
                <CardBody className='flex flex-row items-center gap-3 p-4'>
                    <div className={`p-3 rounded-xl ${colorClasses[color]?.split(' ')[0] || 'bg-default/10'}`}>
                        <Icon className={`text-2xl ${colorClasses[color]?.split(' ')[1] || 'text-default-700'}`} />
                    </div>
                    <div className='flex-1'>
                        <p className='font-semibold text-sm'>{title}</p>
                        {description && <p className='text-xs text-default-500'>{description}</p>}
                    </div>
                    <BsBoxArrowUpRight className='text-default-400' />
                </CardBody>
            </Card>
        );
    };

    return (
        <div className='h-full w-full overflow-y-auto'>
            {/* Hero Section */}
            <div className='flex flex-col items-center justify-center pt-2 pb-8 px-8'>
                <div className='relative group'>
                    <div className='absolute inset-0 bg-gradient-to-r from-primary/20 to-secondary/20 rounded-full blur-2xl group-hover:blur-3xl transition-all duration-300'></div>
                    <img
                        src='icon.png'
                        className='relative h-24 w-24 mb-4 drop-shadow-2xl'
                        draggable={false}
                    />
                </div>
                <h1 className='text-4xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent mb-2'>
                    TransKit
                </h1>
                <Chip
                    color='primary'
                    variant='flat'
                    size='sm'
                    className='mb-3'
                >
                    {appVersion}
                </Chip>
                <p className='text-center text-sm text-default-500 max-w-md'>
                    {t('config.about.description') || 'A cross-platform translation & OCR app'}
                </p>
            </div>

            {/* Main Actions Grid */}
            <div className='px-8 pb-6'>
                <div className='grid grid-cols-2 gap-3 mb-4'>
                    <ActionCard
                        icon={BsGlobe}
                        title={t('config.about.website')}
                        description='transkit.app'
                        onClick={() => open('https://transkit.app')}
                        color='primary'
                    />
                    <ActionCard
                        icon={BsGithub}
                        title={t('config.about.github')}
                        description='Source Code'
                        onClick={() => open('https://github.com/transkit-app/transkit-desktop')}
                        color='default'
                    />
                    <ActionCard
                        icon={BsChatDots}
                        title={t('config.about.feedback')}
                        description='Issues & Suggestions'
                        onClick={() => open('https://github.com/transkit-app/transkit-desktop/issues')}
                        color='warning'
                    />
                    <ActionCard
                        icon={BsPeople}
                        title={t('config.about.community')}
                        description='Join Us'
                        onClick={() => open('https://github.com/transkit-app/transkit-desktop/discussions')}
                        color='secondary'
                    />
                </div>

                {/* System Actions */}
                <Card className='mb-4'>
                    <CardBody className='p-4'>
                        <p className='text-xs font-semibold text-default-500 mb-3 uppercase'>
                            {t('config.about.system') || 'System'}
                        </p>
                        <div className='flex gap-2'>
                            <Button
                                size='sm'
                                variant='flat'
                                color='primary'
                                startContent={<BsDownload />}
                                onPress={() => invoke('updater_window')}
                                className='flex-1'
                            >
                                {t('config.about.check_update')}
                            </Button>
                            <Button
                                size='sm'
                                variant='flat'
                                startContent={<BsFileText />}
                                onPress={async () => {
                                    const dir = await appLogDir();
                                    open(dir);
                                }}
                            >
                                {t('config.about.view_log')}
                            </Button>
                            <Button
                                size='sm'
                                variant='flat'
                                startContent={<BsFolder />}
                                onPress={async () => {
                                    const dir = await appConfigDir();
                                    open(dir);
                                }}
                            >
                                {t('config.about.view_config')}
                            </Button>
                            <Button
                                size='sm'
                                variant='flat'
                                color='danger'
                                startContent={<BsArrowCounterclockwise />}
                                onPress={onOpen}
                            >
                                {t('config.about.reset_defaults', { defaultValue: 'Reset' })}
                            </Button>
                        </div>
                    </CardBody>
                </Card>
            </div>

            {/* Reset Confirmation Modal */}
            <Modal
                isOpen={isOpen}
                onOpenChange={onOpenChange}
                size='sm'
            >
                <ModalContent>
                    {(onClose) => (
                        <>
                            <ModalHeader className='flex flex-col gap-1'>
                                {t('config.about.reset_title', { defaultValue: 'Reset to Defaults' })}
                            </ModalHeader>
                            <ModalBody>
                                <p className='text-sm text-default-600'>
                                    {t('config.about.reset_desc', {
                                        defaultValue:
                                            'All settings will be reset. Choose whether to keep your API keys and service credentials.',
                                    })}
                                </p>
                                <p className='text-xs text-default-400 mt-1'>
                                    {t('config.about.reset_restart_note', {
                                        defaultValue: 'The app will restart automatically after reset.',
                                    })}
                                </p>
                            </ModalBody>
                            <ModalFooter className='flex flex-col gap-2'>
                                <Button
                                    fullWidth
                                    color='warning'
                                    variant='flat'
                                    isLoading={isResetting}
                                    onPress={() => {
                                        onClose();
                                        handleReset(true);
                                    }}
                                    startContent={!isResetting && <BsArrowCounterclockwise />}
                                >
                                    {t('config.about.reset_keep_keys', { defaultValue: 'Reset — Keep API Keys' })}
                                </Button>
                                <Button
                                    fullWidth
                                    color='danger'
                                    variant='flat'
                                    isLoading={isResetting}
                                    onPress={() => {
                                        onClose();
                                        handleReset(false);
                                    }}
                                    startContent={!isResetting && <BsArrowCounterclockwise />}
                                >
                                    {t('config.about.reset_full', { defaultValue: 'Reset Everything' })}
                                </Button>
                                <Button
                                    fullWidth
                                    variant='light'
                                    onPress={onClose}
                                >
                                    {t('common.cancel', { defaultValue: 'Cancel' })}
                                </Button>
                            </ModalFooter>
                        </>
                    )}
                </ModalContent>
            </Modal>

            {/* Footer - Pot Credits */}
            <div className='border-t border-divider mt-auto'>
                <div className='px-8 py-6'>
                    <div className='flex items-start gap-3 mb-3'>
                        <BsHeartFill className='text-danger mt-1 flex-shrink-0' />
                        <div className='flex-1'>
                            <p className='text-xs font-medium text-default-700 mb-1'>
                                Forked from{' '}
                                <Link
                                    href='https://github.com/pot-app/pot-desktop'
                                    isExternal
                                    size='sm'
                                    className='text-xs font-semibold'
                                    onPress={() => open('https://github.com/pot-app/pot-desktop')}
                                >
                                    Pot
                                </Link>
                            </p>
                            <p className='text-xs text-default-500 leading-relaxed'>
                                TransKit is built upon the excellent work of the Pot community. We're committed to
                                open-source development and giving back to the community.
                            </p>
                        </div>
                    </div>

                    <div className='flex flex-wrap gap-2 items-center'>
                        <Chip
                            size='sm'
                            variant='flat'
                            startContent={<BsGithub />}
                        >
                            <Link
                                href='https://github.com/pot-app/pot-desktop'
                                isExternal
                                size='sm'
                                className='text-xs'
                                onPress={() => open('https://github.com/pot-app/pot-desktop')}
                            >
                                pot-app/pot-desktop
                            </Link>
                        </Chip>
                        <Chip
                            size='sm'
                            variant='flat'
                            startContent={<BsGlobe />}
                        >
                            <Link
                                href='https://pot-app.com'
                                isExternal
                                size='sm'
                                className='text-xs'
                                onPress={() => open('https://pot-app.com')}
                            >
                                pot-app.com
                            </Link>
                        </Chip>
                        <Chip
                            size='sm'
                            variant='flat'
                            color='success'
                        >
                            GPL-3.0 License
                        </Chip>
                    </div>

                    <p className='text-xs text-default-400 mt-3 text-center'>
                        Made with love for the translation community 💙
                    </p>
                </div>
            </div>
        </div>
    );
}
