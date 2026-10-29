import { LocalizedText as Text } from './src/i18n-react';
import { chooseLanguage, initializeLanguage, useLanguage } from './src/i18n-react';
import { t } from './src/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, Vibration, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as FS from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { Connection, EditOptions, ProjectView, Usage, initialConnection, jobId, request } from './src/client';
import { PHOTO_FRAME_PRESET } from './src/frame-preset';
import { DeviceMotion } from 'expo-sensors';
import { spatialRendererAvailable } from './src/spatial-renderer';
import { reportCutoutDiagnostic,reportSpatialDiagnostic } from './src/render-diagnostics';
import type { DepthFrame } from './src/depth-mesh';
import { cutoutTarget } from './src/cutout-target';
import { PhotoLiftPicker } from './src/PhotoLiftPicker';
import { AssetRepairPanel } from './src/AssetRepairPanel';
import { StickerCreator } from './src/StickerCreator';
import type { ReusableAsset } from './src/client';
import { deviceCutout, deviceCutoutAvailable } from './src/device-cutout';
import { COMPOSITION_VERSION } from './src/composition-scene';
import { Snapshot, exportPhoto, persist, restore } from './src/persistence';
import { photoDestination, saveToPhotos } from './src/photos';
import { keepSceneVisible, recoverScene } from './src/viewport';
import { orderedLayers } from './src/layer-order';
import { sameOptions, moveLayer, rebaseOptions } from './src/edit-performance';
import { DragTrash } from './src/DragTrash';
import type { TrashBounds, TrashState } from './src/drag-delete';
import { GestureCanvas } from './src/GestureCanvas';
import { MaskEditor } from './src/MaskEditor';
import { SourcePicker } from './src/SourcePicker';
import type { BrushStroke } from './src/layout';
import { photoLayout } from './src/layout';
import { ToolRail, EDITOR_TOOLS } from './src/ToolRail';
import { ToolSheet } from './src/ToolSheet';
import { editorLayout, fitCanvas } from './src/editor-layout';
import type { ToolId } from './src/editor-layout';

type ButtonProps = { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; selected?: boolean };
const themeName = (mode?: EditOptions['mode']) => mode === 'plain' ? t("기본 편집") : mode === 'sticker' ? t("투명 스티커") : t("폰 팝아웃");
function Button({ title, onPress, disabled, secondary, selected }: ButtonProps) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled, selected: !!selected }} onPress={onPress} disabled={disabled} style={[styles.button, secondary && styles.secondary, selected && styles.selected, disabled && styles.disabled]}><Text style={[styles.buttonText, secondary && styles.secondaryText, selected && { color: '#fff' }]}>{title}</Text></Pressable>;
}
function Stepper({ title, value, onChange, step, min, max, disabled, unit }: { title: string; value: number; onChange: (n: number) => void; step: number; min: number; max: number; disabled: boolean; unit?: 'degrees' }) {
  return <View style={styles.stepRow}><Text style={styles.stepLabel}>{title}</Text><View style={styles.row}><Button title="−" secondary disabled={disabled || value <= min} onPress={() => onChange(Math.max(min, Number((value - step).toFixed(2))))} /><Text style={styles.value}>{unit === 'degrees' ? `${Math.round(value)}°` : Math.round(value * 100)}</Text><Button title="+" secondary disabled={disabled || value >= max} onPress={() => onChange(Math.min(max, Number((value + step).toFixed(2))))} /></View></View>;
}

function Tabs<T extends string>({ items, value, onChange }: { items: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return <View style={styles.tabs}>{items.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: value === item.id }} onPress={() => onChange(item.id)} style={[styles.tab, value === item.id && styles.tabSelected]}><Text style={[styles.tabLabel, value === item.id && styles.tabSelectedLabel]}>{item.label}</Text></Pressable>)}</View>;
}

