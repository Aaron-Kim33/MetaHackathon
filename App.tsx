import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
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

type ButtonProps = { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; selected?: boolean };
function Button({ title, onPress, disabled, secondary, selected }: ButtonProps) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled, selected: !!selected }} onPress={onPress} disabled={disabled} style={[styles.button, secondary && styles.secondary, selected && styles.selected, disabled && styles.disabled]}><Text style={[styles.buttonText, secondary && styles.secondaryText, selected && { color: '#fff' }]}>{title}</Text></Pressable>;
}
function Stepper({ title, value, onChange, step, min, max, disabled }: { title: string; value: number; onChange: (n: number) => void; step: number; min: number; max: number; disabled: boolean }) {
  return <View style={styles.stepRow}><Text style={styles.stepLabel}>{title}</Text><View style={styles.row}><Button title="−" secondary disabled={disabled || value <= min} onPress={() => onChange(Math.max(min, Number((value - step).toFixed(2))))} /><Text style={styles.value}>{Math.round(value * 100)}</Text><Button title="+" secondary disabled={disabled || value >= max} onPress={() => onChange(Math.min(max, Number((value + step).toFixed(2))))} /></View></View>;
}

function Editor() {
  const [connection, setConnection] = useState<Connection>(initialConnection);
  const [showSettings, setShowSettings] = useState(!initialConnection.token);
  const [view, setView] = useState<ProjectView | null>(null), [draft, setDraft] = useState<EditOptions | null>(null);
  const [history, setHistory] = useState<EditOptions[]>([]), [projects, setProjects] = useState<Snapshot['projects']>([]);
  const [pendingJob, setPendingJob] = useState<string | null>(null), [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(''), [message, setMessage] = useState('사진 한 장으로, 프레임 밖으로.'), [saveState, setSaveState] = useState('');
  const [exportMessage, setExportMessage] = useState('');
  const [interacting, setInteracting] = useState(false), [maskOpen, setMaskOpen] = useState(false);
  const [status, setStatus] = useState<{ modelConfigured: boolean; creditsConfirmed: boolean; usage: Usage } | null>(null);
  const [picking, setPicking] = useState(false), [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [prompt, setPrompt] = useState('person'), [decorationPrompt, setDecorationPrompt] = useState('a purple crystal');
  const lock = useRef(false), alive = useRef(true);
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
    if (initialConnection.token) request<{ modelConfigured: boolean; creditsConfirmed: boolean; usage: Usage }>(initialConnection, '/status').then(setStatus).catch(() => setMessage('PC 서버에 연결하지 못했어요. 설정에서 연결을 확인해 주세요.'));
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
    setView(next); setDraft(next.options); setPicking(next.project.candidates.length > 1 && !next.project.selectedId); setPoint(null);
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
  const change = <K extends keyof EditOptions>(name: K, value: EditOptions[K]) => setDraft(current => current ? { ...current, [name]: value } : current);
  const dirty = !!view && !!draft && JSON.stringify(view.options) !== JSON.stringify(draft);
  const disabled = !!busy || !ready;
  const useFixture = () => { void task('연습용 그림을 여는 중', async () => { accept(await request<ProjectView>(connection, '/fixture', {})); setHistory([]); setMessage('직접 그린 테스트 그림이에요. 실제 SAM 결과가 아닙니다.'); }); };
  const check = () => { void task('PC 연결을 확인하는 중', async () => { const next = await request<{ modelConfigured: boolean; creditsConfirmed: boolean; usage: Usage }>(connection, '/status'); setStatus(next); setMessage(!next.modelConfigured ? 'PC 연결 완료. Meta 키는 아직 설정되지 않았어요.' : !next.creditsConfirmed ? '키 설정은 있어요. PC에서 Billing의 대회 크레딧 지급 확인을 완료해 주세요.' : '키 설정과 크레딧 수동 확인 기록이 있어요. 실제 잔액과 모델 호출 성공은 별도 확인이 필요해요.'); }); };
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
  return <SafeAreaView style={styles.safe}><StatusBar style="dark" /><ScrollView scrollEnabled={!interacting} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <View style={styles.top}><View><Text style={styles.eyebrow}>REEL TALK / CREATIVE STUDIO</Text><Text style={styles.brand}>밖으로, 톡.</Text></View><Pressable accessibilityRole="button" onPress={() => setShowSettings(!showSettings)}><Text style={styles.settings}>설정</Text></Pressable></View>
    <Text style={styles.subtitle}>내 사진이 프레임을 벗어나는 순간.</Text>
    {showSettings && <View style={styles.panel}><Text style={styles.panelTitle}>PC 연결</Text><Text style={styles.help}>휴대폰과 PC를 같은 Wi-Fi에 연결하세요.</Text><TextInput accessibilityLabel="PC 서버 주소" style={styles.input} value={connection.url} onChangeText={url => setConnection(current => ({ ...current, url }))} autoCapitalize="none" autoCorrect={false} editable={!disabled} /><TextInput accessibilityLabel="PC 연결 코드" placeholder="PC 연결 코드 · 모델 API 키 아님" secureTextEntry style={styles.input} value={connection.token} onChangeText={token => setConnection(current => ({ ...current, token }))} autoCapitalize="none" editable={!disabled} /><Button title="연결 확인" onPress={check} disabled={disabled} secondary />{status && <Text style={styles.help}>예약된 호출 / 설정 한도 · SAM {status.usage.sam.reserved}/{status.usage.sam.cap} · 이미지 {status.usage.image.reserved}/{status.usage.image.cap}</Text>}</View>}
    <View style={styles.row}><View style={{ flex: 1 }}><Button title={view ? '새 사진' : '사진 선택'} onPress={choosePhoto} disabled={disabled} /></View><View style={{ flex: 1 }}><Button title="연습용 그림" onPress={useFixture} secondary disabled={disabled} /></View></View>
    <View style={styles.canvas}>
      {!view ? <View style={styles.empty}><Text style={styles.emptyMark}>↗</Text><Text style={styles.emptyTitle}>평범한 한 장에서{ '\n' }입체적인 한 장으로.</Text><Text style={styles.help}>사진을 선택해 시작하세요.</Text></View> : picking ? <SourcePicker view={view} point={point} onPoint={setPoint} disabled={disabled} /> : <GestureCanvas view={view} options={draft || view.options} disabled={disabled} onInteracting={setInteracting} onCommit={options => { setDraft(options); render(options); }} />}
      {view?.project.provenance === 'synthetic-fixture' && <View style={styles.fixtureBadge}><Text style={styles.fixtureText}>연습용 벡터 그림 · AI 분리 아님</Text></View>}
    </View>
    <View style={styles.message}>{busy ? <ActivityIndicator color="#7260cb" /> : <Text style={styles.dot}>●</Text>}<Text accessibilityLiveRegion="polite" style={styles.messageText}>{message}</Text></View>
    {pendingJob && <View style={styles.panel}><Text style={styles.panelTitle}>AI 작업 상태 확인</Text><Button title="마지막 작업 확인" disabled={disabled} secondary onPress={() => { void task('작업 상태를 확인하는 중', async () => {
      const job = await request<{ status: string; message?: string; result?: { projectId: string } }>(connection, `/jobs/${pendingJob}`);
      if (job.status === 'succeeded' && job.result) { accept(await request<ProjectView>(connection, `/projects/${job.result.projectId}`)); setPendingJob(null); setMessage('완료된 결과를 불러왔어요.'); }
      else setMessage(job.message || `작업 상태: ${job.status}. 자동 재호출하지 않아요.`);
    }); }} /><Button title="확인 후 새 요청 허용" disabled={disabled} secondary onPress={() => Alert.alert('새 요청 허용', '이전 호출은 이미 비용이 발생했을 수 있어요. 제공자 사용량과 작업 상태를 확인한 뒤 새 요청을 진행하세요.', [{ text: '취소' }, { text: '확인했어요', onPress: () => { setPendingJob(null); setMessage('새 요청을 허용했어요. 이전 호출 예약은 유지돼요.'); } }])} /></View>}
    {view && <>
      <View style={styles.panel}><Text style={styles.panelTitle}>01 · 튀어나올 대상</Text><View style={styles.row}><View style={{ flex: 1 }}><Button title={picking ? '합성 보기' : '사진에서 선택'} secondary disabled={disabled} onPress={() => { setPicking(!picking); setPoint(null); }} /></View><View style={{ flex: 1 }}><Button title="SAM으로 분리" disabled={disabled || !modelsAllowed || !!pendingJob} onPress={() => modelTask('/segment', { point, prompt }, 'SAM이 피사체를 분리하는 중')} /></View></View>{picking && <Text style={styles.help}>{point ? '선택한 점으로 분리합니다.' : '원본 사진에서 인물·소품을 탭하세요.'}</Text>}<TextInput accessibilityLabel="분리할 대상 설명" style={styles.input} value={prompt} onChangeText={setPrompt} placeholder="예: person, sunglasses" editable={!disabled} /><Text style={styles.help}>분리를 누르면 사진을 Meta에 전송하며 SAM 호출 1회를 사용해요. 점 선택을 하지 않으면 설명에 맞는 후보를 찾습니다.</Text>{view.project.candidates.length > 1 && <Text style={styles.help}>여러 후보가 있어요. 하나를 선택하세요.</Text>}<Button title="누끼 다듬기" secondary disabled={disabled || !view.subject} onPress={() => setMaskOpen(true)} /><View style={styles.wrap}>{view.project.candidates.map(candidate => <Button key={candidate.id} title={candidate.label} secondary selected={view.project.selectedId === candidate.id} disabled={disabled} onPress={() => { void task('대상을 선택하는 중', async () => { accept(await request<ProjectView>(connection, '/select', { projectId: view.project.id, candidateId: candidate.id })); setMessage('선택한 피사체를 적용했어요.'); }); }} />)}</View>{!modelsAllowed && <Text style={styles.help}>설정에서 연결 확인을 눌러 Meta 사용 준비 상태를 확인하세요.</Text>}</View>
      {draft && <View style={styles.panel}><View style={styles.sectionHeading}><Text style={styles.panelTitle}>02 · 입체감 조절</Text><Text style={styles.help}>추가 AI 호출 없음</Text></View><View style={styles.wrap}>{(['portrait', 'story', 'square'] as const).map((ratio, i) => <Button key={ratio} title={['4:5', '9:16', '1:1'][i]} secondary selected={draft.ratio === ratio} disabled={disabled} onPress={() => change('ratio', ratio)} />)}</View><Stepper title="사진 확대" value={draft.zoom} step={0.05} min={0.8} max={2.4} disabled={disabled} onChange={value => change('zoom', value)} /><Stepper title="좌우 위치" value={draft.x} step={0.05} min={-0.8} max={0.8} disabled={disabled} onChange={value => change('x', value)} /><Stepper title="상하 위치" value={draft.y} step={0.05} min={-0.8} max={0.8} disabled={disabled} onChange={value => change('y', value)} /><Stepper title="그림자" value={draft.shadow} step={0.1} min={0} max={0.8} disabled={disabled} onChange={value => change('shadow', value)} /><View style={styles.wrap}>{['#EEE8DF', '#DDE9E4', '#DFDDF1', '#F0DCD4', '#253043'].map(color => <Pressable key={color} accessibilityRole="button" accessibilityLabel={`배경 ${color}`} accessibilityState={{ selected: draft.background === color }} onPress={() => change('background', color)} disabled={disabled} style={[styles.swatch, { backgroundColor: color, borderColor: draft.background === color ? '#7260cb' : 'transparent' }]} />)}</View>{view.project.decoration && <><Text style={styles.help}>장식 위치와 앞뒤</Text><View style={styles.row}><Button title="인물 앞" secondary selected={draft.decorationDepth === 'front'} disabled={disabled} onPress={() => change('decorationDepth', 'front')} /><Button title="인물 뒤" secondary selected={draft.decorationDepth === 'back'} disabled={disabled} onPress={() => change('decorationDepth', 'back')} /></View><Stepper title="장식 좌우" value={draft.decorationX} step={0.05} min={0} max={1} disabled={disabled} onChange={value => change('decorationX', value)} /><Stepper title="장식 상하" value={draft.decorationY} step={0.05} min={0} max={1} disabled={disabled} onChange={value => change('decorationY', value)} /><Stepper title="장식 크기" value={draft.decorationScale} step={0.05} min={0.08} max={0.65} disabled={disabled} onChange={value => change('decorationScale', value)} /></>}<View style={styles.row}><View style={{ flex: 1 }}><Button title="변경 적용" disabled={disabled || !dirty} onPress={() => render(draft)} /></View><View style={{ flex: 1 }}><Button title="실행 취소" secondary disabled={disabled || history.length === 0} onPress={() => render(history[history.length - 1], true)} /></View></View>{dirty && <Text style={styles.help}>조절한 뒤 변경 적용을 눌러 미리보기를 갱신하세요.</Text>}</View>}
      <View style={styles.panel}><Text style={styles.panelTitle}>03 · 나만의 장식</Text><Text style={styles.help}>설명을 Meta에 보내 이미지를 1회 생성합니다. 배경 분리는 별도 SAM 호출 1회예요.</Text><TextInput accessibilityLabel="생성할 장식 설명" style={styles.input} value={decorationPrompt} onChangeText={setDecorationPrompt} editable={!disabled} placeholder="예: a purple crystal" maxLength={500} /><Button title="Muse Image로 장식 만들기" secondary disabled={disabled || !modelsAllowed || !!pendingJob} onPress={() => modelTask('/decoration', { prompt: decorationPrompt }, 'Muse Image가 장식을 만드는 중')} />{view.project.decorationPending && <><Text style={styles.help}>생성 완료. SAM으로 배경을 분리하면 앞뒤 배치가 가능해요.</Text><Button title="생성한 장식 배경 분리" disabled={disabled || !modelsAllowed || !!pendingJob} onPress={() => modelTask('/decoration/segment', {}, '장식 배경을 분리하는 중')} /></>}{view.project.decoration && <Button title="장식 숨기기" secondary disabled={disabled} onPress={() => { void task('장식을 숨기는 중', async () => { accept(await request<ProjectView>(connection, '/decoration/remove', { projectId: view.project.id })); setMessage('장식을 숨겼어요.'); }); }} />}</View>
      <View style={styles.panel}><Text style={styles.panelTitle}>완성된 한 장</Text><View style={styles.row}><View style={{ flex: 1 }}><Button title="앨범 저장" disabled={disabled || dirty} onPress={() => save()} /></View><View style={{ flex: 1 }}><Button title="공유" secondary disabled={disabled || dirty} onPress={() => save(true)} /></View></View><Text style={styles.help}>{view.width} × {view.height} PNG · {saveState}</Text><Text accessibilityLiveRegion="polite" style={styles.help}>{exportMessage || "앨범 저장은 휴대폰 사진 보관함에, 공유는 선택한 앱으로 전달합니다."}</Text></View>
    </>}
    {projects.length > 1 && <View style={styles.panel}><Text style={styles.panelTitle}>최근 작업</Text>{projects.slice(0, 5).map((project, i) => <Button key={project.id} title={`${i + 1}. ${new Date(project.createdAt).toLocaleString()}${project.id === view?.project.id ? ' · 현재' : ''}`} secondary disabled={disabled || project.id === view?.project.id} onPress={() => { void task('작업을 불러오는 중', async () => { accept(await request<ProjectView>(connection, `/projects/${project.id}`)); setHistory([]); setMessage('이전 작업을 열었어요.'); }); }} />)}</View>}
    <Text style={styles.footer}>REEL TALK · META HACKATHON 2026{ '\n' }원본의 얼굴과 포즈를 유지하는 레이어 합성</Text>
  </ScrollView>{view && <MaskEditor visible={maskOpen} view={view} onClose={() => setMaskOpen(false)} onApply={strokes => correctMask(strokes)} onReset={() => correctMask([], true)} />}</SafeAreaView>;
}
export default function App() { return <SafeAreaProvider><Editor /></SafeAreaProvider>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F8F6F2' }, page: { padding: 20, gap: 16, paddingBottom: 48, width: '100%', maxWidth: 620, alignSelf: 'center' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }, eyebrow: { color: '#8A7B68', letterSpacing: 1.7, fontSize: 9, fontWeight: '700' }, brand: { color: '#253043', fontSize: 36, fontWeight: '800', letterSpacing: -1.7, marginTop: 8 }, settings: { color: '#7260cb', fontWeight: '700', padding: 10 }, subtitle: { color: '#807C78', fontSize: 14, marginTop: -8 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' }, wrap: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' }, button: { backgroundColor: '#7260cb', borderRadius: 14, paddingHorizontal: 17, minHeight: 46, alignItems: 'center', justifyContent: 'center' }, secondary: { backgroundColor: '#EFEDF5' }, selected: { backgroundColor: '#7260cb' }, disabled: { opacity: 0.4 }, buttonText: { color: '#fff', fontWeight: '700', fontSize: 13 }, secondaryText: { color: '#5D5385' },
  panel: { backgroundColor: '#fff', borderRadius: 21, padding: 17, gap: 13, borderWidth: 1, borderColor: '#EEEAE4' }, panelTitle: { color: '#253043', fontSize: 15, fontWeight: '700' }, help: { color: '#8A8590', fontSize: 11, lineHeight: 17 }, input: { backgroundColor: '#F8F6FA', borderRadius: 12, padding: 13, color: '#253043', fontSize: 13, borderWidth: 1, borderColor: '#EAE6F0' },
  canvas: { borderRadius: 24, overflow: 'hidden', backgroundColor: '#EEE8DF', borderWidth: 1, borderColor: '#E5DFD7' }, empty: { padding: 34, alignItems: 'center', minHeight: 340, justifyContent: 'center', gap: 18 }, emptyMark: { fontSize: 70, color: '#B7A8D6' }, emptyTitle: { textAlign: 'center', color: '#62586F', fontSize: 24, lineHeight: 34, fontWeight: '700', letterSpacing: -0.8 },
  point: { position: 'absolute', width: 24, height: 24, borderRadius: 12, borderWidth: 3, borderColor: '#fff', backgroundColor: '#7260cb99' }, fixtureBadge: { position: 'absolute', bottom: 12, alignSelf: 'center', backgroundColor: '#ffffffdd', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 30 }, fixtureText: { fontSize: 10, color: '#6D607C' },
  message: { flexDirection: 'row', gap: 8, paddingHorizontal: 4, alignItems: 'center' }, dot: { color: '#9381cc', fontSize: 9 }, messageText: { flex: 1, color: '#726A7C', fontSize: 12, lineHeight: 19 }, sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, stepLabel: { fontSize: 13, color: '#625B6A' }, value: { width: 36, textAlign: 'center', color: '#625B6A', fontVariant: ['tabular-nums'] }, swatch: { height: 35, width: 35, borderRadius: 18, borderWidth: 3 }, footer: { color: '#AAA2A0', fontSize: 10, lineHeight: 19, textAlign: 'center', letterSpacing: 0.5, marginTop: 10 },
});
