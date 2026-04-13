import {
    Code,
    Card,
    CardBody,
    Button,
    Progress,
    Skeleton,
    Modal,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalFooter,
    Checkbox,
} from '@nextui-org/react';
import { checkUpdate, installUpdate } from '@tauri-apps/api/updater';
import { getVersion } from '@tauri-apps/api/app';
import { open as openUrl } from '@tauri-apps/api/shell';
import React, { useEffect, useState } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api';
import toast, { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { listen } from '@tauri-apps/api/event';
import ReactMarkdown from 'react-markdown';

import { useConfig, useToastStyle } from '../../hooks';
import { osType } from '../../utils/env';

let unlisten = 0;
let eventId = 0;

export default function Updater() {
    const [autoUpdate, setAutoUpdate] = useConfig('auto_update', false);
    const [downloaded, setDownloaded] = useState(0);
    const [total, setTotal] = useState(0);
    const [body, setBody] = useState('');
    const [installing, setInstalling] = useState(false);
    const [installed, setInstalled] = useState(false);
    const [newVersion, setNewVersion] = useState('');
    const [currentVersion, setCurrentVersion] = useState('');
    // null = loading, true = update available, false = already latest
    const [hasUpdate, setHasUpdate] = useState(null);
    const { t } = useTranslation();
    const toastStyle = useToastStyle();

    useEffect(() => {
        if (appWindow.label === 'updater') {
            appWindow.show();
        }

        getVersion().then(setCurrentVersion).catch(() => {});

        checkUpdate().then(
            (update) => {
                if (update.shouldUpdate) {
                    setHasUpdate(true);
                    setNewVersion(update.manifest?.version ?? '');
                    setBody(update.manifest?.notes ?? update.manifest?.body ?? '');
                } else {
                    setHasUpdate(false);
                }
            },
            (e) => {
                setHasUpdate(false);
                toast.error(e.toString(), { style: toastStyle });
            }
        );

        if (unlisten === 0) {
            unlisten = listen('tauri://update-download-progress', (e) => {
                if (eventId === 0) {
                    eventId = e.id;
                }
                if (e.id === eventId) {
                    setTotal(e.payload.contentLength);
                    setDownloaded((a) => a + e.payload.chunkLength);
                }
            });
        }
    }, []);

    const handleInstall = () => {
        setInstalling(true);
        installUpdate().then(
            () => setInstalled(true),
            (e) => {
                setInstalling(false);
                toast.error(e.toString(), { style: toastStyle });
            }
        );
    };

    const handleSkip = () => {
        if (newVersion) {
            invoke('skip_version', { version: newVersion }).catch(() => {});
        }
        appWindow.close();
    };

    const isDownloading = installing && downloaded !== 0 && downloaded <= total;
    const isInstallInProgress = installing && downloaded > total;
    const isBusy = installing && !installed;

    const getInstallButtonLabel = () => {
        if (isDownloading) return t('updater.downloading');
        if (isInstallInProgress) return t('updater.installing');
        return t('updater.update');
    };

    return (
        <div
            className={`bg-background h-screen flex flex-col ${
                osType === 'Linux' ? 'rounded-[10px] border-1 border-default-100' : ''
            }`}
        >
            <Toaster />

            {/* Invisible drag strip — keeps window draggable without showing a title bar */}
            <div
                data-tauri-drag-region='true'
                className='w-full h-[20px] shrink-0 select-none cursor-default'
            />

            {/* Header: app icon + version summary */}
            <div className='flex items-start gap-4 px-6 pb-4 shrink-0'>
                <img
                    src='icon.png'
                    className='w-[72px] h-[72px] rounded-[16px] shrink-0'
                    draggable={false}
                />
                <div className='flex flex-col justify-center gap-1 pt-1'>
                    {hasUpdate === null ? (
                        <div className='space-y-2 mt-1'>
                            <Skeleton className='w-56 h-5 rounded-lg' />
                            <Skeleton className='w-72 h-4 rounded-lg' />
                            <Skeleton className='w-48 h-4 rounded-lg' />
                        </div>
                    ) : hasUpdate ? (
                        <>
                            <p className='font-bold text-[15px] leading-snug'>
                                {t('updater.version_available')}
                            </p>
                            <p className='text-sm text-default-500'>
                                {t('updater.version_info', { newVersion, currentVersion })}
                            </p>
                            <p className='text-sm text-default-400'>
                                {t('updater.download_prompt')}
                            </p>
                        </>
                    ) : (
                        <>
                            <p className='font-bold text-[15px] leading-snug'>
                                {t('updater.up_to_date')}
                            </p>
                            {currentVersion && (
                                <p className='text-sm text-default-500'>
                                    {t('updater.current_version', { currentVersion })}
                                </p>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Changelog */}
            <Card className='mx-6 flex-1 overflow-hidden min-h-0'>
                <CardBody className='overflow-y-auto'>
                    {hasUpdate === null ? (
                        <div className='space-y-3'>
                            <Skeleton className='w-3/5 rounded-lg'>
                                <div className='h-3 w-3/5 rounded-lg bg-default-200' />
                            </Skeleton>
                            <Skeleton className='w-4/5 rounded-lg'>
                                <div className='h-3 w-4/5 rounded-lg bg-default-200' />
                            </Skeleton>
                            <Skeleton className='w-2/5 rounded-lg'>
                                <div className='h-3 w-2/5 rounded-lg bg-default-300' />
                            </Skeleton>
                        </div>
                    ) : body ? (
                        <>
                        <ReactMarkdown
                            className='markdown-body select-text'
                            components={{
                                code: ({ node, ...props }) => {
                                    const { children } = props;
                                    return <Code size='sm'>{children}</Code>;
                                },
                                h2: ({ node, ...props }) => (
                                    <b>
                                        <h2 className='text-[24px]' {...props} />
                                        <hr />
                                        <br />
                                    </b>
                                ),
                                h3: ({ node, ...props }) => (
                                    <b>
                                        <br />
                                        <h3 className='text-[18px]' {...props} />
                                        <br />
                                    </b>
                                ),
                                li: ({ node, ...props }) => {
                                    const { children } = props;
                                    return (
                                        <li className='list-disc list-inside' children={children} />
                                    );
                                },
                                a: ({ node, href, children, ...props }) => (
                                    <a
                                        className='text-primary underline underline-offset-2 cursor-pointer hover:opacity-75 transition-opacity'
                                        onClick={(e) => {
                                            e.preventDefault();
                                            if (href) openUrl(href).catch(() => {});
                                        }}
                                        {...props}
                                    >
                                        {children}
                                    </a>
                                ),
                            }}
                        >
                            {body}
                        </ReactMarkdown>
                        <div className='mt-3 pt-3 border-t border-default-100'>
                            <a
                                className='text-sm text-primary underline underline-offset-2 cursor-pointer hover:opacity-75 transition-opacity'
                                onClick={() =>
                                    openUrl(
                                        'https://github.com/transkit-app/transkit-desktop/releases/latest'
                                    ).catch(() => {})
                                }
                            >
                                {t('updater.view_on_github')}
                            </a>
                        </div>
                        </>
                    ) : null}
                </CardBody>
            </Card>

            {/* Download progress bar */}
            {isDownloading && (
                <Progress
                    aria-label='Downloading...'
                    label={t('updater.progress')}
                    value={(downloaded / total) * 100}
                    classNames={{
                        base: 'w-full px-6 mt-2',
                        track: 'drop-shadow-md border border-default',
                        indicator: 'bg-gradient-to-r from-pink-500 to-yellow-500',
                        label: 'tracking-wider font-medium text-default-600',
                        value: 'text-foreground/60',
                    }}
                    showValueLabel
                    size='sm'
                />
            )}

            {/* Auto-update preference — saved to config, honoured on next startup check */}
            <div className='px-6 pt-3 pb-1 shrink-0'>
                <Checkbox
                    size='sm'
                    isSelected={autoUpdate === true}
                    onValueChange={(v) => setAutoUpdate(v)}
                    isDisabled={isBusy}
                >
                    <span className='text-small text-default-600'>
                        {t('updater.auto_update')}
                    </span>
                </Checkbox>
            </div>

            {/* Action buttons */}
            <div className='flex items-center justify-between gap-2 px-6 pt-1 pb-5 shrink-0'>
                {hasUpdate ? (
                    <>
                        <Button
                            size='sm'
                            variant='flat'
                            isDisabled={isBusy}
                            onPress={handleSkip}
                        >
                            {t('updater.skip_version')}
                        </Button>
                        <div className='flex gap-2'>
                            <Button
                                size='sm'
                                variant='flat'
                                isDisabled={isBusy}
                                onPress={() => appWindow.close()}
                            >
                                {t('updater.remind_later')}
                            </Button>
                            <Button
                                size='sm'
                                isLoading={isBusy}
                                isDisabled={isBusy}
                                color='primary'
                                onPress={handleInstall}
                            >
                                {getInstallButtonLabel()}
                            </Button>
                        </div>
                    </>
                ) : hasUpdate === false ? (
                    <div className='w-full flex justify-end'>
                        <Button
                            size='sm'
                            variant='flat'
                            onPress={() => appWindow.close()}
                        >
                            {t('updater.close')}
                        </Button>
                    </div>
                ) : null}
            </div>

            {/* Post-install restart dialog */}
            <Modal
                isOpen={installed}
                hideCloseButton
                isDismissable={false}
            >
                <ModalContent>
                    <ModalHeader className='flex flex-col gap-1'>
                        {t('updater.install_complete')}
                    </ModalHeader>
                    <ModalBody>
                        <p className='text-default-600'>{t('updater.installed')}</p>
                    </ModalBody>
                    <ModalFooter>
                        <Button
                            variant='flat'
                            color='default'
                            onPress={() => appWindow.close()}
                        >
                            {t('updater.restart_later')}
                        </Button>
                        <Button
                            color='primary'
                            onPress={() => invoke('restart_app')}
                        >
                            {t('updater.restart_now')}
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </div>
    );
}
