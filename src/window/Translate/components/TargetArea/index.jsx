import {
    Card,
    CardBody,
    CardHeader,
    CardFooter,
    Button,
    ButtonGroup,
    Dropdown,
    DropdownItem,
    DropdownMenu,
    DropdownTrigger,
    Tooltip,
} from '@nextui-org/react';
import { BiCollapseVertical, BiExpandVertical } from 'react-icons/bi';
import { BaseDirectory, readTextFile } from '@tauri-apps/api/fs';
import { sendNotification } from '@tauri-apps/api/notification';
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { writeText } from '@tauri-apps/api/clipboard';
import PulseLoader from 'react-spinners/PulseLoader';
import { TbTransformFilled } from 'react-icons/tb';
import { HiOutlineVolumeUp } from 'react-icons/hi';
import { semanticColors } from '@nextui-org/theme';
import toast, { Toaster } from 'react-hot-toast';
import { MdContentCopy } from 'react-icons/md';
import { useTranslation } from 'react-i18next';
import Database from 'tauri-plugin-sql-api';
import { GiCycle } from 'react-icons/gi';
import { useTheme } from 'next-themes';
import { useAtomValue } from 'jotai';
import { nanoid } from 'nanoid';
import { useSpring, animated } from '@react-spring/web';
import useMeasure from 'react-use-measure';

import * as builtinCollectionServices from '../../../../services/collection';
import { sourceLanguageAtom, targetLanguageAtom } from '../LanguageArea';
import { useConfig, useToastStyle, useVoice } from '../../../../hooks';
import { sourceTextAtom, detectLanguageAtom } from '../SourceArea';
import { invoke_plugin } from '../../../../utils/invoke_plugin';
import * as builtinServices from '../../../../services/translate';
import * as builtinTtsServices from '../../../../services/tts';

import { info, error as logError } from 'tauri-plugin-log-api';
import {
    INSTANCE_NAME_CONFIG_KEY,
    ServiceSourceType,
    getDisplayInstanceName,
    getServiceName,
    getServiceSouceType,
    whetherPluginService,
} from '../../../../utils/service_instance';

let translateID = [];

