import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as FS from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { Connection, EditOptions, ProjectView, Usage, initialConnection, jobId, request } from './src/client';
import { Snapshot, exportPhoto, persist, restore } from './src/persistence';
import { photoDestination, saveToPhotos } from './src/photos';
import { GestureCanvas } from './src/GestureCanvas';
import { MaskEditor } from './src/MaskEditor';
import { SourcePicker } from './src/SourcePicker';
import type { BrushStroke } from './src/layout';
import { photoLayout } from './src/layout';
import { ToolRail, EDITOR_TOOLS } from './src/ToolRail';
import { editorLayout, fitCanvas } from './src/editor-layout';
import type { ToolId } from './src/editor-layout';

type ButtonProps = { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; selected?: boolean };
function Button({ title, onPress, disabled, secondary, selected }: ButtonProps) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled, selected: !!selected }} onPress={onPress} disabled={disabled} style={[styles.button, secondary && styles.secondary, selected && styles.selected, disabled && styles.disabled]}><Text style={[styles.buttonText, secondary && styles.secondaryText, selected && { color: '#fff' }]}>{title}</Text></Pressable>;
}
function Stepper({ title, value, onChange, step, min, max, disabled }: { title: string; value: number; onChange: (n: number) => void; step: number; min: number; max: number; disabled: boolean }) {
  return <View style={styles.stepRow}><Text style={styles.stepLabel}>{title}</Text><View style={styles.row}><Button title="−" secondary disabled={disabled || value <= min} onPress={() => onChange(Math.max(min, Number((value - step).toFixed(2))))} /><Text style={styles.value}>{Math.round(value * 100)}</Text><Button title="+" secondary disabled={disabled || value >= max} onPress={() => onChange(Math.min(max, Number((value + step).toFixed(2))))} /></View></View>;
}

function Tabs<T extends string>({ items, value, onChange }: { items: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return <View style={styles.tabs}>{items.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: value === item.id }} onPress={() => onChange(item.id)} style={[styles.tab, value === item.id && styles.tabSelected]}><Text style={[styles.tabLabel, value === item.id && styles.tabSelectedLabel]}>{item.label}</Text></Pressable>)}</View>;
}

