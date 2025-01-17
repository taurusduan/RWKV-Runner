import React, { FC, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import Draggable from 'react-draggable';
import { ToolTipButton } from '../../components/ToolTipButton';
import { v4 as uuid } from 'uuid';
import {
  Add16Regular,
  ArrowAutofitWidth20Regular,
  Delete16Regular,
  MusicNote220Regular,
  Pause16Regular,
  Play16Filled,
  Play16Regular,
  Record16Regular,
  Stop16Filled
} from '@fluentui/react-icons';
import { Button, Card, DialogTrigger, Slider, Text, Tooltip } from '@fluentui/react-components';
import { useWindowSize } from 'usehooks-ts';
import commonStore from '../../stores/commonStore';
import classnames from 'classnames';
import {
  InstrumentTypeNameMap,
  InstrumentTypeTokenMap,
  MidiMessage,
  tracksMinimalTotalTime
} from '../../types/composition';
import { toast } from 'react-toastify';
import { ToastOptions } from 'react-toastify/dist/types';
import { flushMidiRecordingContent, refreshTracksTotalTime } from '../../utils';
import { PlayNote } from '../../../wailsjs/go/backend_golang/App';
import { t } from 'i18next';

const snapValue = 25;
const minimalMoveTime = 8; // 1000/125=8ms wait_events=125
const scaleMin = 0.05;
const scaleMax = 3;
const baseMoveTime = Math.round(minimalMoveTime / scaleMin);

const velocityEvents = 128;
const velocityBins = 12;
const velocityExp = 0.5;

const minimalTrackWidth = 80;
const trackInitOffsetPx = 10;
const pixelFix = 0.5;
const topToArrowIcon = 19;
const arrowIconToTracks = 23;

type TrackProps = {
  id: string;
  right: number;
  scale: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
};

const displayCurrentInstrumentType = () => {
  const displayPanelId = 'instrument_panel_id';
  const content: React.ReactNode =
    <div className="flex gap-2 items-center">
      {InstrumentTypeNameMap.map((name, i) =>
        <Text key={name} style={{ whiteSpace: 'nowrap' }}
          className={commonStore.instrumentType === i ? 'text-blue-600' : ''}
          weight={commonStore.instrumentType === i ? 'bold' : 'regular'}
          size={commonStore.instrumentType === i ? 300 : 100}
        >{t(name)}</Text>)}
    </div>;
  const options: ToastOptions = {
    type: 'default',
    autoClose: 2000,
    toastId: displayPanelId,
    position: 'top-left',
    style: {
      width: 'fit-content'
    }
  };
  if (toast.isActive(displayPanelId))
    toast.update(displayPanelId, {
      render: content,
      ...options
    });
  else
    toast(content, options);
};

const velocityToBin = (velocity: number) => {
  velocity = Math.max(0, Math.min(velocity, velocityEvents - 1));
  const binsize = velocityEvents / (velocityBins - 1);
  return Math.ceil((velocityEvents * ((Math.pow(velocityExp, (velocity / velocityEvents)) - 1.0) / (velocityExp - 1.0))) / binsize);
};

const midiMessageToToken = (msg: MidiMessage) => {
  if (msg.messageType === 'NoteOn' || msg.messageType === 'NoteOff') {
    const instrument = InstrumentTypeTokenMap[commonStore.instrumentType];
    const note = msg.note.toString(16);
    const velocity = velocityToBin(msg.velocity).toString(16);
    return `${instrument}:${note}:${velocity} `;
  } else if (msg.messageType === 'ElapsedTime') {
    let time = Math.round(msg.value / minimalMoveTime);
    const num = Math.floor(time / 125); // wait_events=125
    time -= num * 125;
    let ret = '';
    for (let i = 0; i < num; i++) {
      ret += 't125 ';
    }
    if (time > 0)
      ret += `t${time} `;
    return ret;
  } else
    return '';
};

let dropRecordingTime = false;

export const midiMessageHandler = async (data: MidiMessage) => {
  if (data.messageType === 'ControlChange') {
    commonStore.setInstrumentType(Math.round(data.value / 127 * (InstrumentTypeNameMap.length - 1)));
    displayCurrentInstrumentType();
    return;
  }
  if (commonStore.recordingTrackId) {
    if (dropRecordingTime && data.messageType === 'ElapsedTime') {
      dropRecordingTime = false;
      return;
    }
    data = {
      ...data,
      instrument: commonStore.instrumentType
    };
    commonStore.setRecordingRawContent([...commonStore.recordingRawContent, data]);
    commonStore.setRecordingContent(commonStore.recordingContent + midiMessageToToken(data));

    //TODO data.channel = data.instrument;
    PlayNote(data);
  }
};

const Track: React.FC<TrackProps> = observer(({
  id,
  right,
  scale,
  isSelected,
  onSelect
}) => {
  const { t } = useTranslation();
  const trackIndex = commonStore.tracks.findIndex(t => t.id === id)!;
  const track = commonStore.tracks[trackIndex];
  const trackClass = isSelected ? 'bg-blue-600' : (commonStore.settings.darkMode ? 'bg-blue-900' : 'bg-gray-700');
  const controlX = useRef(0);

  let trackName = t('Track') + ' ' + id;
  if (track.mainInstrument)
    trackName = t('Track') + ' - ' + t('Piano is the main instrument')!.replace(t('Piano')!, t(track.mainInstrument)) + (track.content && (' - ' + track.content));
  else if (track.content)
    trackName = t('Track') + ' - ' + track.content;

  return (
    <Draggable
      axis="x"
      bounds={{ left: 0, right }}
      grid={[snapValue, snapValue]}
      position={{
        x: (track.offsetTime - commonStore.trackCurrentTime) / (baseMoveTime * scale) * snapValue,
        y: 0
      }}
      onStart={(e, data) => {
        controlX.current = data.lastX;
      }}
      onStop={(e, data) => {
        const delta = data.lastX - controlX.current;
        let offsetTime = Math.round(Math.round(delta / snapValue * baseMoveTime * scale) / minimalMoveTime) * minimalMoveTime;
        offsetTime = Math.min(Math.max(
          offsetTime,
          -track.offsetTime), commonStore.trackTotalTime - track.offsetTime);

        const tracks = commonStore.tracks.slice();
        tracks[trackIndex].offsetTime += offsetTime;
        commonStore.setTracks(tracks);
        refreshTracksTotalTime();
      }}
    >
      <div
        className={`p-1 cursor-move rounded whitespace-nowrap overflow-hidden ${trackClass}`}
        style={{
          width: `${Math.max(minimalTrackWidth,
            track.contentTime / (baseMoveTime * scale) * snapValue
          )}px`
        }}
        onClick={() => onSelect(id)}
      >
        <span className="text-white">{trackName}</span>
      </div>
    </Draggable>
  );
});

const AudiotrackEditor: FC<{ setPrompt: (prompt: string) => void }> = observer(({ setPrompt }) => {
  const { t } = useTranslation();

  const viewControlsContainerRef = useRef<HTMLDivElement>(null);
  const currentTimeControlRef = useRef<HTMLDivElement>(null);
  const playStartTimeControlRef = useRef<HTMLDivElement>(null);
  const tracksEndLineRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarButtonRef = useRef<HTMLDivElement>(null);
  const toolbarSliderRef = useRef<HTMLInputElement>(null);
  const contentPreviewRef = useRef<HTMLDivElement>(null);

  const [refreshRef, setRefreshRef] = useState(false);

  const windowSize = useWindowSize();
  const scale = (scaleMin + scaleMax) - commonStore.trackScale;

  const [selectedTrackId, setSelectedTrackId] = useState<string>('');
  const playStartTimeControlX = useRef(0);
  const selectedTrack = selectedTrackId ? commonStore.tracks.find(t => t.id === selectedTrackId) : undefined;

  useEffect(() => {
    if (toolbarSliderRef.current && toolbarSliderRef.current.parentElement)
      toolbarSliderRef.current.parentElement.style.removeProperty('--fui-Slider--steps-percent');
  }, []);

  const scrollContentToBottom = () => {
    if (contentPreviewRef.current)
      contentPreviewRef.current.scrollTop = contentPreviewRef.current.scrollHeight;
  };

  useEffect(() => {
    scrollContentToBottom();
  }, [commonStore.recordingContent]);

  useEffect(() => {
    setRefreshRef(!refreshRef);
  }, [windowSize, commonStore.tracks]);

  const viewControlsContainerWidth = (toolbarRef.current && toolbarButtonRef.current && toolbarSliderRef.current) ?
    toolbarRef.current.clientWidth - toolbarButtonRef.current.clientWidth - toolbarSliderRef.current.clientWidth - 16 // 16 = ml-2 mr-2
    : 0;
  const tracksWidth = viewControlsContainerWidth;
  const timeOfTracksWidth = Math.floor(tracksWidth / snapValue) // number of moves
    * baseMoveTime * scale;
  const currentTimeControlWidth = (timeOfTracksWidth < commonStore.trackTotalTime)
    ? timeOfTracksWidth / commonStore.trackTotalTime * viewControlsContainerWidth
    : 0;
  const playStartTimeControlPosition = (commonStore.trackPlayStartTime - commonStore.trackCurrentTime) / (baseMoveTime * scale) * snapValue;
  const tracksEndPosition = (commonStore.trackTotalTime - commonStore.trackCurrentTime) / (baseMoveTime * scale) * snapValue;
  const moveableTracksWidth = (tracksEndLineRef.current && viewControlsContainerRef.current &&
    ((tracksEndLineRef.current.getBoundingClientRect().left - (viewControlsContainerRef.current.getBoundingClientRect().left + trackInitOffsetPx)) > 0))
    ? tracksEndLineRef.current.getBoundingClientRect().left - (viewControlsContainerRef.current.getBoundingClientRect().left + trackInitOffsetPx)
    : Infinity;

  return (
    <div className="flex flex-col gap-2 overflow-hidden" style={{ width: '80vw', height: '80vh' }}>
      <div className="mx-auto">
        <Text size={100}>{`${commonStore.trackPlayStartTime} ms / ${commonStore.trackTotalTime} ms`}</Text>
      </div>
      <div className="flex pb-2 border-b" ref={toolbarRef}>
        <div className="flex gap-2" ref={toolbarButtonRef}>
          <ToolTipButton disabled desc={t('Play All') + ' (Unavailable)'} icon={<Play16Regular />} />
          <ToolTipButton desc={t('Clear All')} icon={<Delete16Regular />} onClick={() => {
            commonStore.setTracks([]);
            commonStore.setTrackScale(1);
            commonStore.setTrackTotalTime(tracksMinimalTotalTime);
            commonStore.setTrackCurrentTime(0);
            commonStore.setTrackPlayStartTime(0);
          }} />
        </div>
        <div className="grow">
          <div className="flex flex-col ml-2 mr-2" ref={viewControlsContainerRef}>
            <div className="relative">
              <Tooltip content={`${commonStore.trackTotalTime} ms`} showDelay={0} hideDelay={0}
                relationship="description">
                <div className="border-l absolute"
                  ref={tracksEndLineRef}
                  style={{
                    height: (tracksRef.current && commonStore.tracks.length > 0)
                      ? tracksRef.current.clientHeight - arrowIconToTracks
                      : 0,
                    top: `${topToArrowIcon + arrowIconToTracks}px`,
                    left: `${tracksEndPosition + trackInitOffsetPx - pixelFix}px`
                  }} />
              </Tooltip>
            </div>
            <Draggable axis="x" bounds={{
              left: 0,
              right: viewControlsContainerWidth - currentTimeControlWidth
            }}
              position={{
                x: commonStore.trackCurrentTime / commonStore.trackTotalTime * viewControlsContainerWidth,
                y: 0
              }}
              onDrag={(e, data) => {
                setTimeout(() => {
                  let offset = 0;
                  if (currentTimeControlRef.current) {
                    const match = currentTimeControlRef.current.style.transform.match(/translate\((.+)px,/);
                    if (match)
                      offset = parseFloat(match[1]);
                  }
                  const offsetTime = commonStore.trackTotalTime / viewControlsContainerWidth * offset;
                  commonStore.setTrackCurrentTime(offsetTime);
                }, 1);
              }}
            >
              <div ref={currentTimeControlRef}
                className={classnames('h-2 cursor-move rounded', commonStore.settings.darkMode ? 'bg-neutral-600' : 'bg-gray-700')}
                style={{ width: currentTimeControlWidth }} />
            </Draggable>
            <div className={classnames(
              'flex',
              (playStartTimeControlPosition < 0 || playStartTimeControlPosition > viewControlsContainerWidth)
              && 'hidden'
            )}>
              <Draggable axis="x" bounds={{
                left: 0,
                right: (playStartTimeControlRef.current)
                  ? Math.min(viewControlsContainerWidth - playStartTimeControlRef.current.clientWidth, moveableTracksWidth)
                  : 0
              }}
                grid={[snapValue, snapValue]}
                position={{ x: playStartTimeControlPosition, y: 0 }}
                onStart={(e, data) => {
                  playStartTimeControlX.current = data.lastX;
                }}
                onStop={(e, data) => {
                  const delta = data.lastX - playStartTimeControlX.current;
                  let offsetTime = Math.round(Math.round(delta / snapValue * baseMoveTime * scale) / minimalMoveTime) * minimalMoveTime;
                  offsetTime = Math.min(Math.max(
                    offsetTime,
                    -commonStore.trackPlayStartTime), commonStore.trackTotalTime - commonStore.trackPlayStartTime);
                  commonStore.setTrackPlayStartTime(commonStore.trackPlayStartTime + offsetTime);
                }}
              >
                <div className="relative cursor-move"
                  ref={playStartTimeControlRef}>
                  <ArrowAutofitWidth20Regular />
                  <div
                    className={classnames('border-l absolute', commonStore.settings.darkMode ? 'border-white' : 'border-gray-700')}
                    style={{
                      height: (tracksRef.current && commonStore.tracks.length > 0)
                        ? tracksRef.current.clientHeight
                        : 0,
                      top: '50%',
                      left: `calc(50% - ${pixelFix}px)`
                    }} />
                </div>
              </Draggable>
            </div>
          </div>
        </div>
        <Tooltip content={t('Scale View')! + ': ' + commonStore.trackScale} showDelay={0} hideDelay={0}
          relationship="description">
          <Slider ref={toolbarSliderRef} value={commonStore.trackScale} step={scaleMin} max={scaleMax} min={scaleMin}
            onChange={(e, data) => {
              commonStore.setTrackScale(data.value);
            }}
          />
        </Tooltip>
      </div>
      <div className="flex flex-col overflow-y-auto gap-1" ref={tracksRef}>
        {commonStore.tracks.map(track =>
          <div key={track.id} className="flex gap-2 pb-1 border-b">
            <div className="flex gap-1 border-r h-7">
              <ToolTipButton desc={commonStore.recordingTrackId === track.id ? t('Stop') : t('Record')}
                icon={commonStore.recordingTrackId === track.id ? <Stop16Filled /> : <Record16Regular />}
                size="small" shape="circular" appearance="subtle"
                onClick={() => {
                  flushMidiRecordingContent();
                  commonStore.setPlayingTrackId('');

                  if (commonStore.recordingTrackId === track.id) {
                    commonStore.setRecordingTrackId('');
                  } else {
                    if (commonStore.activeMidiDeviceIndex === -1) {
                      toast(t('Please select a MIDI device first'), { type: 'warning' });
                      return;
                    }

                    dropRecordingTime = true;
                    setSelectedTrackId(track.id);

                    commonStore.setRecordingTrackId(track.id);
                    commonStore.setRecordingContent(track.content);
                    commonStore.setRecordingRawContent(track.rawContent.slice());
                  }
                }} />
              <ToolTipButton disabled
                desc={commonStore.playingTrackId === track.id ? t('Stop') : t('Play') + ' (Unavailable)'}
                icon={commonStore.playingTrackId === track.id ? <Pause16Regular /> : <Play16Filled />}
                size="small" shape="circular" appearance="subtle"
                onClick={() => {
                  flushMidiRecordingContent();
                  commonStore.setRecordingTrackId('');

                  if (commonStore.playingTrackId === track.id) {
                    commonStore.setPlayingTrackId('');
                  } else {
                    setSelectedTrackId(track.id);

                    commonStore.setPlayingTrackId(track.id);
                  }
                }} />
              <ToolTipButton desc={t('Delete')} icon={<Delete16Regular />} size="small" shape="circular"
                appearance="subtle" onClick={() => {
                const tracks = commonStore.tracks.slice().filter(t => t.id !== track.id);
                commonStore.setTracks(tracks);
                refreshTracksTotalTime();
              }} />
            </div>
            <div className="relative grow overflow-hidden">
              <div className="absolute" style={{ left: -0 }}>
                <Track
                  id={track.id}
                  scale={scale}
                  right={Math.min(tracksWidth, moveableTracksWidth)}
                  isSelected={selectedTrackId === track.id}
                  onSelect={setSelectedTrackId}
                />
              </div>
            </div>
          </div>)}
        <div className="flex justify-between items-center">
          <Button icon={<Add16Regular />} size="small" shape="circular"
            appearance="subtle"
            onClick={() => {
              commonStore.setTracks([...commonStore.tracks, {
                id: uuid(),
                mainInstrument: '',
                content: '',
                rawContent: [],
                offsetTime: 0,
                contentTime: 0
              }]);
            }}>
            {t('New Track')}
          </Button>
          <Text size={100}>
            {t('Select a track to preview the content')}
          </Text>
        </div>
      </div>
      <div className="grow"></div>
      {selectedTrack &&
        <Card size="small" appearance="outline" style={{ minHeight: '150px', maxHeight: '200px' }}>
          <div className="flex flex-col gap-1 overflow-hidden">
            <Text size={100}>{`${t('Start Time')}: ${selectedTrack.offsetTime} ms`}</Text>
            <Text size={100}>{`${t('Content Duration')}: ${selectedTrack.contentTime} ms`}</Text>
            <div className="overflow-y-auto overflow-x-hidden" ref={contentPreviewRef}>
              {selectedTrackId === commonStore.recordingTrackId
                ? commonStore.recordingContent
                : selectedTrack.content}
            </div>
          </div>
        </Card>
      }
      <DialogTrigger disableButtonEnhancement>
        <Button icon={<MusicNote220Regular />} style={{ minHeight: '32px' }} onClick={() => {
          flushMidiRecordingContent();
          commonStore.setRecordingTrackId('');
          commonStore.setPlayingTrackId('');

          const timestamp = [];
          const sortedTracks = commonStore.tracks.slice().sort((a, b) => a.offsetTime - b.offsetTime);
          for (const track of sortedTracks) {
            timestamp.push(track.offsetTime);
            let accContentTime = 0;
            for (const msg of track.rawContent) {
              if (msg.messageType === 'ElapsedTime') {
                accContentTime += msg.value;
                timestamp.push(track.offsetTime + accContentTime);
              }
            }
          }
          const sortedTimestamp = timestamp.slice().sort((a, b) => a - b);
          const globalMessages: MidiMessage[] = sortedTimestamp.reduce((messages, current, i) =>
              [...messages, {
                messageType: 'ElapsedTime',
                value: current - (i === 0 ? 0 : sortedTimestamp[i - 1])
              } as MidiMessage]
            , [] as MidiMessage[]);
          for (const track of sortedTracks) {
            let currentTime = track.offsetTime;
            let accContentTime = 0;
            for (const msg of track.rawContent) {
              if (msg.messageType === 'ElapsedTime') {
                accContentTime += msg.value;
                currentTime = track.offsetTime + accContentTime;
              } else if (msg.messageType === 'NoteOn' || msg.messageType === 'NoteOff') {
                const insertIndex = sortedTimestamp.findIndex(t => t >= currentTime);
                globalMessages.splice(insertIndex + 1, 0, msg);
                sortedTimestamp.splice(insertIndex + 1, 0, 0); // placeholder
              }
            }
          }
          const result = ('<pad> ' + globalMessages.map(m => midiMessageToToken(m)).join('')).trim();
          commonStore.setCompositionSubmittedPrompt(result);
          setPrompt(result);
        }}>
          {t('Save to generation area')}
        </Button>
      </DialogTrigger>
    </div>
  );
});

export default AudiotrackEditor;