function Editor() {
  const language=useLanguage();
  const viewport = useWindowDimensions(), insets = useSafeAreaInsets();
  const [connection, setConnection] = useState<Connection>(initialConnection);
  const [activeTool, setActiveTool] = useState<ToolId | null>(initialConnection.token ? null : 'more');
  const [themeTab, setThemeTab] = useState<'theme' | 'background'>('theme');
  const [positionTab, setPositionTab] = useState<'move' | 'shadow' | 'ratio'>('move');
  const [generatedSticker, setGeneratedSticker] = useState<ReusableAsset|null>(null);
  const [moreTab, setMoreTab] = useState<'settings' | 'jobs'>(initialConnection.token ? 'jobs' : 'settings');
  const [deviceCutoutError, setDeviceCutoutError] = useState('');
  const [cutoutNotice, setCutoutNotice] = useState<{ state: 'working' | 'success' | 'error'; text: string } | null>(null);
  const [assetPanel,setAssetPanel]=useState<{target:string|null;assetId:string|null;mode?:'library'|'retouch'}|null>(null);
  const [importPicking, setImportPicking] = useState(false);
  const [depthFrame, setDepthFrame] = useState<DepthFrame | null>(null);
  const [spatialCalibration, setSpatialCalibration] = useState(0);
  const [compare, setCompare] = useState(false), [keyboardOpen, setKeyboardOpen] = useState(false);
  const [rootHeight, setRootHeight] = useState(viewport.height);
  const [stage, setStage] = useState({ width: viewport.width, height: Math.max(0, viewport.height - 146) });
  const [view, setView] = useState<ProjectView | null>(null), [draft, setDraft] = useState<EditOptions | null>(null);
  const [history, setHistory] = useState<EditOptions[]>([]);
  const [activeStickerId, setActiveStickerId] = useState<string | null>('primary');
  const [maskTarget, setMaskTarget] = useState<ProjectView | null>(null);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null), [maskStickerId, setMaskStickerId] = useState<string | null>(null);
  const [pendingJob, setPendingJob] = useState<string | null>(null), [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(''), [message, setMessage] = useState(t("사진을 열어 AI 편집을 시작하세요.")), [saveState, setSaveState] = useState('');
  const [exportMessage, setExportMessage] = useState('');
  const [trashState, setTrashState] = useState<TrashState>({ visible: false, over: false });
  const [trashBounds, setTrashBounds] = useState<TrashBounds | null>(null);
  const [interacting, setInteracting] = useState(false), [maskOpen, setMaskOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [status, setStatus] = useState<{ modelConfigured: boolean; creditsConfirmed: boolean; usage: Usage } | null>(null);
  const [selectionView, setSelectionView] = useState<ProjectView | null>(null);
  const [selectionStickerId, setSelectionStickerId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false), [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [prompt, setPrompt] = useState('person');
  const lock = useRef(false), alive = useRef(true);
  const previewFlight = useRef<Promise<void> | null>(null);
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
  const latestSnapshot = useRef<Snapshot>({ view, draft, history, activeStickerId, pendingJob });
  latestSnapshot.current = { view, draft, history, activeStickerId, pendingJob };
  useEffect(() => {
    if (!ready) return;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') void persist(latestSnapshot.current).catch(() => {});
    });
    return () => subscription.remove();
  }, [ready]);
  useEffect(() => {
    if (initialConnection.token) request<{ modelConfigured: boolean; creditsConfirmed: boolean; usage: Usage }>(initialConnection, '/status').then(setStatus).catch(() => setMessage(t("개발 서버에 연결하지 못했어요. 설정에서 연결을 확인해 주세요.")));
  }, []);
  useEffect(() => {
    alive.current = true;
    restore().then(async snapshot => {
      if (!snapshot?.view && initialConnection.token) {
        try { snapshot = (await request<{ snapshot: Snapshot | null }>(initialConnection, '/editor-state')).snapshot; } catch { /* A new/offline install can start empty. */ }
      }
      if (snapshot?.view) {
        try { const remote = await request<ProjectView>(initialConnection, `/projects/${snapshot.view.project.id}`); snapshot = { ...snapshot, view: remote, draft: keepSceneVisible(rebaseOptions(snapshot.draft || remote.options, remote), remote) }; } catch { /* Keep the last device draft when offline. */ }
      }
      if(snapshot?.pendingJob&&snapshot.view?.usage.sam.cap===null&&snapshot.view?.usage.image.cap===null){
        try{const prior=await request<{appLimitBlocked?:boolean}>(initialConnection,`/jobs/${snapshot.pendingJob}`);if(prior.appLimitBlocked)snapshot={...snapshot,pendingJob:null};}catch{/* Keep genuinely uncertain jobs until their status can be checked. */}
      }
      if (!alive.current) return;
      if (snapshot) { setView(snapshot.view); setDraft(snapshot.draft || snapshot.view?.options || null); setHistory(snapshot.history || []); setActiveStickerId(snapshot.activeStickerId || null); setPendingJob(snapshot.pendingJob); setMessage(snapshot.pendingJob ? t("미확인 AI 작업이 있어요. 상태 확인 후 계속해 주세요.") : t("마지막 편집을 복원했어요.")); }
    }).catch(() => setMessage(t("보관한 작업을 읽지 못했어요. 새 사진으로 시작할 수 있어요."))).finally(() => setReady(true));
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!ready || interacting) return;
    const timer = setTimeout(() => {
      const snapshot = latestSnapshot.current;
      setSaveState(t("저장 중")); persist(snapshot).then(() => setSaveState(t("기기에 보관됨"))).catch(() => setSaveState(t("기기 저장 실패 · 저장 공간 확인")));
      if (snapshot.view) void request(connection, '/editor-state', { projectId: snapshot.view.project.id, pendingJob: snapshot.pendingJob }).catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [ready, view, draft, history, pendingJob, interacting]);
  const accept = (next: ProjectView) => {
    setExportMessage(''); setDepthFrame(null);
    const needsSelection = next.project.candidates.length > 1 && !next.project.selectedId;
    if (needsSelection) setActiveTool('subject');
    else if (view?.project.id !== next.project.id) setActiveTool(null);
    setView(next); setDraft(next.options); setSelectionView(null); setSelectionStickerId(null); setPicking(needsSelection); setPoint(null);
    setStatus(current => current ? { ...current, usage: next.usage } : current);
  };
  const task = async (label: string, action: () => Promise<void>) => {
    if (lock.current || !ready) return;
    lock.current = true; setBusy(label); setMessage(label);
    try { await previewFlight.current; await action(); } catch (error) { setMessage(error instanceof Error ? error.message : t("작업을 완료하지 못했어요.")); }
    finally { setBusy(''); lock.current = false; }
  };
  const pickPhotoData = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled) return null;
    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > 12000000) throw new Error(t("12MB 이하의 사진을 선택해 주세요."));
    return FS.readAsStringAsync(asset.uri, { encoding: FS.EncodingType.Base64 });
  };
  const choosePhoto = () => { void task(t("사진을 불러오는 중"), async () => {
    const image = await pickPhotoData();
    if (!image) { setMessage(t("사진 선택을 취소했어요.")); return; }
    if (view) {
      await savePendingOptions();
      const next = await request<ProjectView>(connection, '/imports', { projectId: view.project.id, image });
      accept(next); openImported(next); setMessage(t("기존 작업은 유지돼요. 추가 사진의 피사체를 꾹 눌러 스티커로 만드세요. 잘 안 되면 수동으로 자를 수 있어요."));
    } else { accept(await request<ProjectView>(connection, '/projects', { image })); setHistory([]); setActiveStickerId('primary'); setMessage(t("사진을 불러왔어요. 피사체 분리·장식·테마로 편집해 보세요.")); }
  }); };
  const replaceMainPhoto = () => {
    if (!view || pendingJob) return;
    void task(t("메인 사진을 변경하는 중"), async () => {
      const image = await pickPhotoData();
      if (!image) { setMessage(t("메인 사진 변경을 취소했어요.")); return; }
      await savePendingOptions();
      const next = await request<ProjectView>(connection, '/source/replace', { projectId: view.project.id, image });
      accept(next); setHistory([]); setActiveStickerId('primary'); setPicking(false);
      setMessage(next.options.mode === 'frame' ? t("메인 사진을 바꿨어요. 새 사진의 피사체를 분리하면 팝아웃에 적용돼요. 기존 스티커는 유지했어요.") : t("메인 사진을 바꿨어요. 기존 스티커와 배치는 유지했어요."));
    });
  };
  const chooseBackgroundPhoto = () => {
    if (!view) return;
    void task(t("배경 사진을 불러오는 중"), async () => {
      const image = await pickPhotoData();
      if (!image) { setMessage(t("배경 선택을 취소했어요.")); return; }
      await savePendingOptions();
      accept(await request<ProjectView>(connection, '/background', { projectId: view.project.id, image }));
      setHistory([]); setMessage(t("배경 사진을 바꿨어요. 메인 사진과 스티커는 유지돼요."));
    });
  };
  const removeBackgroundPhoto = () => {
    if (!view) return;
    void task(t("배경 사진을 지우는 중"), async () => {
      await savePendingOptions();
      accept(await request<ProjectView>(connection, '/background/remove', { projectId: view.project.id }));
      setHistory([]); setMessage(t("배경 사진을 지웠어요. 선택한 배경색을 사용해요."));
    });
  };
  const cutOnDevice = async (selectedPoint: { x: number; y: number } | null = null, assetId: string | null = null, stickerId: string | null = null) => {
    reportCutoutDiagnostic('hold',{locked:lock.current,pending:!!pendingJob,supported:deviceCutoutAvailable()},connection);
    if (!view || lock.current) return;
    lock.current = true; setDeviceCutoutError(''); setCutoutNotice({ state: 'working', text: t("피사체를 찾고 있어요… 손을 떼도 돼요.") }); Vibration.vibrate(25); setBusy(t("기기에서 피사체를 분리하는 중")); setMessage(t("기기에서 자동 분리 중이에요. 첫 실행은 모델 준비에 시간이 걸릴 수 있어요."));
    try {
      await previewFlight.current; await savePendingOptions();
      const target = stickerId ? selectionStickerId === stickerId && view.stickers?.some(item => item.id === stickerId) ? selectionView : null : view;
      const source = assetId ? view.pendingPhoto?.id === assetId ? view.pendingPhoto.source : null : target?.source;
      if (!source) throw new Error(t("가져온 사진이 변경됐어요. 다시 열어 주세요."));
      const result = await deviceCutout(source, selectedPoint);
      reportCutoutDiagnostic('mask-ready',{width:result.width,height:result.height,provider:result.provider},connection);
      const next = await request<ProjectView>(connection, '/cutout/device', { projectId: view.project.id, assetId, stickerId, sourceFile: view.project.sourceFile || 'source.png', baseRevision: (target || view).project.maskRevision || 0, ...result });
      accept(next); setHistory([]); setMaskOpen(false); setImportPicking(false); setPicking(false);
      reportCutoutDiagnostic('applied',{},connection);
      setActiveStickerId(stickerId || (assetId ? next.stickers?.at(-1)?.id || 'primary' : 'primary'));
      setCutoutNotice({ state: 'success', text: t("분리 완료! 피사체를 끌어서 옮겨 보세요.") }); Vibration.vibrate([0, 20, 70, 20]);
      setMessage(t("기기 자동 누끼를 적용했어요. Meta 호출 없이 분리했으며 기존 스티커와 배경은 유지돼요."));
    } catch (error) { const message=error instanceof Error ? error.message : t("자동 분리를 완료하지 못했어요.");reportCutoutDiagnostic('error',{error:message},connection);setDeviceCutoutError(message); throw error; } finally { lock.current = false; setBusy(''); }
  };
  const autoCut = (point: { x: number; y: number } | null = null, assetId: string | null = null, stickerId: string | null = null) => { void cutOnDevice(point, assetId, stickerId).catch(error => { const text = error instanceof Error ? error.message : t("자동 분리를 완료하지 못했어요."); setMessage(text); setCutoutNotice({ state: 'error', text }); Vibration.vibrate(80); }); };
  const toggleSpatial = () => {
    reportSpatialDiagnostic('requested',{stage:draft?.spatialEnabled?'close':'open',locked:lock.current},connection);
    if (!draft) return;
    if (draft.spatialEnabled) { render({ ...draft, spatialEnabled: false }); return; }
    void task(t("사진의 깊이를 분석하고 3D 화면을 준비하는 중"), async () => {
      if (!spatialRendererAvailable()) throw new Error(t("깊이 미리보기를 사용하려면 새 개발 앱(0.1.2)을 설치해 주세요. 저장된 작업은 유지돼요."));
      if (await AccessibilityInfo.isReduceMotionEnabled()) throw new Error(t("휴대폰 설정에서 동작 줄이기가 켜져 있어 기울기 효과가 꺼져 있어요."));
      if (!(await DeviceMotion.isAvailableAsync())) throw new Error(t("이 기기에서 기울기 센서를 사용할 수 없어요."));
      const permission = await DeviceMotion.requestPermissionsAsync();
      if (!permission.granted) throw new Error(t("기울기 미리보기를 사용하려면 설정에서 동작 센서 권한을 허용해 주세요."));
      await savePendingOptions();
      setDepthFrame(await request<DepthFrame>(connection, '/spatial', { projectId: view!.project.id, renderer: 'layered' }));
      reportSpatialDiagnostic('frame-ready',{},connection);
      setActiveStickerId(null); setActiveTool(null); setSpatialCalibration(n => n + 1); render({ ...draft, spatialEnabled: true });
      setMessage(t("사진의 깊이를 분석했어요. 천천히 좌우로 기울여 원근 변화를 확인하세요. 사진 저장은 정지 화면이에요."));
    });
  };
  useEffect(() => {
    if (!ready || !view || !draft?.spatialEnabled || depthFrame || busy) return;
    if (!spatialRendererAvailable()) { setDraft({ ...draft, spatialEnabled: false }); setMessage(t("3D 깊이 보기는 새 개발 앱으로 업데이트한 뒤 사용해 주세요.")); return; }
    void task(t("저장된 사진의 3D 깊이를 준비하는 중"), async () => {
      try { await savePendingOptions(); setDepthFrame(await request<DepthFrame>(connection, '/spatial', { projectId: view.project.id, renderer: 'layered' })); }
      catch (error) { setDraft(current => current ? { ...current, spatialEnabled: false } : current); throw error; }
    });
  }, [ready, view?.project.id, draft?.spatialEnabled, depthFrame, busy]);
  const modelsAllowed = !!status?.modelConfigured && !!status?.creditsConfirmed;
  const openAssets=(target:string|null=null,mode:'library'|'retouch'='library')=>{if(!view)return;void task(t('소재를 여는 중'),async()=>{await savePendingOptions();const next=await request<ProjectView>(connection,`/projects/${view.project.id}`);accept(next);const assetId=target==='primary'?next.primaryAssetId:target?next.stickers?.find(s=>s.id===target)?.assetId:null;if(mode==='retouch'&&!assetId){setMessage(t('보정할 피사체를 선택해 주세요.'));return;}setAssetPanel({target:assetId?target:null,assetId:assetId||null,mode});setCutoutNotice(null);});};
  const useStoredAsset=async(assetId:string)=>{if(!view||!assetPanel)return;const next=await request<ProjectView>(connection,assetPanel.target?'/assets/apply':'/assets/add',{projectId:view.project.id,assetId,stickerId:assetPanel.target,expectedAssetId:assetPanel.assetId});accept(next);setActiveStickerId(assetPanel.target||next.stickers?.at(-1)?.id||null);setAssetPanel(null);setHistory([]);setMessage(t('저장된 소재를 적용했어요. 추가 AI 호출은 없어요.'));};
  const generateSticker = async (description:string,retryFailed:boolean) => {
    if(!view||lock.current)return;
    lock.current=true;setBusy(t('AI 스티커를 만드는 중'));
    try {
      if(pendingJob){
        const previous=await request<{status:string;result?:{assetId?:string}}>(connection,`/jobs/${pendingJob}`);
        if(previous.status==='succeeded'&&previous.result?.assetId){setGeneratedSticker(await request<ReusableAsset>(connection,'/assets/get',{assetId:previous.result.assetId}));setPendingJob(null);return;}
        if(previous.status!=='uncertain'||!retryFailed)throw new Error(t('앞선 AI 작업의 상태를 먼저 확인해 주세요.'));
      }
      await savePendingOptions();
      const id=jobId();setPendingJob(id);
      await persist({...latestSnapshot.current,pendingJob:id},true);
      await request(connection,'/editor-state',{projectId:view.project.id,pendingJob:id});
      const asset=await request<ReusableAsset>(connection,'/stickers/generate',{projectId:view.project.id,jobId:id,prompt:description,retryFailed});
      setGeneratedSticker(asset);setPendingJob(null);setMessage(t('스티커를 보관했어요. 미리보기에서 캔버스에 추가하세요.'));
    } finally {lock.current=false;setBusy('');}
  };
  const addGeneratedSticker = async (assetId:string) => {
    if(!view||lock.current)return;
    lock.current=true;setBusy(t('스티커를 추가하는 중'));
    try{await previewFlight.current;await savePendingOptions();const next=await request<ProjectView>(connection,'/assets/add',{projectId:view.project.id,assetId});accept(next);setActiveStickerId(next.stickers?.at(-1)?.id||null);setHistory([]);setMessage(t('저장된 소재를 적용했어요. 추가 AI 호출은 없어요.'));}
    finally{lock.current=false;setBusy('');}
  };
  const modelTask = (endpoint: string, extra: object, label: string) => {
    if (!view) return;
    if (pendingJob) { setMessage(t("앞선 AI 작업의 상태를 먼저 확인해 주세요.")); return; }
    void task(label, async () => {
        let working = view;
        if (draft && !sameOptions(draft, view.options)) { working = await request<ProjectView>(connection, '/render', { projectId: view.project.id, options: draft }); setView(working); }
        const id = jobId(); setPendingJob(id);
        // Save the request ID before sending: a disconnect must not lose deduplication identity.
        await persist({ view: working, draft, history, activeStickerId, pendingJob: id }, true);
        await request(connection, '/editor-state', { projectId: working.project.id, pendingJob: id });
        const next = await request<ProjectView>(connection, endpoint, { projectId: view.project.id, jobId: id, ...extra });
        accept(next); if ('assetId' in extra) setActiveStickerId(next.stickers?.at(-1)?.id || null); setPendingJob(null); setMessage(endpoint === '/decoration' ? t("장식이 생성됐어요. 배경 분리를 눌러 편집 가능한 장식으로 만드세요.") : t("분리를 완료했어요. 결과를 확인하고 조절해 주세요."));
        if(endpoint==='/segment'){setActiveStickerId('assetId' in extra?next.stickers?.at(-1)?.id||null:'primary');if('assetId' in extra?next.stickers?.length:next.primaryAssetId)setCutoutNotice({state:'success',text:t('누끼를 저장했어요. 그대로 쓰거나 잘린 부분을 복구하세요.')});}
    });
  };
  const render = (options: EditOptions, undo = false) => {
    if (!view) return;
    options = keepSceneVisible(rebaseOptions(options, view), view);
    if (draft?.spatialEnabled && options.spatialEnabled && !sameOptions({ ...draft, spatialEnabled: false, spatialStrength: 0 }, { ...options, spatialEnabled: false, spatialStrength: 0 })) { options = { ...options, spatialEnabled: false }; setDepthFrame(null); }
    if (sameOptions(options, draft || view.options)) { if (undo) setHistory(current => current.slice(0, -1)); return; }
    setHistory(current => undo ? current.slice(0, -1) : [...current.slice(-19), draft || view.options]);
    setDraft(options); setExportMessage('');
  };
  const savePendingOptions = async () => {
    const snapshot = latestSnapshot.current;
    if (snapshot.view && snapshot.draft && !sameOptions(snapshot.draft, snapshot.view.options)) await request(connection, '/options', { projectId: snapshot.view.project.id, options: snapshot.draft });
  };
  const correctMask = async (strokes: BrushStroke[], reset = false) => {
    if (!view || (!view.project.selectedId && !maskStickerId) || lock.current) throw new Error(t("보정할 피사체를 선택해 주세요."));
    lock.current = true; setBusy(t("누끼 보정을 적용하는 중"));
    try {
      await previewFlight.current;
      await savePendingOptions();
      const next = await request<ProjectView>(connection, reset ? '/mask/reset' : '/mask', { projectId: view.project.id, candidateId: view.project.selectedId, stickerId: maskStickerId, baseRevision: (maskTarget || view).project.maskRevision || 0, strokes });
      accept(next);
      if (draft) setDraft({ ...draft, hidePrimary: next.options.hidePrimary });
      if (!reset) setMaskOpen(false); else if (maskStickerId) setMaskTarget(await request<ProjectView>(connection, '/stickers/edit', { projectId: view.project.id, stickerId: maskStickerId })); else setMaskTarget(next);
      setMessage(reset ? t("누끼 보정을 초기화했어요.") : t("누끼 보정을 적용했어요. 추가 AI 호출은 없어요."));
    } finally { lock.current = false; setBusy(''); }
  };
  const cutSticker = async (strokes: BrushStroke[]) => {
    if (!view || lock.current) throw new Error(t("사진을 먼저 열어 주세요."));
    lock.current = true; setBusy(t("테두리를 따라 자르는 중"));
    try {
      await previewFlight.current;
      await savePendingOptions();
      const next = await request<ProjectView>(connection, '/cutout', { projectId: view.project.id, assetId: editingAssetId, points: strokes[0]?.points || [] });
      accept(next);
      if (editingAssetId) setActiveStickerId(next.stickers?.at(-1)?.id || null); else setActiveStickerId('primary');
      setHistory([]); setMaskOpen(false);
      setCutoutNotice({state:'success',text:t('누끼를 저장했어요. 그대로 쓰거나 잘린 부분을 복구하세요.')});
      setMessage(editingAssetId ? t("새 스티커를 추가했어요. 선택해서 이동·확대하세요.") : t("자른 피사체를 적용했어요. 기존 스티커와 테마는 유지돼요."));
    } finally { lock.current = false; setBusy(''); }
  };
  const change = <K extends keyof EditOptions>(name: K, value: EditOptions[K]) => { if (draft) render({ ...draft, [name]: value }); };
  const selectTheme = (mode: EditOptions['mode']) => {
    if (!draft || draft.mode === mode) return;
    const next = { ...draft, mode, ...(mode === 'frame' ? PHOTO_FRAME_PRESET : { zoom: 1, x: 0, y: 0 }) };
    setDraft(next); render(next);
  };
  const dirty = !!view && !!draft && JSON.stringify(view.options) !== JSON.stringify(draft);
  const disabled = !!busy || !ready;
  useEffect(() => {
    if (!ready || busy || interacting || maskOpen || !view || !draft || sameOptions(draft, view.options)) return;
    const projectId = view.project.id, requested = draft;
    const timer = setTimeout(() => {
      if (lock.current || previewFlight.current) return;
      previewFlight.current = (async () => {
        try {
          const reconcile = (options: EditOptions) => {
            const latest = latestSnapshot.current;
            if (alive.current && latest.view?.project.id === projectId && latest.draft && sameOptions(latest.draft, requested) && !sameOptions(options, requested)) setDraft(options);
          };
          const result = await request<{ options: EditOptions }>(connection, '/options', { projectId, options: requested });
          reconcile(result.options);
          if (alive.current) setView(current => current?.project.id === projectId ? { ...current, imageOptions: current.imageOptions || current.options, options: result.options } : current);
        } catch { if (alive.current) setMessage(t("편집은 기기에 보관해요. 서버 연결 후 저장·공유할 때 다시 반영합니다.")); }
        finally { previewFlight.current = null; }
      })();
    }, 650);
    return () => clearTimeout(timer);
  }, [ready, busy, interacting, maskOpen, view, draft, connection]);

  const useFixture = () => { void task(t("연습용 그림을 여는 중"), async () => { accept(await request<ProjectView>(connection, '/fixture', {})); setHistory([]); setMessage(t("직접 그린 테스트 그림이에요. 실제 SAM 결과가 아닙니다.")); }); };
  const check = () => { void task(t("연결을 확인하는 중"), async () => { const next = await request<{ modelConfigured: boolean; creditsConfirmed: boolean; usage: Usage }>(connection, '/status'); setStatus(next); setMessage(!next.modelConfigured ? t("서버 연결 완료. Meta 키는 아직 설정되지 않았어요.") : !next.creditsConfirmed ? t("키 설정은 있어요. PC에서 Billing의 대회 크레딧 지급 확인을 완료해 주세요.") : t("키 설정과 크레딧 수동 확인 기록이 있어요. 실제 잔액과 모델 호출 성공은 별도 확인이 필요해요.")); }); };
  const save = (share = false) => { if (!view) return; void task(share ? t("공유 파일을 준비하는 중") : t("사진을 저장하는 중"), async () => {
    setExportMessage(share ? t("공유 파일을 준비하고 있어요.") : t("휴대폰 사진 보관함에 저장하고 있어요."));
    try {
    const output = draft && (view.sceneVersion !== COMPOSITION_VERSION || !sameOptions(draft, view.imageOptions || view.options)) ? await request<ProjectView>(connection, '/render', { projectId: view.project.id, options: draft }) : view;
    if (output !== view) accept(output);
    const uri = await exportPhoto(output);
    if (share) { if (!(await Sharing.isAvailableAsync())) throw new Error(t("이 기기에서 공유창을 사용할 수 없어요.")); await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: t("입체 사진 공유") }); const text = t("공유창을 닫았어요. 실제 게시 여부는 대상 앱에서 확인해 주세요."); setMessage(text); setExportMessage(text); }
    else {
      await saveToPhotos(uri, MediaLibrary);
      const text = t("사진 보관함에 저장했어요. {0}", photoDestination(Platform.OS));
      setMessage(text); setExportMessage(text);
      Alert.alert(t("사진 저장 완료"), t("{0}\n\n파일: {1}", photoDestination(Platform.OS), uri.split('/').at(-1)));
    }
    } catch (error) {
      const reason = error instanceof Error ? error.message : t("사진을 저장하지 못했어요.");
      setExportMessage(t("실패: {0}", reason));
      Alert.alert(share ? t("공유 실패") : t("사진 저장 실패"), t(reason));
      throw error;
    }
  }); };
  const screen = editorLayout(rootHeight, !!activeTool && !maskOpen, keyboardOpen);
  const output = view ? photoLayout(view.project, draft || view.options) : null;
  const ratio = view ? (picking ? (selectionView || view).project.width / (selectionView || view).project.height : output!.width / output!.height) : 4 / 5;
  const canvasSize = fitCanvas(stage.width, stage.height, ratio, screen.showRail);
  const selectTool = (id: ToolId) => {
    Keyboard.dismiss();
    if(id==='library'){setPicking(false);setActiveTool(null);openAssets();return;}
    if (id !== 'subject') setPicking(false);
    setActiveTool(current => current === id ? null : id);
  };
  const closeTools = () => { setActiveTool(null); Keyboard.dismiss(); };
  const openImported = (next = view) => {
    if (!next?.pendingPhoto) return;
    const photo = next.pendingPhoto;
    setMaskTarget({ ...next, source: photo.source, subject: null, project: { ...next.project, width: photo.width, height: photo.height, candidates: [], selectedId: null } });
    setImportPicking(true); setCutoutNotice(null); setDeviceCutoutError(''); setEditingAssetId(photo.id); setMaskStickerId(null); setOutlineOpen(true); setPicking(false); setActiveTool(null); setMaskOpen(true);
  };
  const openTargetSelection = () => {
    if (picking) { setPicking(false); setSelectionView(null); setSelectionStickerId(null); return; }
    if (!view || !draft) return;
    const target = cutoutTarget(view, draft, activeStickerId);
    setPoint(null); setSelectionView(null); setSelectionStickerId(null);
    if (!target) { const text = t("분리할 사진이 없어요. 사진을 추가하거나 메인 사진을 변경해 주세요."); setMessage(text); setCutoutNotice({ state: 'error', text }); return; }
    if (target.kind === 'import') { openImported(); return; }
    if (target.kind === 'primary') { setPicking(true); return; }
    void task(t("선택한 스티커의 원본을 여는 중"), async () => {
      await savePendingOptions();
      const next = await request<ProjectView>(connection, '/stickers/edit', { projectId: view.project.id, stickerId: target.id });
      setSelectionView({ ...next, project: { ...next.project, candidates: [], selectedId: null } });
      setSelectionStickerId(target.id); setActiveStickerId(target.id); setPicking(true);
      setMessage(t("선택한 스티커의 원본이에요. 남길 피사체를 꾹 누르면 이 스티커만 다시 분리해요."));
    });
  };
  const openMask = (outline = false) => {
    if (!view) return;
    setImportPicking(false);
    Keyboard.dismiss();
    if (!outline && activeStickerId && activeStickerId !== 'primary') { void task(t("스티커를 여는 중"), async () => { setMaskTarget(await request<ProjectView>(connection, '/stickers/edit', { projectId: view.project.id, stickerId: activeStickerId })); setMaskStickerId(activeStickerId); setEditingAssetId(null); setPicking(false); setActiveTool(null); setOutlineOpen(false); setMaskOpen(true); }); return; }
    setMaskTarget(view); setEditingAssetId(null); setMaskStickerId(null); setPicking(false); setActiveTool(null); setOutlineOpen(outline); setMaskOpen(true);
  };
  const undo = () => {
    if (history.length) render(history[history.length - 1], true);
    else if (dirty && view) setDraft(view.options);
  };
  const checkJob = () => { if (!pendingJob) return; void task(t("작업 상태를 확인하는 중"), async () => {
    const job = await request<{ status: string; message?: string; result?: { projectId: string; assetId?:string } }>(connection, `/jobs/${pendingJob}`);
    if (job.status === 'succeeded' && job.result) { if(job.result.assetId){setGeneratedSticker(await request<ReusableAsset>(connection,'/assets/get',{assetId:job.result.assetId}));setActiveTool('decoration');}else{await savePendingOptions(); accept(await request<ProjectView>(connection, `/projects/${job.result.projectId}`));} setPendingJob(null); setMessage(t("완료된 결과를 불러왔어요.")); }
    else setMessage(job.message || t("작업 상태: {0}. 자동 재호출하지 않아요.", job.status));
  }); };
  const allowNewJob = () => Alert.alert(t("새 요청 허용"), t("이전 호출은 이미 비용이 발생했을 수 있어요. 제공자 사용량과 작업 상태를 확인한 뒤 새 요청을 진행하세요."), [{ text: t("취소") }, { text: t("확인했어요"), onPress: () => { setPendingJob(null); setMessage(t("새 요청을 허용했어요. 이전 호출 예약은 유지돼요.")); } }]);
  const controlsDisabled = disabled || interacting || maskOpen;
  const activeTransform = draft?.stickerTransforms?.find(item => item.id === activeStickerId);
  const changeSticker = (name: 'x' | 'y' | 'scale', value: number) => { if (draft) render({ ...draft, stickerTransforms: draft.stickerTransforms.map(item => item.id === activeStickerId ? { ...item, [name]: value } : item) }); };
  const dropDelete = (id: string, options: EditOptions) => {
    if (!view) return;
    if (id === 'primary') { render({ ...options, hidePrimary: true }); setActiveStickerId(null); setMessage(t("메인 사진과 피사체를 삭제했어요. 폰 프레임과 다른 스티커는 유지돼요.")); return; }
    void task(t("스티커를 삭제하는 중"), async () => {
      const next = await request<ProjectView>(connection, '/stickers/remove', { projectId: view.project.id, stickerId: id, options });
      accept(next); setActiveStickerId(null); setHistory([]); setMessage(t("휴지통에 놓은 스티커를 삭제했어요."));
    });
  };
  const removeSticker = () => { if (!view || !activeStickerId) return; if (activeStickerId === 'primary' && draft) { dropDelete('primary', draft); return; } void task(t("스티커를 삭제하는 중"), async () => { await savePendingOptions(); accept(await request<ProjectView>(connection, '/stickers/remove', { projectId: view.project.id, stickerId: activeStickerId })); setActiveStickerId(null); setHistory([]); setMessage(t("선택한 스티커만 삭제했어요.")); }); };
  const bringStickerForward = () => { if (!draft || !activeStickerId) return; render({ ...draft, layerOrder: [...orderedLayers(draft).filter(id => id !== activeStickerId), activeStickerId] }); };
  const layerPicker = view?.stickers?.length ? <>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}><Button title={t("기본 사진")} secondary selected={activeStickerId === 'primary'} disabled={disabled} onPress={() => setActiveStickerId('primary')} />{view.stickers.map((sticker, index) => <Button key={sticker.id} title={t("스티커 {0}", index + 1)} secondary selected={activeStickerId === sticker.id} disabled={disabled} onPress={() => setActiveStickerId(sticker.id)} />)}</ScrollView>
    {activeStickerId && <View style={styles.row}><Button title={t("맨 앞으로")} secondary disabled={disabled} onPress={bringStickerForward} /><Button title={t("선택 스티커 삭제")} secondary disabled={disabled} onPress={removeSticker} /></View>}
  </> : null;
  const openJobTools = () => { if (maskOpen) return; setMoreTab('jobs'); setActiveTool('more'); };
  return <SafeAreaView style={styles.safe}><StatusBar style="light" /><KeyboardAvoidingView style={styles.editor} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}><View style={styles.editor} onLayout={event => setRootHeight(event.nativeEvent.layout.height)}>
    <View style={[styles.top, maskOpen && { display: 'none' }]}>
      <View><Text style={styles.brand}>reel talk<Text style={styles.brandDot}> ✳</Text></Text><Pressable accessibilityRole="button" accessibilityLabel={t("현재 테마 선택")} disabled={!view || controlsDisabled} onPress={() => { setThemeTab('theme'); setActiveTool('background'); }}><Text style={styles.eyebrow}>{view ? themeName(draft?.mode) + ' ▾' : 'AI PHOTO EDITOR'}</Text></Pressable></View>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("화면 밖 요소 되찾기")} disabled={controlsDisabled || !view || !draft} onPress={() => { if (view && draft) { render(recoverScene(draft, view)); setMessage(t("화면 밖 요소를 다시 가져왔어요.")); } }} style={styles.topIcon}><Text style={styles.topIconText}>⌖</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("실행 취소")} disabled={controlsDisabled || (!dirty && !history.length)} onPress={undo} style={[styles.topIcon, (controlsDisabled || (!dirty && !history.length)) && styles.disabled]}><Text style={styles.topIconText}>↶</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("사진 앨범에 저장")} disabled={controlsDisabled || !view} onPress={() => save()} style={[styles.topSave, (controlsDisabled || !view) && styles.disabled]}><Text style={styles.topSaveText}>저장</Text></Pressable>
      </View>
    </View>

    <View style={styles.stage} onLayout={event => setStage({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
      <View style={[styles.canvasArea, maskOpen && { paddingTop: 12, paddingBottom: 12, paddingHorizontal: 12 }]}>
        {maskOpen && view ? (importPicking && maskTarget ? <PhotoLiftPicker key={editingAssetId} view={maskTarget} disabled={disabled} onLift={point => autoCut(point, editingAssetId)} onManual={() => { setImportPicking(false); setCutoutNotice(null); }} onClose={() => { setMaskOpen(false); setCutoutNotice(null); }} /> : <MaskEditor key={outlineOpen ? 'outline' : 'erase'} embedded outline={outlineOpen} visible view={maskTarget || view} onClose={() => setMaskOpen(false)} onApply={outlineOpen ? cutSticker : strokes => correctMask(strokes)} onReset={() => correctMask([], true)} />) : view ? <View style={[styles.canvas, { width: canvasSize.width, height: canvasSize.height }]}>
          {picking ? <SourcePicker key={selectionStickerId || view.project.sourceFile || view.project.id} onAutoCutout={point => autoCut(point, null, selectionStickerId)} view={selectionView || view} point={point} onPoint={setPoint} disabled={disabled} /> : <GestureCanvas depthFrame={depthFrame} onAutoCutout={autoCut} calibration={spatialCalibration} compact touchEnabled={!draft?.spatialEnabled} activeStickerId={activeStickerId} onSelectSticker={setActiveStickerId} trashBounds={trashBounds} onTrashState={next => setTrashState(previous => previous.visible === next.visible && previous.over === next.over ? previous : next)} onDropDelete={dropDelete} onReorder={(id, direction) => { if (draft) render(moveLayer(draft, id, direction, orderedLayers(draft).filter(key => key !== 'primary' || (!draft.hidePrimary && (!!view.subject || draft.mode !== 'sticker'))))); }} compare={compare} view={view} options={draft || view.options} disabled={disabled} onInteracting={value => { setInteracting(value); if (value) setTrashBounds(null); }} onCommit={options => render(options)} />}
          {view.project.provenance === 'synthetic-fixture' && <View pointerEvents="none" style={styles.fixtureBadge}><Text numberOfLines={1} style={styles.fixtureText}>연습용 · AI 분리 아님</Text></View>}
        </View> : <View style={styles.empty}>
          {stage.height > 320 && <Text style={styles.emptyMark}>↗</Text>}
          {stage.height > 180 && <><Text style={styles.emptyTitle}>사진 한 장,{ '\n' }내 스타일로.</Text>{stage.height > 280 && <Text style={styles.emptyHint}>AI 피사체 분리 · 장식 · 테마 편집</Text>}<Button title={t("사진 선택")} disabled={disabled} onPress={choosePhoto} /><Pressable accessibilityRole="button" onPress={useFixture} disabled={disabled} style={styles.sampleLink}><Text style={styles.sampleText}>연습용 그림으로 시작</Text></Pressable></>}
        </View>}
      </View>
      {view && !maskOpen && !interacting && <View style={{ position: 'absolute', left: 12, right: 72, top: 72, zIndex: 70, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {draft?.mode === 'frame' && <Pressable accessibilityRole="button" accessibilityLabel={t("폰 팝아웃 메인 사진 변경")} disabled={disabled || !!pendingJob} onPress={replaceMainPhoto} style={{ backgroundColor: '#302D38DD', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, opacity: disabled || pendingJob ? .35 : 1 }}><Text style={{ color: '#fff', fontSize: 11 }}>메인 사진 변경</Text></Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel={t("배경 사진 설정")} disabled={disabled} onPress={() => { setActiveTool('background'); setThemeTab('background'); }} style={{ backgroundColor: '#302D38DD', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10 }}><Text style={{ color: '#fff', fontSize: 11 }}>배경 사진</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("현재 테마 선택")} disabled={disabled} onPress={() => { setActiveTool('background'); setThemeTab('theme'); }} style={{ backgroundColor: '#302D38DD', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10 }}><Text style={{ color: '#fff', fontSize: 11 }}>테마</Text></Pressable>
      </View>}
      {trashState.visible && !maskOpen && <DragTrash over={trashState.over} right={canvasSize.railWidth + 10} onBounds={setTrashBounds} />}
      {screen.showRail && !maskOpen && <View style={styles.railPosition}><ToolRail active={maskOpen ? 'subject' : activeTool} onSelect={selectTool} disabled={controlsDisabled} hasPhoto={!!view} buttonHeight={screen.railButtonHeight} pendingJob={!!pendingJob} /></View>}
    </View>

      {view && draft && !maskOpen && !interacting && !activeTool && !keyboardOpen && <View style={{ position: 'absolute', left: 12, bottom: 108, zIndex: 70, flexDirection: 'row', gap: 6 }}><Button title={draft.spatialEnabled ? t("편집으로 돌아가기") : t("기울여 보기")} secondary disabled={disabled} onPress={toggleSpatial} />{draft.spatialEnabled && <Button title={t("현재 각도를 기준으로")} secondary disabled={disabled} onPress={() => { setSpatialCalibration(n => n + 1); setMessage(t("현재 휴대폰 각도를 기준으로 맞췄어요. 여기서 살짝 기울여 보세요.")); }} />}</View>}
    <Pressable pointerEvents={activeTool || maskOpen ? "none" : "auto"} accessibilityRole="button" accessibilityLabel={t("작업 안내 자세히 보기")} disabled={maskOpen || interacting} onPress={openJobTools} style={[styles.status, (activeTool || maskOpen || interacting) && { opacity: 0 }]}>
      {busy ? <ActivityIndicator size="small" color="#BEAFF0" /> : <Text style={[styles.dot, pendingJob && { color: '#F4C47D' }]}>●</Text>}
      <Text accessibilityLiveRegion="polite" numberOfLines={2} style={styles.statusText}>{exportMessage || message}</Text>
    </Pressable>

    {!!activeTool && !maskOpen && <ToolSheet key={activeTool} title={activeTool === 'background' ? t("테마·배경") : EDITOR_TOOLS.find(tool => tool.id === activeTool)?.label || ''} compactHeight={screen.panelHeight} expandedHeight={Math.max(screen.panelHeight, Math.min(560, rootHeight * 0.65))} bottom={keyboardOpen ? 0 : 56} hidden={interacting} onClose={closeTools}>
      {activeTool === 'background' && <Tabs items={[{ id: 'theme', label: t("테마") }, { id: 'background', label: t("배경") }]} value={themeTab} onChange={setThemeTab} />}
      {activeTool === 'position' && <Tabs items={[{ id: 'move', label: t("위치·크기") }, { id: 'shadow', label: t("그림자") }, { id: 'ratio', label: t("비율") }]} value={positionTab} onChange={setPositionTab} />}
      {activeTool === 'more' && <Tabs items={[{ id: 'settings', label: t("연결 설정") }, { id: 'jobs', label: pendingJob ? t("AI 작업 !") : t("작업 안내") }]} value={moreTab} onChange={setMoreTab} />}
        {activeTool === 'photo' && <>
          <View style={styles.row}><View style={styles.grow}><Button title={view ? t("사진 추가") : t("사진 선택")} onPress={choosePhoto} disabled={disabled} /></View>{!view && <View style={styles.grow}><Button title={t("연습용 그림")} onPress={useFixture} secondary disabled={disabled} /></View>}</View>
          <Text style={styles.help}>사진을 추가하면 기존 캔버스에 새 스티커로 쌓여요. 마지막 편집만 자동 보관해요.</Text>
          {view && <><Button title={t("메인 사진 변경")} secondary disabled={disabled || !!pendingJob} onPress={replaceMainPhoto} /><Button title={t("배경 사진 선택")} secondary disabled={disabled} onPress={chooseBackgroundPhoto} /></>}
          {view?.pendingPhoto && <><Button title={t("가져온 사진 자르기 계속")} secondary disabled={disabled} onPress={() => openImported()} /><Button title={t("추가 사진 AI로 스티커 만들기")} disabled={disabled || !modelsAllowed || !!pendingJob} onPress={() => modelTask('/segment', { assetId: view.pendingPhoto!.id, prompt, point: null }, t("추가 사진에서 피사체를 분리하는 중"))} /></>}
        </>}
        {activeTool === 'repair' && view && <>
          <Text style={styles.help}>AI에게 원하는 보정을 설명하고 결과를 비교해 선택하는 공간이에요.</Text>
          {layerPicker}
          <Button title={t('음성·텍스트로 보정하기')} disabled={disabled||!modelsAllowed} onPress={()=>openAssets(activeStickerId||'primary','retouch')}/>
          <Text style={styles.help}>{t('색감·밝기·분위기를 설명해 주세요. 결과를 비교한 뒤 적용할 수 있어요.')}</Text>
        </>}
        {activeTool === 'subject' && view && <>
          {layerPicker}
          <Text accessibilityLiveRegion="polite" style={styles.help}>{deviceCutoutError || (deviceCutoutAvailable() ? t("처음 자를 때는 편집 화면에서 피사체를 0.6초 꾹 눌러요. 다시 자르려면 대상 선택에서 원본을 꾹 눌러요.") : t("꾹 눌러 자동 분리는 설치형 개발 빌드에서 사용해요."))}</Text>
          <Button title={t("테두리로 자르기")} disabled={disabled} onPress={() => openMask(true)} />
          <View style={styles.row}><View style={styles.grow}><Button title={picking ? t("합성 보기") : t("대상 선택")} secondary disabled={disabled} onPress={openTargetSelection} /></View><View style={styles.grow}><Button title={t("지우개 보정")} secondary disabled={disabled || (!view.subject && (!activeStickerId || activeStickerId === 'primary'))} onPress={() => openMask()} /></View></View>
          <View style={styles.row}><TextInput accessibilityLabel={t("분리할 대상 설명")} style={[styles.input, styles.grow]} value={prompt} onChangeText={setPrompt} placeholder={t("예: person, sunglasses")} editable={!disabled} /><Button title={t("AI로 분리")} disabled={disabled || !modelsAllowed || !!pendingJob || (picking && !!selectionStickerId)} onPress={() => modelTask('/segment', { point, prompt }, t("SAM이 피사체를 분리하는 중"))} /></View>
          <Text style={styles.help}>{picking ? (point ? t("누른 점을 기준으로 분리해요.") : t("사진에서 분리할 대상을 눌러주세요.")) : t("분리한 피사체를 다듬거나 다시 선택할 수 있어요.")} AI 분리 시 사진을 Meta에 전송합니다.</Text>
          {view.project.candidates.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>{view.project.candidates.map(candidate => <Button key={candidate.id} title={candidate.label} secondary selected={view.project.selectedId === candidate.id} disabled={disabled} onPress={() => { void task(t("대상을 선택하는 중"), async () => { await savePendingOptions(); accept(await request<ProjectView>(connection, '/select', { projectId: view.project.id, candidateId: candidate.id })); setMessage(t("선택한 피사체를 적용했어요.")); }); }} />)}</ScrollView>}
          {!modelsAllowed && <Text style={styles.help}>AI 연결 준비 중 · 기본 편집과 연습용 그림은 사용할 수 있어요.</Text>}
        </>}
        {activeTool === 'position' && draft && <>
          {layerPicker}
          {positionTab === 'move' && activeTransform && <><Stepper title={t("선택 스티커 크기")} value={activeTransform.scale} step={0.05} min={0.08} max={2.5} disabled={disabled} onChange={value => changeSticker('scale', value)} /><Stepper title={t("선택 스티커 좌우")} value={activeTransform.x} step={0.03} min={-0.3} max={1.3} disabled={disabled} onChange={value => changeSticker('x', value)} /><Stepper title={t("선택 스티커 상하")} value={activeTransform.y} step={0.03} min={-0.3} max={1.3} disabled={disabled} onChange={value => changeSticker('y', value)} /></>}
          {positionTab === 'move' && activeStickerId === 'primary' && <><Stepper title={t("사진 확대")} value={draft.zoom} step={0.05} min={0.8} max={2.4} disabled={disabled} onChange={value => change('zoom', value)} /><Stepper title={t("좌우 위치")} value={draft.x} step={0.05} min={-0.8} max={0.8} disabled={disabled} onChange={value => change('x', value)} /><Stepper title={t("상하 위치")} value={draft.y} step={0.05} min={-0.8} max={0.8} disabled={disabled} onChange={value => change('y', value)} /><Text style={styles.help}>사진 위에서 드래그·핀치로 바로 조절할 수도 있어요.</Text></>}
          {positionTab === 'shadow' && <><Stepper title={t("그림자 진하기")} value={draft.shadow} step={0.1} min={0} max={0.8} disabled={disabled} onChange={value => change('shadow', value)} />{draft.mode === 'frame' && <><Stepper title={t("폰 기울기")} unit="degrees" value={draft.tilt || 0} step={2} min={-18} max={18} disabled={disabled} onChange={value => change('tilt', value)} /><Stepper title={t("폰 크기")} value={draft.frameScale ?? 1} step={0.05} min={0.7} max={1.5} disabled={disabled} onChange={value => change('frameScale', value)} /><Stepper title={t("폰 좌우")} value={draft.frameX ?? 0} step={0.03} min={-0.35} max={0.35} disabled={disabled} onChange={value => change('frameX', value)} /><Stepper title={t("폰 상하")} value={draft.frameY ?? 0} step={0.03} min={-0.25} max={0.25} disabled={disabled} onChange={value => change('frameY', value)} /><Stepper title={t("프레임 깊이")} value={draft.depth ?? 0.75} step={0.1} min={0} max={1} disabled={disabled} onChange={value => change('depth', value)} /></>}<Stepper title={t("기울기 효과 강도")} value={draft.spatialStrength ?? 0.7} step={0.1} min={0} max={1} disabled={disabled} onChange={value => change('spatialStrength', value)} /><Text style={styles.help}>휴대폰을 기울이면 배경·사진·스티커가 서로 다른 폭으로 움직여요. 현재 각도를 기준으로를 누르면 지금 자세에서 가운데로 돌아와요. PNG 저장은 정지 화면이에요.</Text></>}
          {positionTab === 'ratio' && <><View style={styles.row}>{(['portrait', 'story', 'square'] as const).map((ratio, i) => <View style={styles.grow} key={ratio}><Button title={['4:5', '9:16', '1:1'][i]} secondary selected={draft.ratio === ratio} disabled={disabled} onPress={() => change('ratio', ratio)} /></View>)}</View><Text style={styles.help}>비율을 바꾼 뒤 사진 위치와 잘리는 부분을 확인하세요.</Text></>}
        </>}
        {activeTool === 'background' && draft && themeTab === 'theme' && <>
          <View style={styles.row}>{(['plain', 'frame', 'sticker'] as const).map(mode => <View style={styles.grow} key={mode}><Button title={themeName(mode)} secondary selected={(draft.mode || 'frame') === mode} disabled={disabled || (mode === 'sticker' && !view?.subject)} onPress={() => selectTheme(mode)} /></View>)}</View>
          {draft.mode === 'frame' && <><Button title={t("메인 사진 변경")} secondary disabled={disabled || !!pendingJob} onPress={replaceMainPhoto} /><Button title={t("추천 구도")} secondary disabled={disabled} onPress={() => render({ ...draft, ...PHOTO_FRAME_PRESET })} /></>}
          <Text style={styles.help}>{draft.mode === 'frame' ? t("피사체가 폰 프레임 밖으로 튀어나오는 테마예요. 위치·크기와 그림자로 입체감을 조절하세요.") : draft.mode === 'sticker' ? t("분리한 피사체만 투명 PNG로 내보내요. 체크무늬는 저장되지 않아요.") : t("기본 캔버스에서 사진 또는 분리한 피사체를 편집해요. AI 장식도 함께 배치할 수 있어요.")}</Text>
          {!view?.subject && <Text style={styles.help}>피사체에서 AI로 분리하거나 테두리로 자르면 팝아웃·스티커에 사용할 수 있어요.</Text>}
        </>}
        {activeTool === 'background' && draft && themeTab === 'background' && <>
          <Button title={view?.backgroundPhoto ? t("배경 사진 변경") : t("내 사진에서 배경 선택")} disabled={disabled} onPress={chooseBackgroundPhoto} />
          {view?.backgroundPhoto && <><Button title={t("배경 사진 지우기")} secondary disabled={disabled} onPress={removeBackgroundPhoto} /><Stepper title={t("배경 확대")} value={draft.backgroundZoom ?? 1} step={0.1} min={1} max={3} disabled={disabled} onChange={value => change('backgroundZoom', value)} /><Stepper title={t("배경 좌우")} value={draft.backgroundX ?? 0.5} step={0.1} min={0} max={1} disabled={disabled} onChange={value => change('backgroundX', value)} /><Stepper title={t("배경 상하")} value={draft.backgroundY ?? 0.5} step={0.1} min={0} max={1} disabled={disabled} onChange={value => change('backgroundY', value)} /><Stepper title={t("배경 어둡기")} value={draft.backgroundDim ?? 0.04} step={0.05} min={0} max={0.5} disabled={disabled} onChange={value => change('backgroundDim', value)} /></>}
          <Text style={styles.help}>{draft.mode === 'sticker' ? t("투명 스티커 테마에서는 배경을 숨겨요. 다른 테마로 바꾸면 다시 보여요.") : t("배경 사진은 메인 사진·스티커와 따로 저장돼요. 사진을 지우면 아래 색을 사용해요.")}</Text><Text style={styles.help}>배경색</Text><View style={styles.wrap}>{['#EEE8DF', '#DDE9E4', '#DFDDF1', '#F0DCD4', '#253043', '#FFFFFF', '#17151D'].map(color => <Pressable key={color} accessibilityRole="button" accessibilityLabel={t("배경 {0}", color)} accessibilityState={{ selected: draft.background === color }} onPress={() => change('background', color)} disabled={disabled} style={[styles.swatch, { backgroundColor: color, borderColor: draft.background === color ? '#9C84F0' : '#D8D2DE' }]} />)}</View>
        </>}
        {activeTool === 'decoration' && view && <StickerCreator connection={connection} result={generatedSticker} onSelect={setGeneratedSticker} onGenerate={generateSticker} onAdd={addGeneratedSticker} onCheck={checkJob} disabled={disabled} generationAllowed={modelsAllowed} pending={!!pendingJob} full={(view.stickers?.length||0)>=16} />}
        {activeTool === 'more' && <>
          {moreTab === 'settings' && <>
            <Text style={styles.panelTitle}>{t('언어 / Language')}</Text>
            <View style={styles.row}>{(['ko','en'] as const).map(code=><Button key={code} title={code==='ko'?'한국어':'English'} selected={language===code} secondary disabled={disabled} onPress={()=>{void chooseLanguage(code).catch(()=>setMessage(t('언어 설정을 저장하지 못했어요. 다시 선택해 주세요.')));}} />)}</View>
            <Text style={styles.help}>개발 서버 연결 · 휴대폰과 같은 네트워크를 사용하세요.</Text><TextInput accessibilityLabel={t("개발 서버 주소")} style={styles.input} value={connection.url} onChangeText={url => setConnection(current => ({ ...current, url }))} autoCapitalize="none" autoCorrect={false} editable={!disabled} /><TextInput accessibilityLabel={t("개발 서버 연결 코드")} placeholder={t("연결 코드 · 모델 API 키 아님")} secureTextEntry style={styles.input} value={connection.token} onChangeText={token => setConnection(current => ({ ...current, token }))} autoCapitalize="none" editable={!disabled} /><Button title={t("연결 확인")} onPress={check} disabled={disabled} secondary />{status && <Text style={styles.help}>예약 / 설정 한도 · SAM {status.usage.sam.reserved}/{status.usage.sam.cap??t('제한 없음')} · 이미지 {status.usage.image.reserved}/{status.usage.image.cap??t('제한 없음')}</Text>}</>}
          {moreTab === 'jobs' && <><Text selectable style={styles.help}>{message}</Text>{exportMessage ? <Text selectable style={styles.help}>{exportMessage}</Text> : null}<Text style={styles.help}>{saveState || t("작업을 시작하면 자동으로 보관합니다.")}</Text>{pendingJob && <><Button title={t("마지막 AI 작업 확인")} disabled={disabled} secondary onPress={checkJob} /><Button title={t("확인 후 새 요청 허용")} disabled={disabled} secondary onPress={allowNewJob} /></>}{view && <Text style={styles.help}>{view.width} × {view.height} PNG</Text>}</>}
        </>}
    </ToolSheet>}

    {!keyboardOpen && !maskOpen && <View style={styles.bottomBar}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("누르고 원본 보기")} onPressIn={() => setCompare(true)} onPressOut={() => setCompare(false)} disabled={controlsDisabled || !view} style={[styles.bottomButton, (controlsDisabled || !view) && styles.disabled]}><Text style={styles.bottomText}>◫ 원본</Text></Pressable>
      <View style={styles.bottomCenter}>{picking ? <Button title={t("선택 화면 닫기")} secondary disabled={controlsDisabled} onPress={() => setPicking(false)} /> : <Pressable accessibilityRole="button" disabled={controlsDisabled || !view} onPress={() => { setPositionTab('ratio'); setActiveTool('position'); }} style={styles.ratioChip}><Text style={styles.ratioText}>{draft ? ({ portrait: '4:5', story: '9:16', square: '1:1' }[draft.ratio]) : t("사진 편집")}</Text></Pressable>}</View>
      <Pressable accessibilityRole="button" accessibilityLabel={t("완성 사진 공유")} disabled={controlsDisabled || !view} onPress={() => save(true)} style={[styles.bottomButton, (controlsDisabled || !view) && styles.disabled]}><Text style={styles.bottomText}>공유 ↗</Text></Pressable>
    </View>}
    {cutoutNotice && <View accessibilityLiveRegion="assertive" style={{ position: 'absolute', top: 82, left: 16, right: 16, zIndex: 500, elevation: 16, borderRadius: 16, padding: 14, backgroundColor: cutoutNotice.state === 'error' ? '#552B36' : '#253D35', borderWidth: 1, borderColor: cutoutNotice.state === 'error' ? '#ED8D9B' : '#92DAB6', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {cutoutNotice.state === 'working' ? <ActivityIndicator color="#ADFFD3" /> : <Text style={{ color: '#fff', fontSize: 20 }}>{cutoutNotice.state === 'success' ? '✓' : '!'}</Text>}
      <View style={{flex:1,gap:8}}><Text style={{ color: '#fff', fontSize: 13, lineHeight: 19 }}>{cutoutNotice.text}</Text>{cutoutNotice.state==='success'&&<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><Button title={t('그대로 사용')} secondary onPress={()=>setCutoutNotice(null)}/><Button title={t('잘린 부분 복구')} onPress={()=>openAssets(activeStickerId||(!draft?.hidePrimary&&view?.subject?'primary':view?.stickers?.at(-1)?.id)||null)}/></View>}</View>
      {cutoutNotice.state !== 'working' && <Pressable accessibilityRole="button" accessibilityLabel={t("분리 안내 닫기")} hitSlop={12} onPress={() => setCutoutNotice(null)}><Text style={{ color: '#fff', fontSize: 20 }}>×</Text></Pressable>}
    </View>}
    {assetPanel&&<AssetRepairPanel connection={connection} initialId={assetPanel.assetId} mode={assetPanel.mode} onClose={()=>setAssetPanel(null)} onUse={useStoredAsset}/>}
  </View></KeyboardAvoidingView></SafeAreaView>;
}
export default function App() {
  const [languageReady,setLanguageReady]=useState(false);
  useEffect(()=>{let alive=true;void initializeLanguage().finally(()=>{if(alive)setLanguageReady(true);});return()=>{alive=false;};},[]);
  return <SafeAreaProvider>{languageReady ? <Editor /> : <SafeAreaView style={{flex:1,backgroundColor:'#19171F',justifyContent:'center'}}><ActivityIndicator color="#ADFFD3" /></SafeAreaView>}</SafeAreaProvider>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#19171F' }, editor: { flex: 1 },
  top: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 100, height: 56, paddingHorizontal: 12, backgroundColor: '#19171FD9', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, brand: { fontSize: 22, fontWeight: '700', color: '#FFF', letterSpacing: -1 }, brandDot: { color: '#B5A0EF' }, eyebrow: { color: '#ABA1B8', fontSize: 9, marginTop: 2, letterSpacing: 1.2 }, topIcon: { width: 40, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#302D38' }, topIconText: { fontSize: 24, color: '#fff' }, topSave: { backgroundColor: '#E8DFFA', borderRadius: 20, height: 38, paddingHorizontal: 20, justifyContent: 'center' }, topSaveText: { color: '#403150', fontSize: 12, fontWeight: '700' },
  stage: { flex: 1, minHeight: 0 }, canvasArea: { flex: 1, alignItems: 'center', justifyContent: 'center' }, canvas: { borderRadius: 0, overflow: 'hidden', backgroundColor: '#EEE8DF' }, railPosition: { position: 'absolute', right: 10, top: 72, zIndex: 80 }, fixtureBadge: { position: 'absolute', bottom: 8, left: 8, right: 8, alignItems: 'center' }, fixtureText: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: '#ffffffcc', color: '#6B6077', fontSize: 8 },
  empty: { alignItems: 'center', gap: 15, maxWidth: 280 }, emptyMark: { color: '#AC96DD', fontSize: 60, lineHeight: 64 }, emptyTitle: { color: '#F5F0FA', fontSize: 25, lineHeight: 34, fontWeight: '700', textAlign: 'center', letterSpacing: -0.8 }, emptyHint: { fontSize: 11, lineHeight: 17, color: '#AFA4BB', textAlign: 'center' }, sampleLink: { padding: 6 }, sampleText: { color: '#C3B3DF', fontSize: 11 },
  status: { position: 'absolute', bottom: 64, left: 12, right: 76, zIndex: 20, borderRadius: 12, backgroundColor: '#19171FD9', height: 30, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 17 }, dot: { color: '#A58BD8', fontSize: 7 }, statusText: { flex: 1, color: '#B8ADC6', fontSize: 10, lineHeight: 14 },
  sheet: { position: 'absolute', left: 0, right: 0, zIndex: 90, backgroundColor: '#FAF8F5', borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: 'hidden' }, sheetHeader: { height: 36, flexShrink: 0, paddingLeft: 18, paddingRight: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sheetTitle: { color: '#352C40', fontSize: 14, fontWeight: '700' }, closeButton: { width: 44, height: 36, alignItems: 'center', justifyContent: 'center' }, collapseChevron: { width: 9, height: 9, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: '#776B82', transform: [{ rotate: '45deg' }], marginTop: -5 }, sheetScroll: { flex: 1 }, sheetContent: { paddingHorizontal: 17, paddingTop: 8, paddingBottom: 16, gap: 10 }, tabs: { flexDirection: 'row', gap: 5, paddingBottom: 5 }, tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 29, borderRadius: 9, backgroundColor: '#EFEBF2' }, tabSelected: { backgroundColor: '#DDD2EE' }, tabLabel: { color: '#887A95', fontSize: 11 }, tabSelectedLabel: { color: '#514064', fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, alignItems: 'center' }, wrap: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' }, grow: { flex: 1 }, button: { backgroundColor: '#7762C9', borderRadius: 12, paddingHorizontal: 13, maxWidth: '100%', minHeight: 38, alignItems: 'center', justifyContent: 'center' }, secondary: { backgroundColor: '#EFEBF4' }, selected: { backgroundColor: '#7762C9' }, disabled: { opacity: 0.35 }, buttonText: { color: '#fff', fontWeight: '700', fontSize: 11, textAlign: 'center', flexShrink: 1 }, secondaryText: { color: '#66547E' }, input: { backgroundColor: '#EFECF2', borderRadius: 11, padding: 11, color: '#352C40', fontSize: 12, minHeight: 40 }, help: { color: '#8A7F94', fontSize: 11, lineHeight: 17 }, panelTitle: { color: '#51435F', fontSize: 12, fontWeight: '600' }, stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, stepLabel: { flex: 1, marginRight: 6, lineHeight: 16, fontSize: 12, color: '#62556F' }, value: { width: 34, textAlign: 'center', color: '#62556F', fontVariant: ['tabular-nums'], fontSize: 12 }, swatch: { height: 36, width: 36, borderRadius: 18, borderWidth: 3 },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 100, backgroundColor: '#19171FD9', height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, gap: 8 }, bottomButton: { paddingHorizontal: 10, paddingVertical: 12, minWidth: 66, alignItems: 'center' }, bottomText: { color: '#EEE7F7', fontSize: 12, fontWeight: '600' }, bottomCenter: { flex: 1, alignItems: 'center' }, ratioChip: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 18, backgroundColor: '#302D38' }, ratioText: { color: '#C3B4D8', fontSize: 11, fontWeight: '600' },
});