function Editor() {
  const viewport = useWindowDimensions(), insets = useSafeAreaInsets();
  const [connection, setConnection] = useState<Connection>(initialConnection);
  const [activeTool, setActiveTool] = useState<ToolId | null>(initialConnection.token ? null : 'more');
  const [positionTab, setPositionTab] = useState<'move' | 'shadow' | 'ratio'>('move');
  const [decorationTab, setDecorationTab] = useState<'create' | 'place'>('create');
  const [moreTab, setMoreTab] = useState<'recent' | 'settings' | 'jobs'>(initialConnection.token ? 'recent' : 'settings');
  const [compare, setCompare] = useState(false), [keyboardOpen, setKeyboardOpen] = useState(false);
  const [rootHeight, setRootHeight] = useState(viewport.height);
  const [stage, setStage] = useState({ width: viewport.width, height: Math.max(0, viewport.height - 146) });
  const [view, setView] = useState<ProjectView | null>(null), [draft, setDraft] = useState<EditOptions | null>(null);
  const [history, setHistory] = useState<EditOptions[]>([]), [projects, setProjects] = useState<Snapshot['projects']>([]);
  const [pendingJob, setPendingJob] = useState<string | null>(null), [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(''), [message, setMessage] = useState('사진 한 장으로, 프레임 밖으로.'), [saveState, setSaveState] = useState('');
  const [exportMessage, setExportMessage] = useState('');
  const [interacting, setInteracting] = useState(false), [maskOpen, setMaskOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [status, setStatus] = useState<{ modelConfigured: boolean; creditsConfirmed: boolean; usage: Usage } | null>(null);
  const [picking, setPicking] = useState(false), [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [prompt, setPrompt] = useState('person'), [decorationPrompt, setDecorationPrompt] = useState('a purple crystal');
  const lock = useRef(false), alive = useRef(true);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardOpen(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (busy) return true;
      if (maskOpen) { setMaskOpen(false); return true; }
      if (picking) { setPicking(false); return true; }
      if (activeTool) { setActiveTool(null); Keyboard.dismiss(); return true; }
      return false;
    });
    return () => back.remove();
  }, [busy, maskOpen, picking, activeTool]);
  const latestSnapshot = useRef<Snapshot>({ view, draft, history, projects, pendingJob });
  latestSnapshot.current = { view, draft, history, projects, pendingJob };
  useEffect(() => {
    if (!ready) return;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') void persist(latestSnapshot.current).catch(() => {});
    });
    return () => subscription.remove();
  }, [ready]);
  useEffect(() => {
    if (initialConnection.token) request<{ modelConfigured: boolean; creditsConfirmed: boolean; usage: Usage }>(initialConnection, '/status').then(setStatus).catch(() => setMessage('개발 서버에 연결하지 못했어요. 설정에서 연결을 확인해 주세요.'));
  }, []);
  useEffect(() => {
    alive.current = true;
    restore().then(snapshot => {
      if (!alive.current) return;
      if (snapshot) { setView(snapshot.view); setDraft(snapshot.draft || snapshot.view?.options || null); setHistory(snapshot.history || []); setProjects(snapshot.projects); setPendingJob(snapshot.pendingJob); setMessage(snapshot.pendingJob ? '미확인 AI 작업이 있어요. 상태 확인 후 계속해 주세요.' : '최근 작업을 복원했어요.'); }
    }).catch(() => setMessage('보관한 작업을 읽지 못했어요. 새 사진으로 시작할 수 있어요.')).finally(() => setReady(true));
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => { setSaveState('저장 중'); persist({ view, draft, history, projects, pendingJob }).then(() => setSaveState('기기에 보관됨')).catch(() => setSaveState('기기 저장 실패 · 저장 공간 확인')); }, 350);
    return () => clearTimeout(timer);
  }, [ready, view, draft, history, projects, pendingJob]);
  const accept = (next: ProjectView) => {
    setExportMessage('');
    const needsSelection = next.project.candidates.length > 1 && !next.project.selectedId;
    if (needsSelection) setActiveTool('subject');
    else if (view?.project.id !== next.project.id) setActiveTool(null);
    setView(next); setDraft(next.options); setPicking(needsSelection); setPoint(null);
    setProjects(current => [{ id: next.project.id, createdAt: next.project.createdAt }, ...current.filter(item => item.id !== next.project.id)].slice(0, 20));
    setStatus(current => current ? { ...current, usage: next.usage } : current);
  };
  const task = async (label: string, action: () => Promise<void>) => {
    if (lock.current || !ready) return;
    lock.current = true; setBusy(label); setMessage(label);
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : '작업을 완료하지 못했어요.'); }
    finally { setBusy(''); lock.current = false; }
  };
  const choosePhoto = () => { void task('사진을 불러오는 중', async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled) { setMessage('사진 선택을 취소했어요.'); return; }
    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > 12000000) throw new Error('12MB 이하의 사진을 선택해 주세요.');
    const image = await FS.readAsStringAsync(asset.uri, { encoding: FS.EncodingType.Base64 });
    accept(await request<ProjectView>(connection, '/projects', { image })); setHistory([]); setMessage('사진을 불러왔어요. 튀어나올 대상을 선택해 주세요.');
  }); };
  const modelsAllowed = !!status?.modelConfigured && !!status?.creditsConfirmed;
  const modelTask = (endpoint: string, extra: object, label: string) => {
    if (!view) return;
    if (pendingJob) { setMessage('앞선 AI 작업의 상태를 먼저 확인해 주세요.'); return; }
    if (draft && JSON.stringify(draft) !== JSON.stringify(view.options)) { setMessage('먼저 변경 적용을 눌러 편집을 마무리해 주세요.'); return; }
    void task(label, async () => {
        const id = jobId(); setPendingJob(id);
        // Save the request ID before sending: a disconnect must not lose deduplication identity.
        await persist({ view, draft, history, projects, pendingJob: id });
        const next = await request<ProjectView>(connection, endpoint, { projectId: view.project.id, jobId: id, ...extra });
        accept(next); setPendingJob(null); setMessage(endpoint === '/decoration' ? '장식이 생성됐어요. 배경 분리를 눌러 편집 가능한 장식으로 만드세요.' : '분리를 완료했어요. 결과를 확인하고 조절해 주세요.');
    });
  };
  const render = (options: EditOptions, undo = false) => { if (!view) return; void task('미리보기를 만드는 중', async () => {
    const next = await request<ProjectView>(connection, '/render', { projectId: view.project.id, options });
    setHistory(current => undo ? current.slice(0, -1) : [...current.slice(-19), view.options]);
    accept(next); setMessage('미리보기와 저장 파일에 같은 편집을 적용했어요.');
  }); };
  const correctMask = async (strokes: BrushStroke[], reset = false) => {
    if (!view?.project.selectedId || lock.current) throw new Error('보정할 피사체를 선택해 주세요.');
    lock.current = true; setBusy('누끼 보정을 적용하는 중');
    try {
      const next = await request<ProjectView>(connection, reset ? '/mask/reset' : '/mask', { projectId: view.project.id, candidateId: view.project.selectedId, baseRevision: view.project.maskRevision || 0, strokes });
      accept(next);
      if (draft) setDraft(draft);
      if (!reset) setMaskOpen(false);
      setMessage(reset ? '누끼 보정을 초기화했어요.' : '누끼 보정을 적용했어요. 추가 AI 호출은 없어요.');
    } finally { lock.current = false; setBusy(''); }
  };
  const cutSticker = async (strokes: BrushStroke[]) => {
    if (!view || lock.current) throw new Error('사진을 먼저 열어 주세요.');
    lock.current = true; setBusy('테두리를 따라 자르는 중');
    try {
      accept(await request<ProjectView>(connection, '/cutout', { projectId: view.project.id, points: strokes[0]?.points || [] }));
      setHistory([]); setMaskOpen(false);
      setMessage('배경 없는 스티커예요. 드래그·핀치로 이동·확대하세요.');
    } finally { lock.current = false; setBusy(''); }
  };
  const change = <K extends keyof EditOptions>(name: K, value: EditOptions[K]) => setDraft(current => current ? { ...current, [name]: value } : current);
  const dirty = !!view && !!draft && JSON.stringify(view.options) !== JSON.stringify(draft);
  const disabled = !!busy || !ready;
  const useFixture = () => { void task('연습용 그림을 여는 중', async () => { accept(await request<ProjectView>(connection, '/fixture', {})); setHistory([]); setMessage('직접 그린 테스트 그림이에요. 실제 SAM 결과가 아닙니다.'); }); };
  const check = () => { void task('연결을 확인하는 중', async () => { const next = await request<{ modelConfigured: boolean; creditsConfirmed: boolean; usage: Usage }>(connection, '/status'); setStatus(next); setMessage(!next.modelConfigured ? '서버 연결 완료. Meta 키는 아직 설정되지 않았어요.' : !next.creditsConfirmed ? '키 설정은 있어요. PC에서 Billing의 대회 크레딧 지급 확인을 완료해 주세요.' : '키 설정과 크레딧 수동 확인 기록이 있어요. 실제 잔액과 모델 호출 성공은 별도 확인이 필요해요.'); }); };
  const save = (share = false) => { if (!view) return; void task(share ? '공유 파일을 준비하는 중' : '사진을 저장하는 중', async () => {
    setExportMessage(share ? '공유 파일을 준비하고 있어요.' : '휴대폰 사진 보관함에 저장하고 있어요.');
    try {
    if (dirty) throw new Error('변경 적용을 먼저 눌러 주세요.');
    const uri = await exportPhoto(view);
    if (share) { if (!(await Sharing.isAvailableAsync())) throw new Error('이 기기에서 공유창을 사용할 수 없어요.'); await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: '입체 사진 공유' }); const text = '공유창을 닫았어요. 실제 게시 여부는 대상 앱에서 확인해 주세요.'; setMessage(text); setExportMessage(text); }
    else {
      await saveToPhotos(uri, MediaLibrary);
      const text = `사진 보관함에 저장했어요. ${photoDestination(Platform.OS)}`;
      setMessage(text); setExportMessage(text);
      Alert.alert('사진 저장 완료', `${photoDestination(Platform.OS)}\n\n파일: ${uri.split('/').at(-1)}`);
    }
    } catch (error) {
      const reason = error instanceof Error ? error.message : '사진을 저장하지 못했어요.';
      setExportMessage(`실패: ${reason}`);
      Alert.alert(share ? '공유 실패' : '사진 저장 실패', reason);
      throw error;
    }
  }); };
  const screen = editorLayout(rootHeight, !!activeTool && !maskOpen, keyboardOpen);
  const output = view ? photoLayout(view.project, draft || view.options) : null;
  const ratio = view ? (picking ? view.project.width / view.project.height : output!.width / output!.height) : 4 / 5;
  const canvasSize = fitCanvas(stage.width, stage.height, ratio, screen.showRail);
  const selectTool = (id: ToolId) => {
    Keyboard.dismiss();
    if (id !== 'subject') setPicking(false);
    setActiveTool(current => current === id ? null : id);
  };
  const closeTools = () => { setActiveTool(null); Keyboard.dismiss(); };
  const openMask = (outline = false) => { Keyboard.dismiss(); setPicking(false); setActiveTool(null); setOutlineOpen(outline); setMaskOpen(true); };
  const undo = () => {
    if (dirty && view) setDraft(view.options);
    else if (history.length) render(history[history.length - 1], true);
  };
  const checkJob = () => { if (!pendingJob) return; void task('작업 상태를 확인하는 중', async () => {
    const job = await request<{ status: string; message?: string; result?: { projectId: string } }>(connection, `/jobs/${pendingJob}`);
    if (job.status === 'succeeded' && job.result) { accept(await request<ProjectView>(connection, `/projects/${job.result.projectId}`)); setPendingJob(null); setMessage('완료된 결과를 불러왔어요.'); }
    else setMessage(job.message || `작업 상태: ${job.status}. 자동 재호출하지 않아요.`);
  }); };
  const allowNewJob = () => Alert.alert('새 요청 허용', '이전 호출은 이미 비용이 발생했을 수 있어요. 제공자 사용량과 작업 상태를 확인한 뒤 새 요청을 진행하세요.', [{ text: '취소' }, { text: '확인했어요', onPress: () => { setPendingJob(null); setMessage('새 요청을 허용했어요. 이전 호출 예약은 유지돼요.'); } }]);
  const openProject = (id: string) => { void task('작업을 불러오는 중', async () => { accept(await request<ProjectView>(connection, `/projects/${id}`)); setHistory([]); setMessage('이전 작업을 열었어요.'); }); };
  const controlsDisabled = disabled || interacting || maskOpen;
  const openJobTools = () => { if (maskOpen) return; setMoreTab('jobs'); setActiveTool('more'); };
  return <SafeAreaView style={styles.safe}><StatusBar style="light" /><KeyboardAvoidingView style={styles.editor} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}><View style={styles.editor} onLayout={event => setRootHeight(event.nativeEvent.layout.height)}>
    <View style={styles.top}>
      <View><Text style={styles.brand}>reel talk<Text style={styles.brandDot}> ✳</Text></Text><Text style={styles.eyebrow}>밖으로, 톡.</Text></View>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="실행 취소" disabled={controlsDisabled || (!dirty && !history.length)} onPress={undo} style={[styles.topIcon, (controlsDisabled || (!dirty && !history.length)) && styles.disabled]}><Text style={styles.topIconText}>↶</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="사진 앨범에 저장" disabled={controlsDisabled || !view || dirty} onPress={() => save()} style={[styles.topSave, (controlsDisabled || !view || dirty) && styles.disabled]}><Text style={styles.topSaveText}>저장</Text></Pressable>
      </View>
    </View>

    <View style={styles.stage} onLayout={event => setStage({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
      <View style={[styles.canvasArea, { paddingRight: canvasSize.railWidth + 10 }]}>
        {maskOpen && view ? <MaskEditor key={outlineOpen ? 'outline' : 'erase'} embedded outline={outlineOpen} visible view={view} viewportHeight={Math.max(32, stage.height - 20)} onClose={() => setMaskOpen(false)} onApply={outlineOpen ? cutSticker : strokes => correctMask(strokes)} onReset={() => correctMask([], true)} /> : view ? <View style={[styles.canvas, { width: canvasSize.width, height: canvasSize.height }]}>
          {picking ? <SourcePicker view={view} point={point} onPoint={setPoint} disabled={disabled} /> : <GestureCanvas compact touchEnabled compare={compare} view={view} options={draft || view.options} disabled={disabled} onInteracting={setInteracting} onCommit={options => { setDraft(options); render(options); }} />}
          {view.project.provenance === 'synthetic-fixture' && <View pointerEvents="none" style={styles.fixtureBadge}><Text numberOfLines={1} style={styles.fixtureText}>연습용 · AI 분리 아님</Text></View>}
        </View> : <View style={styles.empty}>
          {stage.height > 320 && <Text style={styles.emptyMark}>↗</Text>}
          {stage.height > 180 && <><Text style={styles.emptyTitle}>사진 한 장,{ '\n' }프레임 밖으로.</Text>{stage.height > 280 && <Text style={styles.emptyHint}>내 사진으로 입체 콘텐츠를 만들어 보세요.</Text>}<Button title="사진 선택" disabled={disabled} onPress={choosePhoto} /><Pressable accessibilityRole="button" onPress={useFixture} disabled={disabled} style={styles.sampleLink}><Text style={styles.sampleText}>연습용 그림으로 시작</Text></Pressable></>}
        </View>}
      </View>
      {screen.showRail && <View style={styles.railPosition}><ToolRail active={maskOpen ? 'subject' : activeTool} onSelect={selectTool} disabled={controlsDisabled} hasPhoto={!!view} buttonHeight={screen.railButtonHeight} pendingJob={!!pendingJob} /></View>}
    </View>

    <Pressable accessibilityRole="button" accessibilityLabel="작업 안내 자세히 보기" disabled={maskOpen || interacting} onPress={openJobTools} style={styles.status}>
      {busy ? <ActivityIndicator size="small" color="#BEAFF0" /> : <Text style={[styles.dot, pendingJob && { color: '#F4C47D' }]}>●</Text>}
      <Text accessibilityLiveRegion="polite" numberOfLines={2} style={styles.statusText}>{exportMessage || message}</Text>
    </Pressable>

    {!!activeTool && !maskOpen && <View style={[styles.sheet, { height: screen.panelHeight }]}>
      <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>{EDITOR_TOOLS.find(tool => tool.id === activeTool)?.label}</Text><Pressable accessibilityRole="button" accessibilityLabel="도구 접기" onPress={closeTools} style={styles.closeButton}><Text style={styles.closeText}>⌄</Text></Pressable></View>
      {activeTool === 'position' && <Tabs items={[{ id: 'move', label: '위치·크기' }, { id: 'shadow', label: '그림자' }, { id: 'ratio', label: '비율' }]} value={positionTab} onChange={setPositionTab} />}
      {activeTool === 'decoration' && <Tabs items={[{ id: 'create', label: '만들기' }, { id: 'place', label: '배치' }]} value={decorationTab} onChange={setDecorationTab} />}
      {activeTool === 'more' && <Tabs items={[{ id: 'recent', label: '내 작업' }, { id: 'settings', label: '연결 설정' }, { id: 'jobs', label: pendingJob ? 'AI 작업 !' : '작업 안내' }]} value={moreTab} onChange={setMoreTab} />}
      <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {activeTool === 'photo' && <>
          <View style={styles.row}><View style={styles.grow}><Button title="사진 선택" onPress={choosePhoto} disabled={disabled} /></View><View style={styles.grow}><Button title="연습용 그림" onPress={useFixture} secondary disabled={disabled} /></View></View>
          <Text style={styles.help}>새 사진은 새 작업으로 보관해요.</Text>
          {projects.length > 0 && <><Text style={styles.panelTitle}>최근 작업</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>{projects.slice(0, 5).map((project, i) => <Button key={project.id} title={`작업 ${i + 1}${project.id === view?.project.id ? ' · 현재' : ''}`} secondary disabled={disabled || project.id === view?.project.id} onPress={() => openProject(project.id)} />)}</ScrollView></>}
        </>}
        {activeTool === 'subject' && view && <>
          <Button title="테두리로 자르기 → 스티커" disabled={disabled} onPress={() => openMask(true)} />
          {view.subject && <View style={styles.row}><Button title="스티커만" secondary selected={draft?.mode === 'sticker'} disabled={disabled} onPress={() => change('mode', 'sticker')} /><Button title="폰 프레임" secondary selected={draft?.mode !== 'sticker'} disabled={disabled} onPress={() => change('mode', 'frame')} /></View>}
          <View style={styles.row}><View style={styles.grow}><Button title={picking ? '합성 보기' : '대상 선택'} secondary disabled={disabled} onPress={() => { setPicking(!picking); setPoint(null); }} /></View><View style={styles.grow}><Button title="지우개 보정" secondary disabled={disabled || !view.subject} onPress={() => openMask()} /></View></View>
          <View style={styles.row}><TextInput accessibilityLabel="분리할 대상 설명" style={[styles.input, styles.grow]} value={prompt} onChangeText={setPrompt} placeholder="예: person, sunglasses" editable={!disabled} /><Button title="AI로 분리" disabled={disabled || !modelsAllowed || !!pendingJob} onPress={() => modelTask('/segment', { point, prompt }, 'SAM이 피사체를 분리하는 중')} /></View>
          <Text style={styles.help}>{picking ? (point ? '누른 점을 기준으로 분리해요.' : '사진에서 튀어나올 대상을 눌러주세요.') : '분리한 피사체를 다듬거나 다시 선택할 수 있어요.'} AI 분리 시 사진을 Meta에 전송합니다.</Text>
          {view.project.candidates.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>{view.project.candidates.map(candidate => <Button key={candidate.id} title={candidate.label} secondary selected={view.project.selectedId === candidate.id} disabled={disabled} onPress={() => { void task('대상을 선택하는 중', async () => { accept(await request<ProjectView>(connection, '/select', { projectId: view.project.id, candidateId: candidate.id })); setMessage('선택한 피사체를 적용했어요.'); }); }} />)}</ScrollView>}
          {!modelsAllowed && <Text style={styles.help}>AI 연결 준비 중 · 기본 편집과 연습용 그림은 사용할 수 있어요.</Text>}
        </>}
        {activeTool === 'position' && draft && <>
          {positionTab === 'move' && <><Stepper title="사진 확대" value={draft.zoom} step={0.05} min={0.8} max={2.4} disabled={disabled} onChange={value => change('zoom', value)} /><Stepper title="좌우 위치" value={draft.x} step={0.05} min={-0.8} max={0.8} disabled={disabled} onChange={value => change('x', value)} /><Stepper title="상하 위치" value={draft.y} step={0.05} min={-0.8} max={0.8} disabled={disabled} onChange={value => change('y', value)} /><Text style={styles.help}>사진 위에서 드래그·핀치로 바로 조절할 수도 있어요.</Text></>}
          {positionTab === 'shadow' && <><Stepper title="그림자 진하기" value={draft.shadow} step={0.1} min={0} max={0.8} disabled={disabled} onChange={value => change('shadow', value)} /><Text style={styles.help}>변경 적용을 누르면 그림자가 반영됩니다.</Text></>}
          {positionTab === 'ratio' && <><View style={styles.row}>{(['portrait', 'story', 'square'] as const).map((ratio, i) => <View style={styles.grow} key={ratio}><Button title={['4:5', '9:16', '1:1'][i]} secondary selected={draft.ratio === ratio} disabled={disabled} onPress={() => change('ratio', ratio)} /></View>)}</View><Text style={styles.help}>비율을 바꾼 뒤 사진 위치와 잘리는 부분을 확인하세요.</Text></>}
        </>}
        {activeTool === 'background' && draft && <>
          <Text style={styles.help}>콘텐츠 바깥 배경색</Text><View style={styles.wrap}>{['#EEE8DF', '#DDE9E4', '#DFDDF1', '#F0DCD4', '#253043', '#FFFFFF', '#17151D'].map(color => <Pressable key={color} accessibilityRole="button" accessibilityLabel={`배경 ${color}`} accessibilityState={{ selected: draft.background === color }} onPress={() => change('background', color)} disabled={disabled} style={[styles.swatch, { backgroundColor: color, borderColor: draft.background === color ? '#9C84F0' : '#D8D2DE' }]} />)}</View>
        </>}
        {activeTool === 'decoration' && view && <>
          {decorationTab === 'create' && <><TextInput accessibilityLabel="생성할 장식 설명" style={styles.input} value={decorationPrompt} onChangeText={setDecorationPrompt} editable={!disabled} placeholder="예: a purple crystal" maxLength={500} /><Button title="AI 장식 만들기" disabled={disabled || !modelsAllowed || !!pendingJob} onPress={() => modelTask('/decoration', { prompt: decorationPrompt }, 'Muse Image가 장식을 만드는 중')} />{view.project.decorationPending && <Button title="생성한 장식 배경 분리" disabled={disabled || !modelsAllowed || !!pendingJob} onPress={() => modelTask('/decoration/segment', {}, '장식 배경을 분리하는 중')} />}<Text style={styles.help}>생성 1회와 배경 분리 1회를 사용해요. 배치 조절은 추가 AI 호출이 없어요.</Text></>}
          {decorationTab === 'place' && (view.project.decoration && draft ? <><View style={styles.row}><Button title="인물 앞" secondary selected={draft.decorationDepth === 'front'} disabled={disabled} onPress={() => change('decorationDepth', 'front')} /><Button title="인물 뒤" secondary selected={draft.decorationDepth === 'back'} disabled={disabled} onPress={() => change('decorationDepth', 'back')} /><Button title="숨기기" secondary disabled={disabled} onPress={() => { void task('장식을 숨기는 중', async () => { accept(await request<ProjectView>(connection, '/decoration/remove', { projectId: view.project.id })); setMessage('장식을 숨겼어요.'); }); }} /></View><Stepper title="장식 좌우" value={draft.decorationX} step={0.05} min={0} max={1} disabled={disabled} onChange={value => change('decorationX', value)} /><Stepper title="장식 상하" value={draft.decorationY} step={0.05} min={0} max={1} disabled={disabled} onChange={value => change('decorationY', value)} /><Stepper title="장식 크기" value={draft.decorationScale} step={0.05} min={0.08} max={0.65} disabled={disabled} onChange={value => change('decorationScale', value)} /></> : <Text style={styles.help}>장식을 만든 뒤 배경 분리를 완료하면 앞뒤·위치·크기를 조절할 수 있어요.</Text>)}
        </>}
        {activeTool === 'more' && <>
          {moreTab === 'recent' && (projects.length ? projects.map((project, i) => <Button key={project.id} title={`${i + 1}. ${new Date(project.createdAt).toLocaleString()}${project.id === view?.project.id ? ' · 현재' : ''}`} secondary disabled={disabled || project.id === view?.project.id} onPress={() => openProject(project.id)} />) : <Text style={styles.help}>아직 보관한 작업이 없어요. 사진을 선택해 시작하세요.</Text>)}
          {moreTab === 'settings' && <><Text style={styles.help}>개발 서버 연결 · 휴대폰과 같은 네트워크를 사용하세요.</Text><TextInput accessibilityLabel="개발 서버 주소" style={styles.input} value={connection.url} onChangeText={url => setConnection(current => ({ ...current, url }))} autoCapitalize="none" autoCorrect={false} editable={!disabled} /><TextInput accessibilityLabel="개발 서버 연결 코드" placeholder="연결 코드 · 모델 API 키 아님" secureTextEntry style={styles.input} value={connection.token} onChangeText={token => setConnection(current => ({ ...current, token }))} autoCapitalize="none" editable={!disabled} /><Button title="연결 확인" onPress={check} disabled={disabled} secondary />{status && <Text style={styles.help}>예약 / 설정 한도 · SAM {status.usage.sam.reserved}/{status.usage.sam.cap} · 이미지 {status.usage.image.reserved}/{status.usage.image.cap}</Text>}</>}
          {moreTab === 'jobs' && <><Text selectable style={styles.help}>{message}</Text>{exportMessage ? <Text selectable style={styles.help}>{exportMessage}</Text> : null}<Text style={styles.help}>{saveState || '작업을 시작하면 자동으로 보관합니다.'}</Text>{pendingJob && <><Button title="마지막 AI 작업 확인" disabled={disabled} secondary onPress={checkJob} /><Button title="확인 후 새 요청 허용" disabled={disabled} secondary onPress={allowNewJob} /></>}{view && <Text style={styles.help}>{view.width} × {view.height} PNG</Text>}</>}
        </>}
      </ScrollView>
    </View>}

    {!keyboardOpen && <View style={styles.bottomBar}>
      <Pressable accessibilityRole="button" accessibilityLabel="누르고 원본 보기" onPressIn={() => setCompare(true)} onPressOut={() => setCompare(false)} disabled={controlsDisabled || !view} style={[styles.bottomButton, (controlsDisabled || !view) && styles.disabled]}><Text style={styles.bottomText}>◫ 원본</Text></Pressable>
      <View style={styles.bottomCenter}>{dirty && draft ? <Button title="변경 적용" disabled={controlsDisabled} onPress={() => render(draft)} /> : picking ? <Button title="선택 화면 닫기" secondary disabled={controlsDisabled} onPress={() => setPicking(false)} /> : <Pressable accessibilityRole="button" disabled={controlsDisabled || !view} onPress={() => { setPositionTab('ratio'); setActiveTool('position'); }} style={styles.ratioChip}><Text style={styles.ratioText}>{draft ? ({ portrait: '4:5', story: '9:16', square: '1:1' }[draft.ratio]) : '사진 편집'}</Text></Pressable>}</View>
      <Pressable accessibilityRole="button" accessibilityLabel="완성 사진 공유" disabled={controlsDisabled || !view || dirty} onPress={() => save(true)} style={[styles.bottomButton, (controlsDisabled || !view || dirty) && styles.disabled]}><Text style={styles.bottomText}>공유 ↗</Text></Pressable>
    </View>}
  </View></KeyboardAvoidingView></SafeAreaView>;
}
export default function App() { return <SafeAreaProvider><Editor /></SafeAreaProvider>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#19171F' }, editor: { flex: 1 },
  top: { height: 56, paddingHorizontal: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, brand: { fontSize: 22, fontWeight: '700', color: '#FFF', letterSpacing: -1 }, brandDot: { color: '#B5A0EF' }, eyebrow: { color: '#ABA1B8', fontSize: 9, marginTop: 2, letterSpacing: 1.2 }, topIcon: { width: 40, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#302D38' }, topIconText: { fontSize: 24, color: '#fff' }, topSave: { backgroundColor: '#E8DFFA', borderRadius: 20, height: 38, paddingHorizontal: 20, justifyContent: 'center' }, topSaveText: { color: '#403150', fontSize: 12, fontWeight: '700' },
  stage: { flex: 1, minHeight: 0 }, canvasArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingLeft: 10, paddingVertical: 10 }, canvas: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#EEE8DF' }, railPosition: { position: 'absolute', right: 10, top: 8 }, fixtureBadge: { position: 'absolute', bottom: 8, left: 8, right: 8, alignItems: 'center' }, fixtureText: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: '#ffffffcc', color: '#6B6077', fontSize: 8 },
  empty: { alignItems: 'center', gap: 15, maxWidth: 280 }, emptyMark: { color: '#AC96DD', fontSize: 60, lineHeight: 64 }, emptyTitle: { color: '#F5F0FA', fontSize: 25, lineHeight: 34, fontWeight: '700', textAlign: 'center', letterSpacing: -0.8 }, emptyHint: { fontSize: 11, lineHeight: 17, color: '#AFA4BB', textAlign: 'center' }, sampleLink: { padding: 6 }, sampleText: { color: '#C3B3DF', fontSize: 11 },
  status: { height: 34, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 17 }, dot: { color: '#A58BD8', fontSize: 7 }, statusText: { flex: 1, color: '#B8ADC6', fontSize: 10, lineHeight: 14 },
  sheet: { backgroundColor: '#FAF8F5', borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden' }, sheetHeader: { height: 42, paddingLeft: 18, paddingRight: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sheetTitle: { color: '#352C40', fontSize: 14, fontWeight: '700' }, closeButton: { width: 42, height: 38, alignItems: 'center', justifyContent: 'center' }, closeText: { color: '#776B82', fontSize: 25 }, sheetScroll: { flex: 1 }, sheetContent: { paddingHorizontal: 17, paddingTop: 8, paddingBottom: 16, gap: 10 }, tabs: { flexDirection: 'row', gap: 5, paddingHorizontal: 16, paddingBottom: 5 }, tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 29, borderRadius: 9, backgroundColor: '#EFEBF2' }, tabSelected: { backgroundColor: '#DDD2EE' }, tabLabel: { color: '#887A95', fontSize: 11 }, tabSelectedLabel: { color: '#514064', fontWeight: '700' },
  row: { flexDirection: 'row', gap: 7, alignItems: 'center' }, wrap: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' }, grow: { flex: 1 }, button: { backgroundColor: '#7762C9', borderRadius: 12, paddingHorizontal: 13, minHeight: 38, alignItems: 'center', justifyContent: 'center' }, secondary: { backgroundColor: '#EFEBF4' }, selected: { backgroundColor: '#7762C9' }, disabled: { opacity: 0.35 }, buttonText: { color: '#fff', fontWeight: '700', fontSize: 11 }, secondaryText: { color: '#66547E' }, input: { backgroundColor: '#EFECF2', borderRadius: 11, padding: 11, color: '#352C40', fontSize: 12, minHeight: 40 }, help: { color: '#8A7F94', fontSize: 11, lineHeight: 17 }, panelTitle: { color: '#51435F', fontSize: 12, fontWeight: '600' }, stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, stepLabel: { fontSize: 12, color: '#62556F' }, value: { width: 34, textAlign: 'center', color: '#62556F', fontVariant: ['tabular-nums'], fontSize: 12 }, swatch: { height: 36, width: 36, borderRadius: 18, borderWidth: 3 },
  bottomBar: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, gap: 8 }, bottomButton: { paddingHorizontal: 10, paddingVertical: 12, minWidth: 66, alignItems: 'center' }, bottomText: { color: '#EEE7F7', fontSize: 12, fontWeight: '600' }, bottomCenter: { flex: 1, alignItems: 'center' }, ratioChip: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 18, backgroundColor: '#302D38' }, ratioText: { color: '#C3B4D8', fontSize: 11, fontWeight: '600' },
});
