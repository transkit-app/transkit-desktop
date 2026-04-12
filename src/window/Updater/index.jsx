import { Code, Card, CardBody, Button, Progress, Skeleton, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@nextui-org/react';
import { checkUpdate, installUpdate } from '@tauri-apps/api/updater';
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
    const [transparent] = useConfig('transparent', true);
    const [downloaded, setDownloaded] = useState(0);
    const [total, setTotal] = useState(0);
    const [body, setBody] = useState('');
    const [installing, setInstalling] = useState(false);
    const [installed, setInstalled] = useState(false);
    const { t } = useTranslation();
    const toastStyle = useToastStyle();

    useEffect(() => {
        if (appWindow.label === 'updater') {
            appWindow.show();
        }
        checkUpdate().then(
            (update) => {
                if (update.shouldUpdate) {
                    setBody(update.manifest?.notes ?? update.manifest?.body ?? '');
                } else {
                    setBody(t('updater.latest'));
                }
            },
            (e) => {
                setBody(e.toString());
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
                    setDownloaded((a) => {
                        return a + e.payload.chunkLength;
                    });
                }
            });
        }
    }, []);

    const isDownloading = installing && downloaded !== 0 && downloaded <= total;
    const isInstallInProgress = installing && downloaded > total;
    const isBusy = installing && !installed;

    const getButtonLabel = () => {
        if (isDownloading) return t('updater.downloading');
        if (isInstallInProgress) return t('updater.installing');
        return t('updater.update');
    };

    return (
        <div
            className={`${transparent ? 'bg-background/90' : 'bg-background'} h-screen ${
                osType === 'Linux' && 'rounded-[10px] border-1 border-default-100'
            }`}
        >
            <Toaster />
            <div className='p-[5px] h-[35px] w-full select-none cursor-default'>
                <div
                    data-tauri-drag-region='true'
                    className={`h-full w-full flex ${osType === 'Darwin' ? 'justify-end' : 'justify-start'}`}
                >
                    <img
                        src='icon.png'
                        className='h-[25px] w-[25px] mr-[10px]'
                        draggable={false}
                    />
                    <h2>{t('updater.title')}</h2>
                </div>
            </div>
            <Card className='mx-[80px] mt-[10px] overscroll-auto h-[calc(100vh-150px)]'>
                <CardBody>
                    {body === '' ? (
                        <div className='space-y-3'>
                            <Skeleton className='w-3/5 rounded-lg'>
                                <div className='h-3 w-3/5 rounded-lg bg-default-200'></div>
                            </Skeleton>
                            <Skeleton className='w-4/5 rounded-lg'>
                                <div className='h-3 w-4/5 rounded-lg bg-default-200'></div>
                            </Skeleton>
                            <Skeleton className='w-2/5 rounded-lg'>
                                <div className='h-3 w-2/5 rounded-lg bg-default-300'></div>
                            </Skeleton>
                        </div>
                    ) : (
                        <ReactMarkdown
                            className='markdown-body select-text'
                            components={{
                                code: ({ node, ...props }) => {
                                    const { children } = props;
                                    return <Code size='sm'>{children}</Code>;
                                },
                                h2: ({ node, ...props }) => (
                                    <b>
                                        <h2
                                            className='text-[24px]'
                                            {...props}
                                        />
                                        <hr />
                                        <br />
                                    </b>
                                ),
                                h3: ({ node, ...props }) => (
                                    <b>
                                        <br />
                                        <h3
                                            className='text-[18px]'
                                            {...props}
                                        />
                                        <br />
                                    </b>
                                ),
                                li: ({ node, ...props }) => {
                                    const { children } = props;
                                    return (
                                        <li
                                            className='list-disc list-inside'
                                            children={children}
                                        />
                                    );
                                },
                            }}
                        >
                            {body}
                        </ReactMarkdown>
                    )}
                </CardBody>
            </Card>
            {isDownloading && (
                <Progress
                    aria-label='Downloading...'
                    label={t('updater.progress')}
                    value={(downloaded / total) * 100}
                    classNames={{
                        base: 'w-full px-[80px]',
                        track: 'drop-shadow-md border border-default',
                        indicator: 'bg-gradient-to-r from-pink-500 to-yellow-500',
                        label: 'tracking-wider font-medium text-default-600',
                        value: 'text-foreground/60',
                    }}
                    showValueLabel
                    size='sm'
                />
            )}

            <div className='grid gap-4 grid-cols-2 h-[50px] my-[10px] mx-[80px]'>
                <Button
                    variant='flat'
                    isLoading={isBusy}
                    isDisabled={isBusy}
                    color='primary'
                    onPress={() => {
                        setInstalling(true);
                        installUpdate().then(
                            () => {
                                setInstalled(true);
                            },
                            (e) => {
                                setInstalling(false);
                                toast.error(e.toString(), { style: toastStyle });
                            }
                        );
                    }}
                >
                    {getButtonLabel()}
                </Button>
                <Button
                    variant='flat'
                    color='danger'
                    onPress={() => {
                        appWindow.close();
                    }}
                >
                    {t('updater.cancel')}
                </Button>
            </div>

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
                            onPress={() => {
                                appWindow.close();
                            }}
                        >
                            {t('updater.restart_later')}
                        </Button>
                        <Button
                            color='primary'
                            onPress={() => {
                                invoke('restart_app');
                            }}
                        >
                            {t('updater.restart_now')}
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </div>
    );
}
