import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { Card, Spacer, Button, useDisclosure } from '@nextui-org/react';
import toast, { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';

import { useToastStyle } from '../../../../../hooks';
import { osType } from '../../../../../utils/env';
import { useConfig, deleteKey } from '../../../../../hooks';
import ServiceItem from './ServiceItem';
import SelectModal from './SelectModal';
import ConfigModal from './ConfigModal';

export default function Transcription(props) {
    const { pluginList } = props;
    const { isOpen: isSelectOpen, onOpen: onSelectOpen, onOpenChange: onSelectOpenChange } = useDisclosure();
    const { isOpen: isConfigOpen, onOpen: onConfigOpen, onOpenChange: onConfigOpenChange } = useDisclosure();
    const [currentConfigKey, setCurrentConfigKey] = useState('deepgram_stt');
    const [transcriptionServiceList, setTranscriptionServiceList] = useConfig('transcription_service_list', ['deepgram_stt']);

    const { t } = useTranslation();
    const toastStyle = useToastStyle();

    const reorder = (list, startIndex, endIndex) => {
        const result = Array.from(list);
        const [removed] = result.splice(startIndex, 1);
        result.splice(endIndex, 0, removed);
        return result;
    };

    const onDragEnd = (result) => {
        if (!result.destination) return;
        const items = reorder(transcriptionServiceList, result.source.index, result.destination.index);
        setTranscriptionServiceList(items);
    };

    const deleteServiceInstance = (instanceKey) => {
        if (transcriptionServiceList.length === 1) {
            toast.error(t('config.service.least'), { style: toastStyle });
            return;
        }
        setTranscriptionServiceList(transcriptionServiceList.filter((x) => x !== instanceKey));
        deleteKey(instanceKey);
    };

    const updateServiceInstanceList = (instanceKey) => {
        if (transcriptionServiceList.includes(instanceKey)) return;
        setTranscriptionServiceList([...transcriptionServiceList, instanceKey]);
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
                                {transcriptionServiceList !== null &&
                                    transcriptionServiceList.map((x, i) => (
                                        <Draggable key={x} draggableId={x} index={i}>
                                            {(provided) => (
                                                <div ref={provided.innerRef} {...provided.draggableProps}>
                                                    <ServiceItem
                                                        {...provided.dragHandleProps}
                                                        serviceInstanceKey={x}
                                                        key={x}
                                                        pluginList={pluginList ?? {}}
                                                        deleteServiceInstance={deleteServiceInstance}
                                                        setCurrentConfigKey={setCurrentConfigKey}
                                                        onConfigOpen={onConfigOpen}
                                                    />
                                                    <Spacer y={2} />
                                                </div>
                                            )}
                                        </Draggable>
                                    ))}
                                {provided.placeholder}
                            </div>
                        )}
                    </Droppable>
                </DragDropContext>
                <Spacer y={2} />
                <div className='flex'>
                    <Button fullWidth onPress={onSelectOpen}>
                        {t('config.service.add_builtin_service')}
                    </Button>
                </div>
            </Card>
            <SelectModal
                isOpen={isSelectOpen}
                onOpenChange={onSelectOpenChange}
                setCurrentConfigKey={setCurrentConfigKey}
                onConfigOpen={onConfigOpen}
            />
            <ConfigModal
                serviceInstanceKey={currentConfigKey}
                isOpen={isConfigOpen}
                pluginList={pluginList ?? {}}
                onOpenChange={onConfigOpenChange}
                updateServiceInstanceList={updateServiceInstanceList}
            />
        </>
    );
}
