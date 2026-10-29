import { LocalizedText as Text } from './i18n-react';
import { t } from './i18n';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { CachedImage } from './CachedImage';
import { reportSpatialDiagnostic } from './render-diagnostics';
import { GLView } from 'expo-gl';
import type { ExpoWebGLRenderingContext } from 'expo-gl';
import * as FS from 'expo-file-system/legacy';
import { useSpatialMotion } from './use-spatial-motion';
import { createDepthFraming, depthCamera, depthMesh, surfaceMesh, foregroundFocus, spatialPreviewSurface, spatialObjectView } from './depth-mesh';
import type { DepthFrame } from './depth-mesh';
const vertex = `
precision highp float; attribute vec3 position; attribute vec2 uv; varying highp vec2 textureUV;
uniform float aspect; uniform vec4 camera; uniform float viewScale; uniform vec2 viewPan;
uniform vec3 objectPivot; uniform vec2 objectView;
void main() {
  vec3 q=position-objectPivot;
  float oy=cos(objectView.x), osy=sin(objectView.x), ox=cos(objectView.y), osx=sin(objectView.y);
  q=vec3(oy*q.x+osy*q.z,q.y,-osy*q.x+oy*q.z);
  q=vec3(q.x,ox*q.y-osx*q.z,osx*q.y+ox*q.z);
  q+=objectPivot;
  float cy=cos(camera.x), sy=sin(camera.x), cx=cos(camera.y), sx=sin(camera.y);
  vec3 p=vec3(cy*q.x+sy*q.z, q.y, -sy*q.x+cy*q.z);
  p=vec3(p.x, cx*p.y-sx*p.z, sx*p.y+cx*p.z);
  float distance=3.0-p.z;
  gl_Position=vec4(3.0*(p.x-camera.z)/aspect+camera.z*distance/aspect, 3.0*(p.y-camera.w)+camera.w*distance, distance*0.5-1.5, distance);
  gl_Position.xy=gl_Position.xy*viewScale+viewPan*distance;
  textureUV=uv;
}`;
const fragment = `precision highp float; varying highp vec2 textureUV; uniform sampler2D photo; void main(){vec4 color=texture2D(photo,textureUV); if(color.a<0.004)discard; gl_FragColor=color;}`;
export default function DepthSpatialCanvas({ frame, strength, calibration }: { frame: DepthFrame; strength: number; calibration: number }) {
  const [tour, setTour] = useState(false);
  const motion = useSpatialMotion(true, calibration), latest = useRef({ motion, strength, tour }); latest.current = { motion, strength, tour };
  const [error, setError] = useState('');
  const [ready,setReady] = useState(false),[contextEpoch,setContextEpoch] = useState(0);
  const dispose = useRef<(() => void) | null>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; if(dispose.current){dispose.current();dispose.current=null;setContextEpoch(n=>n+1);} return () => { alive.current = false; dispose.current?.(); }; }, []);
  const start = async (gl: ExpoWebGLRenderingContext) => {
    reportSpatialDiagnostic('context-created',{frameKey:frame.key,width:gl.drawingBufferWidth,height:gl.drawingBufferHeight,contextId:gl.contextId});
    setReady(false);setError('');dispose.current?.();
    let closed = false; let loop: number | null = null; const shaders: WebGLShader[] = [], textures: WebGLTexture[] = [], buffers: WebGLBuffer[] = [], files: string[] = [];
    let program: WebGLProgram | null = null;
    const cleanup = () => { if (closed) return; closed = true; if (loop !== null) cancelAnimationFrame(loop); loop = null; try { for (const texture of textures) gl.deleteTexture(texture); for (const b of buffers) gl.deleteBuffer(b); for (const s of shaders) gl.deleteShader(s); if (program) gl.deleteProgram(program); } catch { /* A lost native context has already released its GPU resources. */ } for (const uri of files) void FS.deleteAsync(uri, { idempotent: true }).catch(() => {}); };
    dispose.current = cleanup;
    const fail=(failure:unknown)=>{cleanup();const message=failure instanceof Error?failure.message:t("3D 화면을 표시하지 못했어요.");reportSpatialDiagnostic('error',{frameKey:frame.key,error:message,layers:frame.layers?.length||0});if(alive.current){setReady(false);setError(message);}};
    try {
      const mesh = frame.layers?.length ? null : depthMesh(frame);
      const compile = (kind: number, code: string) => { const shader = gl.createShader(kind); if (!shader) throw Error(t("셰이더를 만들지 못했어요.")); shaders.push(shader); gl.shaderSource(shader, code); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader) || t("셰이더 오류")); return shader; };
      program = gl.createProgram(); if (!program) throw Error(t("3D 화면을 시작하지 못했어요."));
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program) || t("3D 프로그램 오류"));
      gl.useProgram(program);
      const position = gl.getAttribLocation(program, 'position'), uv = gl.getAttribLocation(program, 'uv');
      const bindMesh = (vertices: Float32Array, indices: Uint16Array) => {
        const vb = gl.createBuffer(), ib = gl.createBuffer(); if (!vb || !ib) throw Error(t("3D 메모리를 준비하지 못했어요.")); buffers.push(vb, ib);
        gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
        return { vb, ib, count: indices.length };
      };
      const load = async (data: string, role: string, mipmap = false) => {
        if (!FS.cacheDirectory) throw Error(t("사진 캐시를 사용할 수 없어요."));
        const uri = `${FS.cacheDirectory}depth-${frame.key}-${role}-${Date.now()}.png`; files.push(uri);
        await FS.writeAsStringAsync(uri, data, { encoding: FS.EncodingType.Base64 });
        if (!alive.current || closed) { await FS.deleteAsync(uri, { idempotent: true }).catch(() => {}); return null; }
        const texture = gl.createTexture(); if (!texture) throw Error(t("사진을 준비하지 못했어요.")); textures.push(texture); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, { localUri: uri } as unknown as TexImageSource);
        if (mipmap) gl.generateMipmap(gl.TEXTURE_2D);
        const uploadError=gl.getError();if(uploadError!==gl.NO_ERROR)throw Error(t('3D 사진 업로드 오류: {0}',uploadError));
        return texture;
      };
      const a = frame.width / frame.height;
      const surfaces=frame.layers?.map(spatialPreviewSurface);
      const focus=foregroundFocus(surfaces||[]);
      const backdrop = surfaces?.find(surface => surface.id === 'backdrop');
      const framing = backdrop ? createDepthFraming(backdrop,focus) : null;
      const drawing: { item: ReturnType<typeof bindMesh>; texture: WebGLTexture; background?:boolean }[] = [];
      if (surfaces?.length) {
        for (const surface of surfaces) {
          const geometry = surfaceMesh(surface), texture = await load(surface.textureImage, surface.id, true);
          if (!texture || closed) { cleanup(); return; }
          drawing.push({ item: bindMesh(geometry.vertices, geometry.indices), texture,background:surface.id==='backdrop' });
        }
      } else if (mesh) {
        const main = bindMesh(mesh.vertices, mesh.indices), photo = await load(frame.image, 'photo'), far = await load(frame.farImage, 'back');
        if (!photo || !far || closed) { cleanup(); return; }
        const uv0 = .5 - 1.6 / (2 * (3.8 / 3)), uv1 = 1 - uv0;
        const back = bindMesh(new Float32Array([-a*1.6,-1.6,-.8,uv0,uv1, a*1.6,-1.6,-.8,uv1,uv1, -a*1.6,1.6,-.8,uv0,uv0, a*1.6,1.6,-.8,uv1,uv0]), new Uint16Array([0,1,2,2,1,3]));
        drawing.push({item:back,texture:far,background:true},{item:main,texture:photo});
        for (const edge of mesh.edges) drawing.push({ item:bindMesh(edge.vertices,edge.indices), texture:photo });
      }
      if (!alive.current || closed) { cleanup(); return; }
      // Native image uploads may alter GL state. Bind the drawing program and
      // framebuffer again after all asynchronous texture preparation completes.
      gl.useProgram(program);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.activeTexture(gl.TEXTURE0);
      const camera = gl.getUniformLocation(program, 'camera'); gl.uniform1f(gl.getUniformLocation(program, 'aspect'), a); gl.uniform1i(gl.getUniformLocation(program, 'photo'), 0);
      const viewPan = gl.getUniformLocation(program, 'viewPan');
      const viewScale=gl.getUniformLocation(program,'viewScale');
      const objectView=gl.getUniformLocation(program,'objectView');
      gl.uniform3f(gl.getUniformLocation(program,'objectPivot'),focus[0],focus[1],focus[2]);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.enableVertexAttribArray(position); gl.enableVertexAttribArray(uv); gl.disable(gl.CULL_FACE); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.clearColor(0,0,0,0);
      const draw = (item: ReturnType<typeof bindMesh>, texture: WebGLTexture) => { gl.bindBuffer(gl.ARRAY_BUFFER, item.vb); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, item.ib); gl.vertexAttribPointer(position,3,gl.FLOAT,false,20,0); gl.vertexAttribPointer(uv,2,gl.FLOAT,false,20,12); gl.bindTexture(gl.TEXTURE_2D,texture); gl.drawElements(gl.TRIANGLES,item.count,gl.UNSIGNED_SHORT,0); };
      const render = () => {
        if (!alive.current || closed) return;
        try {
        const time = Date.now() / 1000;
        const input = latest.current.motion.status === 'reduced' ? { x: 0, y: 0 } : latest.current.tour ? { x: Math.sin(time * .75) * .9, y: Math.sin(time * .47) * .55 } : latest.current.motion;
        const c = depthCamera(input, latest.current.strength);
        const orbit=spatialObjectView(input,latest.current.strength);
        const pan = framing?.pan(input,latest.current.strength) || {x:0,y:0};
        gl.uniform2f(viewPan,pan.x,pan.y);
        gl.viewport(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.uniform4f(camera,c.yaw,c.pitch,c.shiftX,c.shiftY); for (const d of drawing){gl.uniform2f(objectView,d.background?0:orbit.yaw,d.background?0:orbit.pitch);gl.uniform1f(viewScale,(d.background?framing?.backgroundScale:framing?.scale)??1.12);draw(d.item,d.texture);}
        if(loop===null){const code=gl.getError();if(code!==gl.NO_ERROR)throw Error(t('3D 그리기 오류: {0}',code));reportSpatialDiagnostic('ready',{frameKey:frame.key,layers:drawing.length,width:gl.drawingBufferWidth,height:gl.drawingBufferHeight,maxTextureSize:Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),contextId:gl.contextId});setReady(true);}
        gl.endFrameEXP(); loop=requestAnimationFrame(render);
        }catch(failure){fail(failure);}
      };
      render();
    } catch (failure) { fail(failure); }
  };
  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    <GLView key={contextEpoch} style={StyleSheet.absoluteFill} onContextCreate={start} msaaSamples={0} />
    {!ready&&<View pointerEvents="none" style={StyleSheet.absoluteFill}><CachedImage data={frame.image} style={StyleSheet.absoluteFill} resizeMode="stretch"/></View>}
    <View style={{ position:'absolute',top:12,left:12,right:72,padding:10,borderRadius:12,backgroundColor:'#19171FDF',flexDirection:'row',gap:8,alignItems:'center' }}>
      <View style={{ width:26,height:26,borderRadius:13,borderWidth:1,borderColor:'#8C80A0',alignItems:'center',justifyContent:'center' }}><View style={{ width:7,height:7,borderRadius:4,backgroundColor:motion.status==='active'?'#ADFFD3':'#F4C47D',transform:[{translateX:motion.x*8},{translateY:motion.y*8}] }} /></View>
      <Text style={{flex:1,color:'#F1EAF7',fontSize:11,lineHeight:16}}>{error ? t("깊이 미리보기 오류: {0}", error) : tour ? t("자동 3D 보기 · 가까운 곳과 먼 곳을 비교해 보세요.") : motion.status==='active' ? t("3D 깊이 보기 · 천천히 좌우로 기울여 보세요.") : motion.status==='waiting' ? t("기울기 신호를 기다리는 중이에요.") : t("동작 센서 권한과 동작 줄이기 설정을 확인해 주세요.")}</Text>
      {!ready&&!error&&<ActivityIndicator color="#ADFFD3"/>}
      {error ? <Pressable accessibilityRole="button" accessibilityLabel={t('3D 화면 다시 열기')} onPress={()=>{setReady(false);setError('');setContextEpoch(n=>n+1);}} style={{padding:8,borderRadius:10,backgroundColor:'#514362'}}><Text style={{color:'#fff',fontSize:10}}>{t('다시 열기')}</Text></Pressable> : <Pressable accessibilityRole="button" accessibilityLabel={tour ? t("자동 둘러보기 중지") : t("자동 둘러보기")} disabled={!ready||motion.status === 'reduced'} onPress={() => setTour(value => !value)} style={{ padding:8,borderRadius:10,backgroundColor:'#514362' }}><Text style={{color:'#fff',fontSize:10}}>{tour ? t("중지") : t("자동 보기")}</Text></Pressable>}
    </View>
  </View>;
}
