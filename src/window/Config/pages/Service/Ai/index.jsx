import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { Card, Spacer, Button, useDisclosure } from '@nextui-org/react';
import toast, { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';

import { useToastStyle } from '../../../../../hooks';
import SelectPluginModal from '../SelectPluginModal';
import { osType } from '../../../../../utils/env';
import { useConfig, deleteKey } from '../../../../../hooks';
import ServiceItem from './ServiceItem';
import SelectModal from './SelectModal';
import ConfigModal from './ConfigModal';

export default function Ai(props) {
    const { pluginList } = props;
    const {
        isOpen: isSelectPluginOpen,
        onOpen: onSelectPluginOpen,
        onOpenChange: onSelectPluginOpenChange,
    } = useDisclosure();
    const { isOpen: isSelectOpen, onOpen: onSelectOpen, onOpenChange: onSelectOpenChange } = useDisclosure();
    const { isOpen: isConfigOpen, onOpen: onConfigOpen, onOpenChange: onConfigOpenChange } = useDisclosure();
    const [currentConfigKey, setCurrentConfigKey] = useState('openai_compat_ai');

    const [aiServiceInstanceList, setAiServiceInstanceList] = useConfig('ai_service_list', ['transkit_cloud_ai']);

    const { t } = useTranslation();
    const toastStyle = useToastStyle();

    const reorder = (list, startIndex, endIndex) => {
        const result = Array.from(list);
        const [removed] = result.splice(startIndex, 1);
        result.splice(endIndex, 0, removed);
        return result;
    };

    const onDragEnd = async (result) => {
        if (!result.destination) return;
        const items = reorder(aiServiceInstanceList, result.source.index, result.destination.index);
        setAiServiceInstanceList(items);
    };

    const deleteServiceInstance = (instanceKey) => {
        setAiServiceInstanceList(aiServiceInstanceList.filter((x) => x !== instanceKey));
        deleteKey(instanceKey);
    };

    const updateServiceInstanceList = (instanceKey) => {
        if (aiServiceInstanceList.includes(instanceKey)) return;
        setAiServiceInstanceList([...aiServiceInstanceList, instanceKey]);
    };

    return (
        <>
            <Toaster />
            <Card
                className={`${
                    osType === 'Linux' ? 'h-[calc(100vh-140px)]' : 'h-[calc(100vh-120px)]'
                } overflow-y-auto p-5 flex justify-between`}
            >
                <DragDropContext onDragEnd={onDragEnd}>
                    <Droppable droppableId='droppable' direction='vertical'>
                        {(provided) => (
                            <div
                                className='overflow-y-auto h-full'
                                ref={provided.innerRef}
                                {...provided.droppableProps}
                            >
                                {aiServiceInstanceList !== null && aiServiceInstanceList.length === 0 && (
                                    <div className='flex flex-col items-center justify-center h-full gap-2 text-default-400'>
                                        <p className='text-sm'>{t('config.service.ai.empty')}</p>
                                    </div>
                                )}
                                {aiServiceInstanceList !== null &&
                                    aiServiceInstanceList.map((x, i) => (
                                        <Draggable key={x} draggableId={x} index={i}>
                                            {(provided) => (
                                                <div ref={provided.innerRef} {...provided.draggableProps}>
                                                    <ServiceItem
                                                        {...provided.dragHandleProps}
                                                        serviceInstanceKey={x}
                                                        key={x}
                                                        pluginList={pluginList}
                                                        deleteServiceInstance={deleteServiceInstance}
                                                        setCurrentConfigKey={setCurrentConfigKey}
                                                        onConfigOpen={onConfigOpen}
                                                    />
                                                    <Spacer y={2} />
                                                </div>
                                            )}
                                        </Draggable>
                                    ))}
                            </div>
                        )}
                    </Droppable>
                </DragDropContext>
                <Spacer y={2} />
                <div className='flex'>
                    <Button fullWidth onPress={onSelectOpen}>
                        {t('config.service.add_builtin_service')}
                    </Button>
                    <Spacer x={2} />
                    <Button fullWidth onPress={onSelectPluginOpen}>
                        {t('config.service.add_external_service')}
                    </Button>
                </div>
            </Card>
            <SelectPluginModal
                isOpen={isSelectPluginOpen}
                onOpenChange={onSelectPluginOpenChange}
                setCurrentConfigKey={setCurrentConfigKey}
                onConfigOpen={onConfigOpen}
                pluginType='ai'
                pluginList={pluginList}
                deleteService={deleteServiceInstance}
            />
            <SelectModal
                isOpen={isSelectOpen}
                onOpenChange={onSelectOpenChange}
                setCurrentConfigKey={setCurrentConfigKey}
                onConfigOpen={onConfigOpen}
            />
            <ConfigModal
                serviceInstanceKey={currentConfigKey}
                isOpen={isConfigOpen}
                pluginList={pluginList}
                onOpenChange={onConfigOpenChange}
                updateServiceInstanceList={updateServiceInstanceList}
            />
        </>
    );
}
