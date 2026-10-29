import { english } from './translations.ts';
export type Language = 'ko' | 'en';
let language: Language = 'ko';
const listeners = new Set<() => void>();
export const getLanguage = () => language;
export const subscribeLanguage = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setLanguage(next: Language) { if (next !== language) { language=next; for(const listener of listeners)listener(); } }
export const languageFromLocale = (locale: string) : Language => /^ko(?:[-_]|$)/i.test(locale) ? 'ko' : 'en';
const reverse = new Map(Object.entries(english).map(([ko,en])=>[en,ko]));
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const patterns = Object.entries(english).filter(([ko])=>/\{\d+\}/.test(ko)).flatMap(([ko,en])=>[ko,en].map(source=>{
  const slots: number[]=[];let cursor=0,pattern='';
  for(const match of source.matchAll(/\{(\d+)\}/g)){pattern+=escape(source.slice(cursor,match.index))+'([\\s\\S]*?)';slots.push(Number(match[1]));cursor=match.index!+match[0].length;}
  return {ko,slots,expression:new RegExp('^'+pattern+escape(source.slice(cursor))+'$')};
}));
export function translate(text: string, locale: Language, ...values: unknown[]): string {
  if(text.trim() && text!==text.trim())return text.replace(text.trim(),translate(text.trim(),locale,...values));
  let key=text,args=values;
  if(!(key in english)) {
    const original=reverse.get(text);
    if(original)key=original;
    else for(const p of patterns){const match=p.expression.exec(text);if(match){key=p.ko;args=[];p.slots.forEach((slot,i)=>{args[slot]=match[i+1];});break;}}
  }
  const format=locale==='en' ? english[key] ?? text : key;
  return format.replace(/\{(\d+)\}/g,(placeholder,index)=> args[Number(index)]===undefined ? placeholder : typeof args[Number(index)]==='string' ? translate(String(args[Number(index)]),locale) : String(args[Number(index)]));
}
export const t = (text: string, ...values: unknown[]) => translate(text,language,...values);
export function translateError(text: string) {
  if(text in english || reverse.has(text))return t(text);
  const known=Object.keys(english).filter(key=>!key.includes('{') && key.length>10 && text.includes(key)).sort((a,b)=>b.length-a.length)[0];
  return known ? t(known) : language==='en' && /[가-힣]/.test(text) ? t('작업을 완료하지 못했어요.') : t(text);
}
