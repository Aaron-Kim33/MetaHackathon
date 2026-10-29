import React,{useEffect,useRef,useState} from 'react';
import {AppState,Keyboard,Pressable,View} from 'react-native';
import {requireOptionalNativeModule} from 'expo-modules-core';
import Svg,{Path,Rect} from 'react-native-svg';
import {LocalizedText as Text,useLanguage} from './i18n-react';
import {t} from './i18n';
type SpeechModule=typeof import('expo-speech-recognition').ExpoSpeechRecognitionModule;
const speech=requireOptionalNativeModule<SpeechModule>('ExpoSpeechRecognition');

export function VoicePrompt({value,onChange,disabled,onListening,context='create'}:{value:string;onChange:(value:string)=>void;disabled:boolean;onListening:(value:boolean)=>void;context?:'create'|'retouch'|'repair'}){
 const language=useLanguage();
 const [listening,setListening]=useState(false),[starting,setStarting]=useState(false),[error,setError]=useState('');
 const alive=useRef(true),ownsSession=useRef(false),prefix=useRef('');
 const callbacks=useRef({onChange,onListening});callbacks.current={onChange,onListening};
 useEffect(()=>{
  alive.current=true;
  const listeners=speech?[
   speech.addListener('start',()=>{if(!alive.current||!ownsSession.current)return;setStarting(false);setListening(true);callbacks.current.onListening(true);}),
   speech.addListener('end',()=>{if(!alive.current)return;ownsSession.current=false;setStarting(false);setListening(false);callbacks.current.onListening(false);}),
   speech.addListener('result',event=>{if(!alive.current||!ownsSession.current)return;const text=event.results[0]?.transcript;if(text)callbacks.current.onChange([prefix.current,text].filter(Boolean).join(' ').slice(0,500));}),
   speech.addListener('nomatch',()=>{if(alive.current&&ownsSession.current)setError(t('음성을 인식하지 못했어요. 다시 말하거나 직접 입력해 주세요.'));}),
   speech.addListener('error',event=>{if(!alive.current||!ownsSession.current)return;setError(event.error==='not-allowed'?t('마이크와 음성 인식 권한을 허용해 주세요.'):event.error==='no-speech'||event.error==='speech-timeout'?t('음성을 인식하지 못했어요. 다시 말하거나 직접 입력해 주세요.'):t('음성 인식을 완료하지 못했어요. 기기의 음성 서비스와 연결을 확인하거나 직접 입력해 주세요.'));ownsSession.current=false;setStarting(false);setListening(false);callbacks.current.onListening(false);}),
  ]:[];
  const background=AppState.addEventListener('change',state=>{if(state!=='active'&&ownsSession.current){speech?.abort();ownsSession.current=false;setStarting(false);setListening(false);callbacks.current.onListening(false);}});
  return()=>{alive.current=false;listeners.forEach(listener=>listener.remove());background.remove();if(ownsSession.current){speech?.abort();callbacks.current.onListening(false);}};
 },[]);
 const toggle=async()=>{
  if(listening){speech?.stop();return;}
  if(disabled||starting)return;
  setError('');
  if(!speech){setError(t('음성 입력을 사용하려면 새 개발 앱을 설치해 주세요.'));return;}
  let available=false;try{available=speech.isRecognitionAvailable();}catch{}
  if(!available){setError(t('기기에 음성 인식 서비스가 없어요. 키보드로 설명을 입력해 주세요.'));return;}
  setStarting(true);
  try{
   const permission=await speech.requestPermissionsAsync();if(!alive.current)return;
   if(!permission.granted){setError(t('마이크와 음성 인식 권한을 허용해 주세요.'));setStarting(false);return;}
   Keyboard.dismiss();prefix.current=value.trim();ownsSession.current=true;callbacks.current.onListening(true);
   speech.start({lang:language==='ko'?'ko-KR':'en-US',interimResults:true,continuous:false,maxAlternatives:1,recordingOptions:{persist:false}});
  }catch{if(alive.current){ownsSession.current=false;setStarting(false);setListening(false);callbacks.current.onListening(false);setError(t('음성 인식을 완료하지 못했어요. 기기의 음성 서비스와 연결을 확인하거나 직접 입력해 주세요.'));}}
 };
 return <View style={{gap:6}}>
  <Pressable accessibilityRole="button" accessibilityLabel={listening?t('음성 입력 끝내기'):t('음성으로 설명하기')} disabled={starting||(disabled&&!listening)} onPress={()=>{void toggle();}} style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,padding:10,borderRadius:12,borderWidth:1,borderColor:listening?'#7762C9':'#C9BDDB',backgroundColor:listening?'#E5DCFA':'#F4EFF9',opacity:(starting||(disabled&&!listening))?0.5:1}}>
   <Svg width={18} height={20} viewBox="0 0 24 24"><Rect x={9} y={2} width={6} height={12} rx={3} stroke="#6350A2" strokeWidth={1.7} fill="none"/><Path d="M5 10v2a7 7 0 0014 0v-2M12 19v3M8 22h8" stroke="#6350A2" strokeWidth={1.7} strokeLinecap="round" fill="none"/></Svg>
   <Text style={{color:'#514064',fontSize:12,fontWeight:'600'}}>{starting?t('마이크를 준비하는 중'):listening?t('음성 입력 끝내기'):t('음성으로 설명하기')}</Text>
  </Pressable>
  <Text accessibilityLiveRegion="polite" style={{color:error?'#A53048':'#776B82',fontSize:11,lineHeight:16}}>{error||(context==='create'?(listening?t('듣고 있어요. 인식된 문장을 확인한 뒤 생성 버튼을 눌러 주세요.'):t('음성은 기기의 음성 인식 서비스로 처리돼요. 문장을 수정한 뒤 생성할 수 있어요.')):(listening?t('듣고 있어요. 설명을 확인한 뒤 실행 버튼을 눌러 주세요.'):t('말한 내용이 설명란에 입력돼요. 확인하고 수정한 뒤 실행해 주세요.')))}</Text>
 </View>;
}
