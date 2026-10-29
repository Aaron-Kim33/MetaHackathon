import React, {useEffect,useState} from 'react';
import {ActivityIndicator,Pressable,TextInput,View} from 'react-native';
import {LocalizedText as Text} from './i18n-react';
import {t} from './i18n';
import {CachedImage} from './CachedImage';
import {request} from './client';
import {VoicePrompt} from './VoicePrompt';
import type {Connection,ReusableAsset} from './client';

type Props={connection:Connection;result:ReusableAsset|null;onSelect:(asset:ReusableAsset)=>void;onGenerate:(prompt:string,retry:boolean)=>Promise<void>;onAdd:(id:string)=>Promise<void>;onCheck:()=>void;disabled:boolean;generationAllowed:boolean;pending:boolean;full:boolean};
export function StickerCreator({connection,result,onSelect,onGenerate,onAdd,onCheck,disabled,generationAllowed,pending,full}:Props){
 const [prompt,setPrompt]=useState(''),[assets,setAssets]=useState<ReusableAsset[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[failedPrompt,setFailedPrompt]=useState<string|null>(null);
 const [listening,setListening]=useState(false);
 useEffect(()=>{let alive=true;void request<{assets:ReusableAsset[]}>(connection,'/assets').then(list=>{if(alive)setAssets(list.assets.filter(a=>a.kind==='generated-sticker'));}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[connection.url,connection.token,result?.id]);
 const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:t('작업에 실패했어요.'));}finally{setBusy(false);}};
 const generate=()=>run(async()=>{const value=prompt.trim();try{await onGenerate(value,failedPrompt===value);setFailedPrompt(null);}catch(e){setFailedPrompt(value);throw e;}});
 const button=(label:string,action:()=>void,blocked=false)=><Pressable accessibilityRole="button" disabled={busy||disabled||blocked} onPress={action} style={{padding:12,borderRadius:12,backgroundColor:'#7762C9',opacity:(busy||disabled||blocked)?0.4:1}}><Text style={{color:'#fff',fontSize:12,textAlign:'center',fontWeight:'600'}}>{label}</Text></Pressable>;
 return <>
  <Text style={{color:'#352C40',fontSize:15,fontWeight:'700'}}>{t('상상한 스티커를 만들어보세요')}</Text>
  <Text style={{color:'#776B82',fontSize:12,lineHeight:18}}>{t('사진에 없는 소품도 설명만으로 만들 수 있어요.')}</Text>
  <TextInput accessibilityLabel={t('만들 스티커 설명')} placeholder={t('예: 반짝이는 보라색 나비')} placeholderTextColor="#95899F" value={prompt} onChangeText={setPrompt} editable={!busy&&!disabled&&!listening} maxLength={500} multiline style={{backgroundColor:'#EFEBF2',color:'#352C40',padding:12,borderRadius:12,minHeight:64}}/>
  <VoicePrompt value={prompt} onChange={setPrompt} disabled={busy||disabled} onListening={setListening}/>
  {button(failedPrompt===prompt.trim()?t('실패 단계 다시 시도'):t('AI로 새 스티커 만들기'),()=>{void generate();},listening||!prompt.trim()||!generationAllowed||(pending&&failedPrompt!==prompt.trim()))}
  <Text style={{color:'#776B82',fontSize:11,lineHeight:17}}>{t('이미지 생성 후 배경을 자동으로 분리해요. 완성한 스티커는 보관되며 재사용할 때 AI를 다시 호출하지 않아요.')}</Text>
  {busy&&<ActivityIndicator color="#7762C9"/>}
  {!!error&&<Text accessibilityLiveRegion="polite" style={{color:'#A53048',fontSize:12}}>{error}</Text>}
  {pending&&!busy&&button(t('마지막 AI 작업 확인'),onCheck)}
  {result&&<>
   <Text style={{color:'#352C40',fontWeight:'600'}}>{t('스티커 미리보기')}</Text>
   <View style={{height:180,backgroundColor:'#D7DDE5',borderRadius:12,overflow:'hidden'}}><CachedImage data={result.data!} style={{width:'100%',height:'100%'}} resizeMode="contain"/></View>
   <Text style={{color:'#776B82',fontSize:12}}>{result.label}</Text>
   {button(t('캔버스에 추가'),()=>{void run(()=>onAdd(result.id));},full)}
  </>}
  <Text style={{color:'#352C40',fontSize:14,fontWeight:'600'}}>{t('이전에 만든 스티커')}</Text>
  {!assets.length&&<Text style={{color:'#776B82',fontSize:12}}>{t('완성한 스티커가 여기에 보관돼요.')}</Text>}
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:10}}>{assets.map(asset=><Pressable key={asset.id} accessibilityRole="button" accessibilityLabel={t('저장된 스티커 선택: {0}',asset.label)} disabled={busy||disabled} onPress={()=>{void run(async()=>{onSelect(await request<ReusableAsset>(connection,'/assets/get',{assetId:asset.id}));});}} style={{width:'30%',borderWidth:2,borderColor:result?.id===asset.id?'#7762C9':'#D8D0E1',borderRadius:10,padding:5}}><CachedImage data={asset.thumbnail!} style={{width:'100%',height:80,backgroundColor:'#D7DDE5',borderRadius:6}} resizeMode="contain"/><Text numberOfLines={2} style={{color:'#352C40',fontSize:11,marginTop:5}}>{asset.label}</Text></Pressable>)}</View>
 </>;
}