export default function TargetArea(props) {
    const { index, name, translateServiceInstanceList, pluginList, serviceInstanceConfigMap, setHeaderButtons, ...drag } = props;

    const [currentTranslateServiceInstanceKey, setCurrentTranslateServiceInstanceKey] = useState(name);
    function getInstanceName(instanceKey, serviceNameSupplier) {
        const instanceConfig = serviceInstanceConfigMap[instanceKey] ?? {};
        return getDisplayInstanceName(instanceConfig[INSTANCE_NAME_CONFIG_KEY], serviceNameSupplier);
    }

    const [appFontSize] = useConfig('app_font_size', 16);
    const [collectionServiceList] = useConfig('collection_service_list', []);
    const [ttsServiceList] = useConfig('tts_service_list', ['lingva_tts']);
    const [translateSecondLanguage] = useConfig('translate_second_language', 'en');
    const [historyDisable] = useConfig('history_disable', false);
    const [isLoading, setIsLoading] = useState(false);
    const [hide, setHide] = useState(false);

    const [result, setResult] = useState('');
    const [error, setError] = useState('');

    const sourceText = useAtomValue(sourceTextAtom);
    const sourceLanguage = useAtomValue(sourceLanguageAtom);
    const targetLanguage = useAtomValue(targetLanguageAtom);
    const [autoCopy] = useConfig('translate_auto_copy', 'disable');
    const [hideWindow] = useConfig('translate_hide_window', false);
    const [clipboardMonitor] = useConfig('clipboard_monitor', false);

    const detectLanguage = useAtomValue(detectLanguageAtom);
    const [ttsPluginInfo, setTtsPluginInfo] = useState();
    const { t } = useTranslation();
    const textAreaRef = useRef();
    const toastStyle = useToastStyle();
    const speak = useVoice();
    const theme = useTheme();

    useEffect(() => {
        if (error) {
            logError(`[${currentTranslateServiceInstanceKey}]happened error: ` + error);
        }
    }, [error]);

    // listen to translation
    useEffect(() => {
        setResult('');
        setError('');
        if (
            sourceText.trim() !== '' &&
            sourceLanguage &&
            targetLanguage &&
            autoCopy !== null &&
            hideWindow !== null &&
            clipboardMonitor !== null
        ) {
            if (autoCopy === 'source' && !clipboardMonitor) {
                writeText(sourceText).then(() => {
                    if (hideWindow) {
                        sendNotification({ title: t('common.write_clipboard'), body: sourceText });
                    }
                });
            }
            translate();
        }
    }, [
        sourceText,
        sourceLanguage,
        targetLanguage,
        autoCopy,
        hideWindow,
        currentTranslateServiceInstanceKey,
        clipboardMonitor,
    ]);

    // todo: history panel use service instance key
    const addToHistory = async (text, source, target, serviceInstanceKey, result) => {
        const db = await Database.load('sqlite:history.db');

        await db
            .execute(
                'INSERT into history (text, source, target, service, result, timestamp) VALUES ($1, $2, $3, $4, $5, $6)',
                [text, source, target, serviceInstanceKey, result, Date.now()]
            )
            .then(
                (v) => {
                    db.close();
                },
                (e) => {
                    db.execute(
                        'CREATE TABLE history(id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL,source TEXT NOT NULL,target TEXT NOT NULL,service TEXT NOT NULL, result TEXT NOT NULL,timestamp INTEGER NOT NULL)'
                    ).then(() => {
                        db.close();
                        addToHistory(text, source, target, serviceInstanceKey, result);
                    });
                }
            );
    };

    function invokeOnce(fn) {
        let isInvoke = false;

        return (...args) => {
            if (isInvoke) {
                return;
            } else {
                fn(...args);
                isInvoke = true;
            }
        };
    }

    const translate = async () => {
        let id = nanoid();
        translateID[index] = id;

        const translateServiceName = getServiceName(currentTranslateServiceInstanceKey);

        if (whetherPluginService(currentTranslateServiceInstanceKey)) {
            const pluginInfo = pluginList['translate'][translateServiceName];
            if (sourceLanguage in pluginInfo.language && targetLanguage in pluginInfo.language) {
                let newTargetLanguage = targetLanguage;
                if (sourceLanguage === 'auto' && targetLanguage === detectLanguage) {
                    newTargetLanguage = translateSecondLanguage;
                }
                setIsLoading(true);
                // setHide(true); // Removed to prevent flash animation
                const instanceConfig = serviceInstanceConfigMap[currentTranslateServiceInstanceKey];
                instanceConfig['enable'] = 'true';
                const setHideOnce = invokeOnce(setHide);
                let [func, utils] = await invoke_plugin('translate', translateServiceName);
                func(sourceText.trim(), pluginInfo.language[sourceLanguage], pluginInfo.language[newTargetLanguage], {
                    config: instanceConfig,
                    detect: detectLanguage,
                    setResult: (v) => {
                        if (translateID[index] !== id) return;
                        setResult(v);
                        setHideOnce(false);
                    },
                    utils,
                }).then(
                    (v) => {
                        info(`[${currentTranslateServiceInstanceKey}]resolve:` + v);
                        if (translateID[index] !== id) return;
                        setResult(typeof v === 'string' ? v.trim() : v);
                        setIsLoading(false);
                        if (v !== '') {
                            setHideOnce(false);
                        }
                        if (!historyDisable) {
                            addToHistory(
                                sourceText.trim(),
                                detectLanguage,
                                newTargetLanguage,
                                translateServiceName,
                                typeof v === 'string' ? v.trim() : v
                            );
                        }
                        if (index === 0 && !clipboardMonitor) {
                            switch (autoCopy) {
                                case 'target':
                                    writeText(v).then(() => {
                                        if (hideWindow) {
                                            sendNotification({ title: t('common.write_clipboard'), body: v });
                                        }
                                    });
                                    break;
                                case 'source_target':
                                    writeText(sourceText.trim() + '\n\n' + v).then(() => {
                                        if (hideWindow) {
                                            sendNotification({
                                                title: t('common.write_clipboard'),
                                                body: sourceText.trim() + '\n\n' + v,
                                            });
                                        }
                                    });
                                    break;
                                default:
                                    break;
                            }
                        }
                    },
                    (e) => {
                        info(`[${currentTranslateServiceInstanceKey}]reject:` + e);
                        if (translateID[index] !== id) return;
                        setError(e.toString());
                        setIsLoading(false);
                    }
                );
            } else {
                setError('Language not supported');
            }
        } else {
            const LanguageEnum = builtinServices[translateServiceName].Language;
            if (sourceLanguage in LanguageEnum && targetLanguage in LanguageEnum) {
                let newTargetLanguage = targetLanguage;
                if (sourceLanguage === 'auto' && targetLanguage === detectLanguage) {
                    newTargetLanguage = translateSecondLanguage;
                }
                setIsLoading(true);
                // setHide(true); // Removed to prevent flash animation
                const instanceConfig = serviceInstanceConfigMap[currentTranslateServiceInstanceKey];
                const setHideOnce = invokeOnce(setHide);
                builtinServices[translateServiceName]
                    .translate(sourceText.trim(), LanguageEnum[sourceLanguage], LanguageEnum[newTargetLanguage], {
                        config: instanceConfig,
                        detect: detectLanguage,
                        setResult: (v) => {
                            if (translateID[index] !== id) return;
                            setResult(v);
                            setHideOnce(false);
                        },
                    })
                    .then(
                        (v) => {
                            info(`[${currentTranslateServiceInstanceKey}]resolve:` + v);
                            if (translateID[index] !== id) return;
                            setResult(typeof v === 'string' ? v.trim() : v);
                            setIsLoading(false);
                            if (v !== '') {
                                setHideOnce(false);
                            }
                            if (!historyDisable) {
                                addToHistory(
                                    sourceText.trim(),
                                    detectLanguage,
                                    newTargetLanguage,
                                    translateServiceName,
                                    typeof v === 'string' ? v.trim() : v
                                );
                            }
                            if (index === 0 && !clipboardMonitor) {
                                switch (autoCopy) {
                                    case 'target':
                                        writeText(v).then(() => {
                                            if (hideWindow) {
                                                sendNotification({ title: t('common.write_clipboard'), body: v });
                                            }
                                        });
                                        break;
                                    case 'source_target':
                                        writeText(sourceText.trim() + '\n\n' + v).then(() => {
                                            if (hideWindow) {
                                                sendNotification({
                                                    title: t('common.write_clipboard'),
                                                    body: sourceText.trim() + '\n\n' + v,
                                                });
                                            }
                                        });
                                        break;
                                    default:
                                        break;
                                }
                            }
                        },
                        (e) => {
                            info(`[${currentTranslateServiceInstanceKey}]reject:` + e);
                            if (translateID[index] !== id) return;
                            setError(e.toString());
                            setIsLoading(false);
                        }
                    );
            } else {
                setError('Language not supported');
            }
        }
    };

    // hide empty textarea
    useEffect(() => {
        if (textAreaRef.current !== null) {
            textAreaRef.current.style.height = '0px';
            if (result !== '') {
                textAreaRef.current.style.height = textAreaRef.current.scrollHeight + 'px';
            }
        }
    }, [result]);

    // refresh tts config
    useEffect(() => {
        if (ttsServiceList && getServiceSouceType(ttsServiceList[0]) === ServiceSourceType.PLUGIN) {
            readTextFile(`plugins/tts/${getServiceName(ttsServiceList[0])}/info.json`, {
                dir: BaseDirectory.AppConfig,
            }).then((infoStr) => {
                setTtsPluginInfo(JSON.parse(infoStr));
            });
        }
    }, [ttsServiceList]);

    // handle tts speak
    const handleSpeak = async () => {
        const instanceKey = ttsServiceList[0];
        if (getServiceSouceType(instanceKey) === ServiceSourceType.PLUGIN) {
            const pluginConfig = serviceInstanceConfigMap[instanceKey];
            if (!(targetLanguage in ttsPluginInfo.language)) {
                throw new Error('Language not supported');
            }
            let [func, utils] = await invoke_plugin('tts', getServiceName(instanceKey));
            let data = await func(result, ttsPluginInfo.language[targetLanguage], {
                config: pluginConfig,
                utils,
            });
            speak(data);
        } else {
            if (!(targetLanguage in builtinTtsServices[getServiceName(instanceKey)].Language)) {
                throw new Error('Language not supported');
            }
            const instanceConfig = serviceInstanceConfigMap[instanceKey];
            let data = await builtinTtsServices[getServiceName(instanceKey)].tts(
                result,
                builtinTtsServices[getServiceName(instanceKey)].Language[targetLanguage],
                {
                    config: instanceConfig,
                }
            );
            speak(data);
        }
    };

    const [boundRef, bounds] = useMeasure({ scroll: true });
    const previousHide = useRef(hide);
    
    useEffect(() => {
        previousHide.current = hide;
    }, [hide]);

    const springs = useSpring({
        from: { height: 0 },
        to: { height: hide ? 0 : bounds.height },
        immediate: (key) => key === 'height' && previousHide.current === hide,
    });

    const headerButtonsContent = useMemo(() => (
        <div className='flex gap-0.5'>
            {/* speak button */}
            <Tooltip content={t('translate.speak')}>
                <Button
                    isIconOnly
                    variant='light'
                    size='sm'
                    isDisabled={typeof result !== 'string' || result === ''}
                    className='h-[26px] w-[26px] min-w-0 bg-transparent'
                    onPress={() => {
                        handleSpeak().catch((e) => {
                            toast.error(e.toString(), { style: toastStyle });
                        });
                    }}
                >
                    <HiOutlineVolumeUp className='text-[16px]' />
                </Button>
            </Tooltip>
            {/* copy button */}
            <Tooltip content={t('translate.copy')}>
                <Button
                    isIconOnly
                    variant='light'
                    size='sm'
                    isDisabled={typeof result !== 'string' || result === ''}
                    className='h-[26px] w-[26px] min-w-0 bg-transparent'
                    onPress={() => {
                        writeText(result);
                    }}
                >
                    <MdContentCopy className='text-[16px]' />
                </Button>
            </Tooltip>
            {/* translate back button */}
            <Tooltip content={t('translate.translate_back')}>
                <Button
                    isIconOnly
                    variant='light'
                    size='sm'
                    isDisabled={typeof result !== 'string' || result === ''}
                    className='h-[26px] w-[26px] min-w-0 bg-transparent'
                    onPress={async () => {
                        setError('');
                        let newTargetLanguage = sourceLanguage;
                        if (sourceLanguage === 'auto') {
                            newTargetLanguage = detectLanguage;
                        }
                        let newSourceLanguage = targetLanguage;
                        if (sourceLanguage === 'auto') {
                            newSourceLanguage = 'auto';
                        }
                        if (whetherPluginService(currentTranslateServiceInstanceKey)) {
                            const pluginInfo =
                                pluginList['translate'][
                                    getServiceName(currentTranslateServiceInstanceKey)
                                ];
                            if (
                                newSourceLanguage in pluginInfo.language &&
                                newTargetLanguage in pluginInfo.language
                            ) {
                                setIsLoading(true);
                                // setHide(true); // Removed to prevent flash animation
                                const instanceConfig =
                                    serviceInstanceConfigMap[currentTranslateServiceInstanceKey];
                                instanceConfig['enable'] = 'true';
                                const setHideOnce = invokeOnce(setHide);
                                let [func, utils] = await invoke_plugin(
                                    'translate',
                                    getServiceName(currentTranslateServiceInstanceKey)
                                );
                                func(
                                    result.trim(),
                                    pluginInfo.language[newSourceLanguage],
                                    pluginInfo.language[newTargetLanguage],
                                    {
                                        config: instanceConfig,
                                        detect: detectLanguage,
                                        setResult: (v) => {
                                            setResult(v);
                                            setHideOnce(false);
                                        },
                                        utils,
                                    }
                                ).then(
                                    (v) => {
                                        if (v === result) {
                                            setResult(v + ' ');
                                        } else {
                                            setResult(v.trim());
                                        }
                                        setIsLoading(false);
                                        if (v !== '') {
                                            setHideOnce(false);
                                        }
                                    },
                                    (e) => {
                                        setError(e.toString());
                                        setIsLoading(false);
                                    }
                                );
                            } else {
                                setError('Language not supported');
                            }
                        } else {
                            const LanguageEnum =
                                builtinServices[getServiceName(currentTranslateServiceInstanceKey)]
                                    .Language;
                            if (
                                newSourceLanguage in LanguageEnum &&
                                newTargetLanguage in LanguageEnum
                            ) {
                                setIsLoading(true);
                                // setHide(true); // Removed to prevent flash animation
                                const instanceConfig =
                                    serviceInstanceConfigMap[currentTranslateServiceInstanceKey];
                                const setHideOnce = invokeOnce(setHide);
                                builtinServices[getServiceName(currentTranslateServiceInstanceKey)]
                                    .translate(
                                        result.trim(),
                                        LanguageEnum[newSourceLanguage],
                                        LanguageEnum[newTargetLanguage],
                                        {
                                            config: instanceConfig,
                                            detect: newSourceLanguage,
                                            setResult: (v) => {
                                                setResult(v);
                                                setHideOnce(false);
                                            },
                                        }
                                    )
                                    .then(
                                        (v) => {
                                            if (v === result) {
                                                setResult(v + ' ');
                                            } else {
                                                setResult(v.trim());
                                            }
                                            setIsLoading(false);
                                            if (v !== '') {
                                                setHideOnce(false);
                                            }
                                        },
                                        (e) => {
                                            setError(e.toString());
                                            setIsLoading(false);
                                        }
                                    );
                            } else {
                                setError('Language not supported');
                            }
                        }
                    }}
                >
                    <TbTransformFilled className='text-[16px]' />
                </Button>
            </Tooltip>
            {/* error retry button */}
            <Tooltip content={t('translate.retry')}>
                <Button
                    isIconOnly
                    variant='light'
                    size='sm'
                    className={`${error === '' ? 'hidden' : 'h-[26px] w-[26px] min-w-0 bg-transparent'}`}
                    onPress={() => {
                        setError('');
                        setResult('');
                        translate();
                    }}
                >
                    <GiCycle className='text-[16px]' />
                </Button>
            </Tooltip>
            {/* available collection service instance */}
            {collectionServiceList &&
                collectionServiceList.map((collectionServiceInstanceName) => {
                    return (
                        <Button
                            key={collectionServiceInstanceName}
                            isIconOnly
                            variant='light'
                            size='sm'
                            className='h-[26px] w-[26px] min-w-0 bg-transparent'
                            onPress={async () => {
                                if (
                                    getServiceSouceType(collectionServiceInstanceName) ===
                                    ServiceSourceType.PLUGIN
                                ) {
                                    const pluginConfig =
                                        serviceInstanceConfigMap[collectionServiceInstanceName];
                                    let [func, utils] = await invoke_plugin(
                                        'collection',
                                        getServiceName(collectionServiceInstanceName)
                                    );
                                    func(sourceText.trim(), result.toString(), {
                                        config: pluginConfig,
                                        utils,
                                    }).then(
                                        (_) => {
                                            toast.success(t('translate.add_collection_success'), {
                                                style: toastStyle,
                                            });
                                        },
                                        (e) => {
                                            toast.error(e.toString(), { style: toastStyle });
                                        }
                                    );
                                } else {
                                    const instanceConfig =
                                        serviceInstanceConfigMap[collectionServiceInstanceName];
                                    builtinCollectionServices[
                                        getServiceName(collectionServiceInstanceName)
                                    ]
                                        .collection(sourceText, result, {
                                            config: instanceConfig,
                                        })
                                        .then(
                                            (_) => {
                                                toast.success(t('translate.add_collection_success'), {
                                                    style: toastStyle,
                                                });
                                            },
                                            (e) => {
                                                toast.error(e.toString(), { style: toastStyle });
                                            }
                                        );
                                }
                            }}
                        >
                            <img
                                src={
                                    getServiceSouceType(collectionServiceInstanceName) ===
                                    ServiceSourceType.PLUGIN
                                        ? pluginList['collection'][
                                                getServiceName(collectionServiceInstanceName)
                                            ].icon
                                        : builtinCollectionServices[
                                                getServiceName(collectionServiceInstanceName)
                                            ].info.icon
                                }
                                className='h-[16px] w-[16px]'
                            />
                        </Button>
                    );
                })}
        </div>
    ), [result, error, isLoading, currentTranslateServiceInstanceKey, sourceLanguage, targetLanguage, detectLanguage, collectionServiceList, t, toastStyle]);

    useEffect(() => {
        setHeaderButtons(headerButtonsContent);
    }, [headerButtonsContent, setHeaderButtons]);

    return (
        <Card
            shadow='none'
            className='rounded-[10px] max-w-[800px] w-full p-0'
        >
            <Toaster />
            <animated.div style={{ ...springs }}>
                <div ref={boundRef}>
                    {/* result content */}
                    <CardBody className={`p-[8px] ${hide && 'h-0 p-0'}`}>
                        {isLoading && (!result || result === '') ? (
                            <div className='flex justify-center items-center py-4 text-default-400 text-sm select-none'>
                                {t('translate.loading')}
                            </div>
                        ) : typeof result === 'string' ? (
                            <textarea
                                ref={textAreaRef}
                                className={`text-[14px] h-0 resize-none bg-transparent select-text outline-none`}
                                readOnly
                                value={result}
                            />
                        ) : (
                            <div>
                                {result['pronunciations'] &&
                                    result['pronunciations'].map((pronunciation) => {
                                        return (
                                            <div key={nanoid()}>
                                                {pronunciation['region'] && (
                                                    <span
                                                        className={`text-[${appFontSize}px] mr-[12px] text-default-500`}
                                                    >
                                                        {pronunciation['region']}
                                                    </span>
                                                )}
                                                {pronunciation['symbol'] && (
                                                    <span
                                                        className={`text-[${appFontSize}px] mr-[12px] text-default-500`}
                                                    >
                                                        {pronunciation['symbol']}
                                                    </span>
                                                )}
                                                {pronunciation['voice'] && pronunciation['voice'] !== '' && (
                                                    <HiOutlineVolumeUp
                                                        className={`text-[${appFontSize}px] inline-block my-auto cursor-pointer`}
                                                        onClick={() => {
                                                            speak(pronunciation['voice']);
                                                        }}
                                                    />
                                                )}
                                            </div>
                                        );
                                    })}
                                {result['explanations'] &&
                                    result['explanations'].map((explanations) => {
                                        return (
                                            <div key={nanoid()}>
                                                {explanations['explains'] &&
                                                    explanations['explains'].map((explain, index) => {
                                                        return (
                                                            <span key={nanoid()}>
                                                                {index === 0 ? (
                                                                    <>
                                                                        <span
                                                                            className={`text-[${appFontSize - 2}px] text-default-500 mr-[12px]`}
                                                                        >
                                                                            {explanations['trait']}
                                                                        </span>
                                                                        <span
                                                                            className={`font-bold text-[${appFontSize}px] select-text`}
                                                                        >
                                                                            {explain}
                                                                        </span>
                                                                        <br />
                                                                    </>
                                                                ) : (
                                                                    <span
                                                                        className={`text-[${appFontSize - 2}px] text-default-500 select-text mr-1`}
                                                                        key={nanoid()}
                                                                    >
                                                                        {explain}
                                                                    </span>
                                                                )}
                                                            </span>
                                                        );
                                                    })}
                                            </div>
                                        );
                                    })}
                                <br />
                                {result['associations'] &&
                                    result['associations'].map((association) => {
                                        return (
                                            <div key={nanoid()}>
                                                <span className={`text-[${appFontSize}px] text-default-500`}>
                                                    {association}
                                                </span>
                                            </div>
                                        );
                                    })}
                                {result['sentence'] &&
                                    result['sentence'].map((sentence, index) => {
                                        return (
                                            <div key={nanoid()}>
                                                <span className={`text-[${appFontSize - 2}px] mr-[12px]`}>
                                                    {index + 1}.
                                                </span>
                                                <>
                                                    {sentence['source'] && (
                                                        <span
                                                            className={`text-[${appFontSize}px] select-text`}
                                                            dangerouslySetInnerHTML={{
                                                                __html: sentence['source'],
                                                            }}
                                                        />
                                                    )}
                                                </>
                                                <>
                                                    {sentence['target'] && (
                                                        <div
                                                            className={`text-[${appFontSize}px] select-text text-default-500`}
                                                            dangerouslySetInnerHTML={{
                                                                __html: sentence['target'],
                                                            }}
                                                        />
                                                    )}
                                                </>
                                            </div>
                                        );
                                    })}
                            </div>
                        )}
                        {error !== '' ? (
                            error.split('\n').map((v) => {
                                return (
                                    <p
                                        key={v}
                                        className={`text-[${appFontSize}px] text-red-500`}
                                    >
                                        {v}
                                    </p>
                                );
                            })
                        ) : (
                            <></>
                        )}
                    </CardBody>
                </div>
            </animated.div>
        </Card>
    );
}
