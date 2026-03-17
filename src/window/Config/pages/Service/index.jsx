import { readDir, BaseDirectory, readTextFile, exists } from '@tauri-apps/api/fs';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { Tabs, Tab } from '@nextui-org/react';
import { appConfigDir, join } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import React, { useEffect, useState, Component } from 'react';

class TabErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }
    static getDerivedStateFromError(error) {
        return { error };
    }
    componentDidCatch(error, info) {
        console.error('[Service tab error]', error, info);
    }
    render() {
        if (this.state.error) {
            return (
                <div className='flex flex-col items-center justify-center h-full gap-2 text-danger'>
                    <p className='text-sm font-medium'>Failed to load tab</p>
                    <p className='text-xs text-default-400'>{this.state.error.message}</p>
                    <button
                        className='text-xs text-primary underline'
                        onClick={() => this.setState({ error: null })}
                    >
                        Retry
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
import Translate from './Translate';
import Recognize from './Recognize';
import Collection from './Collection';
import Tts from './Tts';
import Ai from './Ai';
import { ServiceType } from '../../../../utils/service_instance';

let unlisten = null;

export default function Service() {
    const [pluginList, setPluginList] = useState(null);
    const { t } = useTranslation();

    const loadPluginList = async () => {
        const serviceTypeList = ['translate', 'tts', 'recognize', 'collection', 'ai'];
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
        if (unlisten) {
            unlisten.then((f) => {
                f();
            });
        }
        unlisten = listen('reload_plugin_list', loadPluginList);
        return () => {
            if (unlisten) {
                unlisten.then((f) => {
                    f();
                });
            }
        };
    }, []);
    return (
        pluginList !== null && (
            <Tabs className='flex justify-center max-h-[calc(100%-40px)] overflow-y-auto'>
                <Tab key='translate' title={t(`config.service.translate`)}>
                    <TabErrorBoundary key='translate'>
                        <Translate pluginList={pluginList[ServiceType.TRANSLATE]} />
                    </TabErrorBoundary>
                </Tab>
                <Tab key='recognize' title={t(`config.service.recognize`)}>
                    <TabErrorBoundary key='recognize'>
                        <Recognize pluginList={pluginList[ServiceType.RECOGNIZE]} />
                    </TabErrorBoundary>
                </Tab>
                <Tab key='tts' title={t(`config.service.tts`)}>
                    <TabErrorBoundary key='tts'>
                        <Tts pluginList={pluginList[ServiceType.TTS]} />
                    </TabErrorBoundary>
                </Tab>
                <Tab key='collection' title={t(`config.service.collection`)}>
                    <TabErrorBoundary key='collection'>
                        <Collection pluginList={pluginList[ServiceType.COLLECTION]} />
                    </TabErrorBoundary>
                </Tab>
                <Tab key='ai' title={t(`config.service.ai.label`)}>
                    <TabErrorBoundary key='ai'>
                        <Ai pluginList={pluginList[ServiceType.AI] ?? {}} />
                    </TabErrorBoundary>
                </Tab>
            </Tabs>
        )
    );
}
