import * as FS from 'expo-file-system/legacy';
import {VoicePrompt} from './VoicePrompt';
import React,{useEffect,useState,useRef} from 'react';
import {ActivityIndicator,KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,TextInput,View,useWindowDimensions} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {LocalizedText as Text} from './i18n-react';
import {t} from './i18n';
import {CachedImage} from './CachedImage';
import {request,jobId} from './client';
import type {Connection,ReusableAsset} from './client';
export function AssetRepairPanel({connection,initialId,onClose,onUse,mode='library'}:{mode?:'library'|'retouch';connection:Connection;initialId:string|null;onClose:()=>void;onUse:(id:string)=>Promise<void>}){
 const {height}=useWindowDimensions();
 const [assets,setAssets]=useState<ReusableAsset[]>([]),[selected,setSelected]=useState<ReusableAsset|null>(null),[result,setResult]=useState<ReusableAsset|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(false);
 const [instruction,setInstruction]=useState(''),[listening,setListening]=useState(false),[pending,setPending]=useState<string|null>(null);
 const gate=useRef(false),pendingFile=FS.documentDirectory?FS.documentDirectory+'popout-asset-job-'+mode+'-'+(initialId||selected?.id||'library')+'.json':null;
 useEffect(()=>{let alive=true;if(pendingFile)void FS.readAsStringAsync(pendingFile).then(JSON.parse).then(p=>{if(alive&&p.url===connection.url&&p.assetId===(initialId||selected?.id)){setPending(p.jobId);setInstruction(p.instruction);}}).catch(()=>{});return()=>{alive=false;};},[pendingFile,connection.url]);
 const clearPending=async()=>{if(pendingFile)await FS.deleteAsync(pendingFile,{idempotent:true});setPending(null);};
 const checkPending=async()=>{if(!pending||gate.current)return;gate.current=true;setBusy(true);setError('');try{const job=await request<{status:string;message?:string;result?:{assetId?:string}}>(connection,'/jobs/'+pending);if(job.status==='succeeded'&&job.result?.assetId){setResult(await request<ReusableAsset>(connection,'/assets/get',{assetId:job.result.assetId}));await clearPending();setRetry(false);}else if(job.status==='uncertain'){setError(job.message||t('작업에 실패했어요.'));await clearPending();setRetry(true);}else setError(t('작업이 진행 중이에요. 잠시 후 다시 확인해 주세요.'));}catch(e){setError(e instanceof Error?e.message:t('작업에 실패했어요.'));}finally{gate.current=false;setBusy(false);}};
 useEffect(()=>{let alive=true;setBusy(true);void(async()=>{try{const list=await request<{assets:ReusableAsset[]}>(connection,'/assets');if(!alive)return;setAssets(list.assets);if(initialId){const asset=await request<ReusableAsset>(connection,'/assets/get',{assetId:initialId});if(alive)setSelected(asset);}}catch(e){if(alive)setError(e instanceof Error?e.message:t('작업에 실패했어요.'));}finally{if(alive)setBusy(false);}})();return()=>{alive=false;};},[]);
 const choose=async(asset:ReusableAsset)=>{if(pending||listening)return;setBusy(true);setError('');setResult(null);setRetry(false);try{setSelected(await request<ReusableAsset>(connection,'/assets/get',{assetId:asset.id}));}catch(e){setError(e instanceof Error?e.message:t('작업에 실패했어요.'));}finally{setBusy(false);}};
 const repair=async()=>{
  if(!selected||!instruction.trim()||pending||gate.current||listening)return;gate.current=true;setBusy(true);setError('');
  const id=jobId();try{
   if(pendingFile)await FS.writeAsStringAsync(pendingFile,JSON.stringify({url:connection.url,assetId:selected.id,instruction:instruction.trim(),jobId:id}));
   setPending(id);
   const repaired=await request<ReusableAsset>(connection,mode==='retouch'?'/retouch':'/repair',{assetId:selected.id,instruction:instruction.trim(),jobId:id,retryFailed:retry});setResult(repaired);await clearPending();setRetry(false);setAssets((await request<{assets:ReusableAsset[]}>(connection,'/assets')).assets);
  }catch(e){setError(e instanceof Error?e.message:t('작업에 실패했어요.'));}finally{gate.current=false;setBusy(false);}
 };
 const use=async(id:string)=>{setBusy(true);setError('');try{await onUse(id);}catch(e){setError(e instanceof Error?e.message:t('작업에 실패했어요.'));}finally{setBusy(false);}};
 const button=(label:string,action:()=>void,disabled=false)=><Pressable accessibilityRole="button" disabled={busy||listening||disabled} onPress={action} style={{padding:12,borderRadius:12,backgroundColor:'#7762C9',opacity:(busy||listening||disabled) ? .4:1}}><Text style={{color:'#fff',fontSize:12,textAlign:'center'}}>{label}</Text></Pressable>;
 const versions=selected?assets.filter(a=>a.originId===selected.originId):[];
 return <Modal visible animationType="slide" onRequestClose={()=>{if(!busy)onClose();}}><SafeAreaView style={{flex:1,backgroundColor:'#19171F'}}><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':'height'}><View style={{flexDirection:'row',padding:16,justifyContent:'space-between',alignItems:'center'}}><Text style={{color:'#fff',fontSize:18}}>{mode==='retouch'?t('보정'):t('보관함')}</Text>{button(t('닫기'),onClose)}</View><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:16,gap:14,paddingBottom:36}}>
  <Text style={{color:'#CFC4DD',fontSize:12}}>{t('저장한 소재는 추가 AI 호출 없이 다시 사용할 수 있어요.')}</Text>
  {pending&&button(t('마지막 AI 작업 확인'),()=>{void checkPending();})}
  {busy&&<ActivityIndicator color="#ADFFD3"/>}
  {!!error&&<Text accessibilityLiveRegion="polite" style={{color:'#FFB9C1'}}>{error}</Text>}
  {selected&&<>
   <View style={{flexDirection:'row',gap:10,height:Math.min(350,height*.38)}}>{[{label:t('원본 누끼'),asset:selected},{label:mode==='retouch'?t('보정 결과'):t('복구 결과'),asset:result}].filter(x=>x.asset).map(x=><View key={x.label} style={{flex:1,gap:6}}><Text style={{color:'#DDD1EB',fontSize:12}}>{x.label}</Text><View style={{flex:1,backgroundColor:'#D7DDE5',borderRadius:12,overflow:'hidden'}}><CachedImage data={x.asset!.data!} style={{width:'100%',height:'100%'}} resizeMode="contain"/></View></View>)}</View>
   <Text style={{color:'#CFC4DD',fontSize:12}}>{mode==='retouch'?t('색감·밝기·분위기를 설명해 주세요. 결과를 비교한 뒤 적용할 수 있어요.'):t('AI가 보이지 않는 부분을 추정하므로 모양과 반사가 달라질 수 있어요.')}</Text>
   <TextInput accessibilityLabel={mode==='retouch'?t('원하는 보정 설명'):t('복구할 부분과 함께 남길 물체')} placeholder={mode==='retouch'?t('예: 조금 더 밝고 따뜻한 색감으로 보정해줘'):t('예: 컵 밑부분을 완성하고 스푼도 남겨줘')} placeholderTextColor="#8B8097" value={instruction} onChangeText={value=>{setInstruction(value);setRetry(false);}} editable={!busy&&!listening&&!pending} maxLength={500} multiline style={{backgroundColor:'#302D38',color:'#fff',padding:12,borderRadius:12,minHeight:70}}/>
   <VoicePrompt value={instruction} onChange={setInstruction} disabled={busy||!!pending} onListening={setListening} context={mode==='retouch'?'retouch':'repair'}/>
   {button(retry?t('실패 단계 다시 시도'):mode==='retouch'?t('AI 보정 미리보기'):t('잘린 부분 복구'),()=>{void repair();},!instruction.trim()||!!pending)}
   <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{button(initialId?t('원본 유지'):t('이 소재 추가'),()=>{if(initialId)onClose();else void use(selected.id);})}{result&&button(mode==='retouch'?t('보정본 적용'):t('복구본 적용'),()=>{void use(result.id);})}{initialId&&selected.id!==initialId&&!result&&button(t('이 버전 적용'),()=>{void use(selected.id);})}</View>
   {versions.length>1&&<><Text style={{color:'#fff'}}>{t('저장된 버전')}</Text><ScrollView horizontal contentContainerStyle={{gap:8}}>{versions.map(a=><View key={a.id}>{button(a.kind==='retouch'?t('보정본'):a.kind==='repair'?t('복구본'):a.kind==='generated'?t('생성된 이미지'):t('원본 누끼'),()=>{void choose(a);})}</View>)}</ScrollView></>}
  </>}
  {mode==='library'&&<>
  <Text style={{color:'#fff',fontSize:15}}>{t('다시 사용할 소재')}</Text>
  {!assets.length&&!busy&&<Text style={{color:'#CFC4DD'}}>{t('누끼를 만들면 여기에 자동으로 보관돼요.')}</Text>}
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:10}}>{assets.map(a=><Pressable key={a.id} accessibilityRole="button" accessibilityLabel={t('저장된 소재 선택')} disabled={busy||!!pending||listening} onPress={()=>{void choose(a);}} style={{width:'30%',borderWidth:2,borderColor:selected?.id===a.id?'#ADFFD3':'#514362',borderRadius:10,padding:5}}><CachedImage data={a.thumbnail!} style={{width:'100%',height:95,backgroundColor:'#D7DDE5',borderRadius:7}} resizeMode="contain"/><Text numberOfLines={2} style={{color:'#fff',fontSize:11,marginTop:5}}>{a.label}</Text></Pressable>)}</View>
  </>}
 </ScrollView></KeyboardAvoidingView></SafeAreaView></Modal>;
}
