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
import { IoMdCheckmark } from 'react-icons/io';

import LanguageArea from './components/LanguageArea';
import SourceArea, { windowTypeAtom } from './components/SourceArea';
import TargetArea from './components/TargetArea';
import { useAtomValue } from 'jotai';
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
    const [fixedProviders] = useConfig('selection_translate_fixed_providers', false);
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
    const [selectedProviderIndex, setSelectedProviderIndex] = useState(0);
    const contentRef = useRef(null);
    const windowType = useAtomValue(windowTypeAtom);
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
    // Reset selected provider index if out of bounds or provider list changes
    useEffect(() => {
        if (translateServiceInstanceList && serviceInstanceConfigMap) {
            const enabledProviders = translateServiceInstanceList.filter(key => {
                const config = serviceInstanceConfigMap[key] ?? {};
                return config['enable'] ?? true;
            });

            // If selected index is out of bounds or provider is disabled, reset to first enabled
            if (selectedProviderIndex >= translateServiceInstanceList.length ||
                !enabledProviders.includes(translateServiceInstanceList[selectedProviderIndex])) {
                setSelectedProviderIndex(0);
            }
        }
    }, [translateServiceInstanceList, serviceInstanceConfigMap]);

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

    // Auto-resize window based on content height and width
    useEffect(() => {
        if (!contentRef.current) return;

        const resizeWindow = async () => {
            if (rememberWindowSize) return;

            try {
                // Wait a bit for content to render
                await new Promise(resolve => setTimeout(resolve, 100));

                const contentHeight = contentRef.current.offsetHeight;
                const contentWidth = contentRef.current.scrollWidth;
                const headerHeight = 32;

                // Get monitor size for responsive max values
                const monitor = await currentMonitor();
                const monitorHeight = monitor?.size?.height || 1080;
                const monitorWidth = monitor?.size?.width || 1920;
                const factor = monitor?.scaleFactor || 1;

                // Calculate responsive max sizes - generous limits for long content
                // 85% of monitor height, 75% of monitor width
                const maxHeight = Math.min(1200, Math.floor((monitorHeight / factor) * 0.85));
                const minHeight = 80; // Reduced for short content to avoid extra white space

                // Dynamic width based on content - wider for better readability
                const minWidth = 500;
                const maxWidth = Math.min(1200, Math.floor((monitorWidth / factor) * 0.75));

                // Calculate desired dimensions
                let desiredHeight = Math.min(Math.max(contentHeight + headerHeight, minHeight), maxHeight);
                let desiredWidth = Math.min(Math.max(contentWidth + 20, minWidth), maxWidth);

                // Get current size
                const currentSize = await appWindow.outerSize();
                const logicalSize = currentSize.toLogical(factor);

                // Resize if needed (with threshold to avoid micro-adjustments)
                const needsResize =
                    Math.abs(logicalSize.height - desiredHeight) > 15 ||
                    Math.abs(logicalSize.width - desiredWidth) > 20;

                if (needsResize) {
                    await appWindow.setSize(new LogicalSize(desiredWidth, desiredHeight));
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

                    {/* Translation Results Section - Different layout based on window type */}
                    {windowType === '[INPUT_TRANSLATE]' ? (
                        // INPUT mode: Tabs always visible at bottom
                        <div className='flex flex-col gap-2'>
                            {/* Active Translation Result */}
                            <div>
                                {translateServiceInstanceList !== null &&
                                    serviceInstanceConfigMap !== null &&
                                    translateServiceInstanceList.map((serviceInstanceKey, index) => {
                                        const config = serviceInstanceConfigMap[serviceInstanceKey] ?? {};
                                        const enable = config['enable'] ?? true;

                                        // Only show the selected service
                                        if (!enable || index !== selectedProviderIndex) return null;

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
                            </div>

                            {/* Provider Tabs - Always visible */}
                            {translateServiceInstanceList !== null &&
                                serviceInstanceConfigMap !== null &&
                                translateServiceInstanceList.filter(key => {
                                    const config = serviceInstanceConfigMap[key] ?? {};
                                    return config['enable'] ?? true;
                                }).length > 1 && (
                                    <div className='flex justify-center pb-1 px-2'>
                                        <div className='flex gap-1 justify-center items-center bg-content2/60 backdrop-blur-sm rounded-lg p-1 border border-content3/50 hover:bg-content2/90 hover:border-content3 transition-all duration-200'>
                                            {translateServiceInstanceList.map((serviceInstanceKey, index) => {
                                                const config = serviceInstanceConfigMap[serviceInstanceKey] ?? {};
                                                const enable = config['enable'] ?? true;
                                                if (!enable) return null;

                                                const isActive = index === selectedProviderIndex;

                                                return (
                                                    <Button
                                                        key={serviceInstanceKey}
                                                        size='sm'
                                                        variant='light'
                                                        className={`relative h-[28px] min-w-[32px] px-1.5 ${
                                                            isActive
                                                                ? 'border-2 border-primary'
                                                                : 'border-1 border-transparent hover:border-default-300'
                                                        }`}
                                                        onPress={() => {
                                                            setSelectedProviderIndex(index);
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
                                                        {isActive && (
                                                            <div className='absolute -top-0.5 -right-0.5 bg-primary rounded-full w-3.5 h-3.5 flex items-center justify-center'>
                                                                <IoMdCheckmark className='text-white text-[10px]' />
                                                            </div>
                                                        )}
                                                    </Button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                        </div>
                    ) : (
                        // SELECTION/IMAGE mode: Tabs on hover (absolute positioned)
                        <div className='relative group'>
                            <div className={
                                translateServiceInstanceList !== null &&
                                serviceInstanceConfigMap !== null &&
                                translateServiceInstanceList.filter(key => {
                                    const config = serviceInstanceConfigMap[key] ?? {};
                                    return config['enable'] ?? true;
                                }).length > 1
                                    ? 'pb-14'
                                    : ''
                            }>
                                {translateServiceInstanceList !== null &&
                                    serviceInstanceConfigMap !== null &&
                                    translateServiceInstanceList.map((serviceInstanceKey, index) => {
                                        const config = serviceInstanceConfigMap[serviceInstanceKey] ?? {};
                                        const enable = config['enable'] ?? true;

                                        // Only show the selected service
                                        if (!enable || index !== selectedProviderIndex) return null;

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
                            </div>

                            {/* Provider Tabs - Show on hover or always (based on config) */}
                            {translateServiceInstanceList !== null &&
                                serviceInstanceConfigMap !== null &&
                                translateServiceInstanceList.filter(key => {
                                    const config = serviceInstanceConfigMap[key] ?? {};
                                    return config['enable'] ?? true;
                                }).length > 1 && (
                                    <div className={`absolute bottom-0 left-0 right-0 ${fixedProviders ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity duration-200 pt-1.5 pb-1`}>
                                        <div className='flex justify-center'>
                                            <div className='flex gap-1 items-center bg-content2/80 backdrop-blur-sm rounded-lg p-1 border border-content3'>
                                            {translateServiceInstanceList.map((serviceInstanceKey, index) => {
                                                const config = serviceInstanceConfigMap[serviceInstanceKey] ?? {};
                                                const enable = config['enable'] ?? true;
                                                if (!enable) return null;

                                                const isActive = index === selectedProviderIndex;

                                                return (
                                                    <Button
                                                        key={serviceInstanceKey}
                                                        size='sm'
                                                        variant='light'
                                                        className={`relative h-[28px] min-w-[32px] px-1.5 ${
                                                            isActive
                                                                ? 'border-2 border-primary'
                                                                : 'border-1 border-transparent hover:border-default-300'
                                                        }`}
                                                        onPress={() => {
                                                            setSelectedProviderIndex(index);
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
                                                        {isActive && (
                                                            <div className='absolute -top-0.5 -right-0.5 bg-primary rounded-full w-3.5 h-3.5 flex items-center justify-center'>
                                                                <IoMdCheckmark className='text-white text-[10px]' />
                                                            </div>
                                                        )}
                                                    </Button>
                                                );
                                            })}
                                            </div>
                                        </div>
                                    </div>
                                )}
                        </div>
                    )}
                </div>
            </div>
        )
    );
}
