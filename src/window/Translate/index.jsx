import { readDir, BaseDirectory, readTextFile, exists } from '@tauri-apps/api/fs';
import { DragDropContext, Draggable, Droppable } from 'react-beautiful-dnd';
import { appWindow, currentMonitor, LogicalSize } from '@tauri-apps/api/window';
import { appConfigDir, join } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { Spacer, Button } from '@nextui-org/react';
import { AiFillCloseCircle } from 'react-icons/ai';
import React, { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { BsPinFill } from 'react-icons/bs';

import LanguageArea from './components/LanguageArea';
import SourceArea from './components/SourceArea';
import TargetArea from './components/TargetArea';
import { getServiceName, whetherPluginService } from '../../utils/service_instance';
import * as builtinServices from '../../services/translate';
import { osType } from '../../utils/env';
import { useConfig } from '../../hooks';
import { store } from '../../utils/store';
import { info } from 'tauri-plugin-log-api';

let blurTimeout = null;
let resizeTimeout = null;
let moveTimeout = null;

const listenBlur = () => {
    return listen('tauri://blur', () => {
        if (appWindow.label === 'translate') {
            if (blurTimeout) {
                clearTimeout(blurTimeout);
            }
            info('Blur');
            // 100ms后关闭窗口，因为在 windows 下拖动窗口时会先切换成 blur 再立即切换成 focus
            // 如果直接关闭将导致窗口无法拖动
            blurTimeout = setTimeout(async () => {
                info('Confirm Blur');
                await appWindow.close();
            }, 100);
        }
    });
};

let unlisten = listenBlur();
// 取消 blur 监听
const unlistenBlur = () => {
    unlisten.then((f) => {
        f();
    });
};

// 监听 focus 事件取消 blurTimeout 时间之内的关闭窗口
void listen('tauri://focus', () => {
    info('Focus');
    if (blurTimeout) {
        info('Cancel Close');
        clearTimeout(blurTimeout);
    }
});
// 监听 move 事件取消 blurTimeout 时间之内的关闭窗口
void listen('tauri://move', () => {
    info('Move');
    if (blurTimeout) {
        info('Cancel Close');
        clearTimeout(blurTimeout);
    }
});

export default function Translate() {
    const [closeOnBlur] = useConfig('translate_close_on_blur', true);
    const [alwaysOnTop] = useConfig('translate_always_on_top', false);
    const [windowPosition] = useConfig('translate_window_position', 'mouse');
    const [rememberWindowSize] = useConfig('translate_remember_window_size', false);
    const [translateServiceInstanceList, setTranslateServiceInstanceList] = useConfig('translate_service_list', [
        'deepl',
        'bing',
        'lingva',
        'yandex',
        'google',
        'ecdict',
    ]);
    const [recognizeServiceInstanceList] = useConfig('recognize_service_list', ['system', 'tesseract']);
    const [ttsServiceInstanceList] = useConfig('tts_service_list', ['lingva_tts']);
    const [collectionServiceInstanceList] = useConfig('collection_service_list', []);
    const [hideLanguage] = useConfig('hide_language', false);
    const [pined, setPined] = useState(false);
    const [pluginList, setPluginList] = useState(null);
    const [serviceInstanceConfigMap, setServiceInstanceConfigMap] = useState(null);
    const [headerButtons, setHeaderButtons] = useState(null);
    const contentRef = useRef(null);
    const reorder = (list, startIndex, endIndex) => {
        const result = Array.from(list);
        const [removed] = result.splice(startIndex, 1);
        result.splice(endIndex, 0, removed);
        return result;
    };

    const onDragEnd = async (result) => {
        if (!result.destination) return;
        const items = reorder(translateServiceInstanceList, result.source.index, result.destination.index);
        setTranslateServiceInstanceList(items);
    };
    // 是否自动关闭窗口
    useEffect(() => {
        if (closeOnBlur !== null && !closeOnBlur) {
            unlistenBlur();
        }
    }, [closeOnBlur]);
    // 是否默认置顶
    useEffect(() => {
        if (alwaysOnTop !== null && alwaysOnTop) {
            appWindow.setAlwaysOnTop(true);
            unlistenBlur();
            setPined(true);
        }
    }, [alwaysOnTop]);
    // 保存窗口位置
    useEffect(() => {
        if (windowPosition !== null && windowPosition === 'pre_state') {
            const unlistenMove = listen('tauri://move', async () => {
                if (moveTimeout) {
                    clearTimeout(moveTimeout);
                }
                moveTimeout = setTimeout(async () => {
                    if (appWindow.label === 'translate') {
                        let position = await appWindow.outerPosition();
                        const monitor = await currentMonitor();
                        const factor = monitor.scaleFactor;
                        position = position.toLogical(factor);
                        await store.set('translate_window_position_x', parseInt(position.x));
                        await store.set('translate_window_position_y', parseInt(position.y));
                        await store.save();
                    }
                }, 100);
            });
            return () => {
                unlistenMove.then((f) => {
                    f();
                });
            };
        }
    }, [windowPosition]);
    // 保存窗口大小
    useEffect(() => {
        if (rememberWindowSize !== null && rememberWindowSize) {
            const unlistenResize = listen('tauri://resize', async () => {
                if (resizeTimeout) {
                    clearTimeout(resizeTimeout);
                }
                resizeTimeout = setTimeout(async () => {
                    if (appWindow.label === 'translate') {
                        let size = await appWindow.outerSize();
                        const monitor = await currentMonitor();
                        const factor = monitor.scaleFactor;
                        size = size.toLogical(factor);
                        await store.set('translate_window_height', parseInt(size.height));
                        await store.set('translate_window_width', parseInt(size.width));
                        await store.save();
                    }
                }, 100);
            });
            return () => {
                unlistenResize.then((f) => {
                    f();
                });
            };
        }
    }, [rememberWindowSize]);

    const loadPluginList = async () => {
        const serviceTypeList = ['translate', 'tts', 'recognize', 'collection'];
        let temp = {};
        for (const serviceType of serviceTypeList) {
            temp[serviceType] = {};
            if (await exists(`plugins/${serviceType}`, { dir: BaseDirectory.AppConfig })) {
                const plugins = await readDir(`plugins/${serviceType}`, { dir: BaseDirectory.AppConfig });
                for (const plugin of plugins) {
                    const infoStr = await readTextFile(`plugins/${serviceType}/${plugin.name}/info.json`, {
                        dir: BaseDirectory.AppConfig,
                    });
                    let pluginInfo = JSON.parse(infoStr);
                    if ('icon' in pluginInfo) {
                        const appConfigDirPath = await appConfigDir();
                        const iconPath = await join(
                            appConfigDirPath,
                            `/plugins/${serviceType}/${plugin.name}/${pluginInfo.icon}`
                        );
                        pluginInfo.icon = convertFileSrc(iconPath);
                    }
                    temp[serviceType][plugin.name] = pluginInfo;
                }
            }
        }
        setPluginList({ ...temp });
    };

    useEffect(() => {
        loadPluginList();
        if (!unlisten) {
            unlisten = listen('reload_plugin_list', loadPluginList);
        }
    }, []);

    const loadServiceInstanceConfigMap = async () => {
        const config = {};
        for (const serviceInstanceKey of translateServiceInstanceList) {
            config[serviceInstanceKey] = (await store.get(serviceInstanceKey)) ?? {};
        }
        for (const serviceInstanceKey of recognizeServiceInstanceList) {
            config[serviceInstanceKey] = (await store.get(serviceInstanceKey)) ?? {};
        }
        for (const serviceInstanceKey of ttsServiceInstanceList) {
            config[serviceInstanceKey] = (await store.get(serviceInstanceKey)) ?? {};
        }
        for (const serviceInstanceKey of collectionServiceInstanceList) {
            config[serviceInstanceKey] = (await store.get(serviceInstanceKey)) ?? {};
        }
        setServiceInstanceConfigMap({ ...config });
    };
    useEffect(() => {
        if (
            translateServiceInstanceList !== null &&
            recognizeServiceInstanceList !== null &&
            ttsServiceInstanceList !== null &&
            collectionServiceInstanceList !== null
        ) {
            loadServiceInstanceConfigMap();
        }
    }, [
        translateServiceInstanceList,
        recognizeServiceInstanceList,
        ttsServiceInstanceList,
        collectionServiceInstanceList,
    ]);

    // Auto-resize window based on content height
    useEffect(() => {
        if (!contentRef.current) return;

        const resizeWindow = async () => {
            if (rememberWindowSize) return;

            try {
                // Wait a bit for content to render
                await new Promise(resolve => setTimeout(resolve, 100));

                const contentHeight = contentRef.current.offsetHeight;
                const headerHeight = 32;
                const minHeight = 80;
                const maxHeight = 700;

                // Calculate desired height
                let desiredHeight = Math.min(Math.max(contentHeight + headerHeight, minHeight), maxHeight);

                // Get current size
                const currentSize = await appWindow.outerSize();
                const monitor = await currentMonitor();
                const factor = monitor?.scaleFactor || 1;
                const logicalSize = currentSize.toLogical(factor);

                // Resize if needed
                if (Math.abs(logicalSize.height - desiredHeight) > 15) {
                    await appWindow.setSize(new LogicalSize(logicalSize.width, desiredHeight));
                }
            } catch (error) {
                console.error('Failed to resize window:', error);
            }
        };

        // Initial resize
        resizeWindow();

        // Watch for content changes
        const resizeObserver = new ResizeObserver(() => {
            resizeWindow();
        });

        resizeObserver.observe(contentRef.current);

        return () => {
            resizeObserver.disconnect();
        };
    }, [rememberWindowSize, translateServiceInstanceList, serviceInstanceConfigMap]);

    return (
        pluginList && (
            <div
                className={`bg-background w-screen ${
                    osType === 'Linux' && 'rounded-[10px] border-1 border-default-100'
                }`}
            >
                {/* Drag region - positioned to not overlap buttons */}
                {osType === 'Darwin' ? (
                    // macOS: drag region in center, avoiding left (system buttons) and right (our buttons)
                    <div
                        className='fixed top-[5px] left-[80px] right-[80px] h-[30px]'
                        data-tauri-drag-region='true'
                    />
                ) : (
                    // Windows/Linux: drag region in center, avoiding sides
                    <div
                        className='fixed top-[5px] left-[80px] right-[80px] h-[30px]'
                        data-tauri-drag-region='true'
                    />
                )}

                <div className={`h-[32px] w-full flex ${osType === 'Darwin' ? 'justify-between' : 'justify-between'}`}>
                    {/* Left side: Empty space on macOS (system buttons), Action buttons on Windows */}
                    <div className='flex gap-1 items-center pl-1'>
                        {osType === 'Darwin' ? (
                            // macOS: leave space for system buttons
                            <div className='w-[70px]' />
                        ) : (
                            // Windows: show action buttons on left
                            <div id='translate-actions' className='flex gap-0.5'></div>
                        )}
                    </div>

                    {/* Right side: Pin + Actions on macOS, Pin + Close on Windows */}
                    <div className='flex gap-1 items-center pr-1'>
                        {osType === 'Darwin' ? (
                            // macOS: show action buttons + pin on right
                            <>
                                <div id='translate-actions' className='flex gap-0.5 items-center'>
                                    {translateServiceInstanceList && translateServiceInstanceList[0] && (
                                        <div className='flex items-center px-1.5 py-0.5 bg-content2/50 rounded-md mr-1'>
                                            <img
                                                src={
                                                    whetherPluginService(translateServiceInstanceList[0])
                                                        ? pluginList['translate'][getServiceName(translateServiceInstanceList[0])].icon
                                                        : builtinServices[getServiceName(translateServiceInstanceList[0])].info.icon
                                                }
                                                className='h-[16px] w-[16px]'
                                                alt=''
                                            />
                                        </div>
                                    )}
                                    {headerButtons}
                                </div>
                                <Button
                                    isIconOnly
                                    size='sm'
                                    variant='light'
                                    className='h-[26px] w-[26px] min-w-0 bg-transparent'
                                    onPress={() => {
                                        if (pined) {
                                            if (closeOnBlur) {
                                                unlisten = listenBlur();
                                            }
                                            appWindow.setAlwaysOnTop(false);
                                        } else {
                                            unlistenBlur();
                                            appWindow.setAlwaysOnTop(true);
                                        }
                                        setPined(!pined);
                                    }}
                                >
                                    <BsPinFill className={`text-[16px] ${pined ? 'text-primary' : 'text-default-400'}`} />
                                </Button>
                            </>
                        ) : (
                            // Windows: show pin + close
                            <>
                                <div className='flex gap-0.5 items-center'>
                                    {translateServiceInstanceList && translateServiceInstanceList[0] && (
                                        <div className='flex items-center px-1.5 py-0.5 bg-content2/50 rounded-md mr-1'>
                                            <img
                                                src={
                                                    whetherPluginService(translateServiceInstanceList[0])
                                                        ? pluginList['translate'][getServiceName(translateServiceInstanceList[0])].icon
                                                        : builtinServices[getServiceName(translateServiceInstanceList[0])].info.icon
                                                }
                                                className='h-[16px] w-[16px]'
                                                alt=''
                                            />
                                        </div>
                                    )}
                                    {headerButtons}
                                </div>
                                <Button
                                    isIconOnly
                                    size='sm'
                                    variant='light'
                                    className='h-[26px] w-[26px] min-w-0 bg-transparent'
                                    onPress={() => {
                                        if (pined) {
                                            if (closeOnBlur) {
                                                unlisten = listenBlur();
                                            }
                                            appWindow.setAlwaysOnTop(false);
                                        } else {
                                            unlistenBlur();
                                            appWindow.setAlwaysOnTop(true);
                                        }
                                        setPined(!pined);
                                    }}
                                >
                                    <BsPinFill className={`text-[16px] ${pined ? 'text-primary' : 'text-default-400'}`} />
                                </Button>
                                <Button
                                    isIconOnly
                                    size='sm'
                                    variant='light'
                                    className='h-[26px] w-[26px] min-w-0 bg-transparent'
                                    onPress={() => {
                                        void appWindow.close();
                                    }}
                                >
                                    <AiFillCloseCircle className='text-[16px] text-default-400' />
                                </Button>
                            </>
                        )}
                    </div>
                </div>
                <div
                    ref={contentRef}
                    className='px-[6px] pb-[6px] text-[12px] flex flex-col bg-background/80 backdrop-blur-xl rounded-xl border border-content3 shadow-2xl overflow-hidden'
                >
                    {/* Source Area */}
                    <div>
                        {serviceInstanceConfigMap !== null && (
                            <SourceArea
                                pluginList={pluginList}
                                serviceInstanceConfigMap={serviceInstanceConfigMap}
                            />
                        )}
                    </div>

                    {/* Language Selector */}
                    <div className={`${hideLanguage && 'hidden'}`}>
                        <LanguageArea />
                        <Spacer y={1} />
                    </div>

                    {/* Single Active Translation Result */}
                    <div className='relative group'>
                        {translateServiceInstanceList !== null &&
                            serviceInstanceConfigMap !== null &&
                            translateServiceInstanceList.map((serviceInstanceKey, index) => {
                                const config = serviceInstanceConfigMap[serviceInstanceKey] ?? {};
                                const enable = config['enable'] ?? true;

                                // Only show the first enabled service
                                if (!enable || index !== 0) return null;

                                return (
                                    <div key={serviceInstanceKey}>
                                        <TargetArea
                                            index={index}
                                            name={serviceInstanceKey}
                                            translateServiceInstanceList={translateServiceInstanceList}
                                            pluginList={pluginList}
                                            serviceInstanceConfigMap={serviceInstanceConfigMap}
                                            setHeaderButtons={setHeaderButtons}
                                        />
                                    </div>
                                );
                            })}

                        {/* Provider Tabs - Horizontal at bottom, show on hover */}
                        <div className='absolute bottom-0 left-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-gradient-to-t from-background via-background to-transparent pt-8 pb-1 px-2'>
                            <div className='flex gap-1 justify-center items-center bg-content2/80 backdrop-blur-sm rounded-lg p-1 border border-content3'>
                                {translateServiceInstanceList !== null &&
                                    serviceInstanceConfigMap !== null &&
                                    translateServiceInstanceList.map((serviceInstanceKey, index) => {
                                        const config = serviceInstanceConfigMap[serviceInstanceKey] ?? {};
                                        const enable = config['enable'] ?? true;
                                        if (!enable) return null;

                                        const isActive = index === 0; // First one is active

                                        return (
                                            <Button
                                                key={serviceInstanceKey}
                                                size='sm'
                                                variant={isActive ? 'flat' : 'light'}
                                                className={`h-[28px] min-w-[32px] px-1.5 ${isActive ? 'bg-primary/20 border-1 border-primary/50' : ''}`}
                                                onPress={() => {
                                                    // Switch active provider
                                                    const items = Array.from(translateServiceInstanceList);
                                                    const [removed] = items.splice(index, 1);
                                                    items.unshift(removed);
                                                    setTranslateServiceInstanceList(items);
                                                }}
                                            >
                                                <img
                                                    src={
                                                        whetherPluginService(serviceInstanceKey)
                                                            ? pluginList['translate'][getServiceName(serviceInstanceKey)].icon
                                                            : builtinServices[getServiceName(serviceInstanceKey)].info.icon
                                                    }
                                                    className='h-[18px] w-[18px]'
                                                    alt=''
                                                />
                                            </Button>
                                        );
                                    })}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    );
}
