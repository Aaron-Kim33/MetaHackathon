import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GLView } from 'expo-gl';
import type { ExpoWebGLRenderingContext } from 'expo-gl';
import * as FS from 'expo-file-system/legacy';
import { useSpatialMotion } from './use-spatial-motion';
import { depthCamera, depthMesh } from './depth-mesh';
import type { DepthFrame } from './depth-mesh';
const vertex = `
attribute vec3 position; attribute vec2 uv; varying vec2 textureUV;
uniform float aspect; uniform vec4 camera;
void main() {
  float cy=cos(camera.x), sy=sin(camera.x), cx=cos(camera.y), sx=sin(camera.y);
  vec3 p=vec3(cy*position.x+sy*position.z, position.y, -sy*position.x+cy*position.z);
  p=vec3(p.x, cx*p.y-sx*p.z, sx*p.y+cx*p.z);
  float distance=3.0-p.z;
  gl_Position=vec4(3.0*(p.x-camera.z)/aspect+camera.z*distance/aspect, 3.0*(p.y-camera.w)+camera.w*distance, distance*0.5-1.5, distance);
  textureUV=uv;
}`;
const fragment = `precision mediump float; varying vec2 textureUV; uniform sampler2D photo; void main(){gl_FragColor=texture2D(photo,textureUV);}`;
export default function DepthSpatialCanvas({ frame, strength, calibration }: { frame: DepthFrame; strength: number; calibration: number }) {
  const [tour, setTour] = useState(false);
  const motion = useSpatialMotion(true, calibration), latest = useRef({ motion, strength, tour }); latest.current = { motion, strength, tour };
  const [error, setError] = useState('');
  const dispose = useRef<(() => void) | null>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; dispose.current?.(); }; }, []);
  const start = async (gl: ExpoWebGLRenderingContext) => {
    let closed = false; let loop: number | null = null; const shaders: WebGLShader[] = [], textures: WebGLTexture[] = [], buffers: WebGLBuffer[] = [], files: string[] = [];
    let program: WebGLProgram | null = null;
    const cleanup = () => { if (closed) return; closed = true; if (loop !== null) cancelAnimationFrame(loop); loop = null; for (const t of textures) gl.deleteTexture(t); for (const b of buffers) gl.deleteBuffer(b); for (const s of shaders) gl.deleteShader(s); if (program) gl.deleteProgram(program); for (const uri of files) void FS.deleteAsync(uri, { idempotent: true }).catch(() => {}); };
    dispose.current = cleanup;
    try {
      const mesh = depthMesh(frame);
      const compile = (kind: number, code: string) => { const shader = gl.createShader(kind); if (!shader) throw Error('셰이더를 만들지 못했어요.'); shaders.push(shader); gl.shaderSource(shader, code); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader) || '셰이더 오류'); return shader; };
      program = gl.createProgram(); if (!program) throw Error('3D 화면을 시작하지 못했어요.');
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program) || '3D 프로그램 오류');
      gl.useProgram(program);
      const position = gl.getAttribLocation(program, 'position'), uv = gl.getAttribLocation(program, 'uv');
      const bindMesh = (vertices: Float32Array, indices: Uint16Array) => {
        const vb = gl.createBuffer(), ib = gl.createBuffer(); if (!vb || !ib) throw Error('3D 메모리를 준비하지 못했어요.'); buffers.push(vb, ib);
        gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
        return { vb, ib, count: indices.length };
      };
      const main = bindMesh(mesh.vertices, mesh.indices), edges = mesh.edges.map(edge => bindMesh(edge.vertices, edge.indices)), a = frame.width / frame.height;
      const uv0 = .5 - 1.6 / (2 * (3.8 / 3)), uv1 = 1 - uv0;
      const back = bindMesh(new Float32Array([-a*1.6,-1.6,-.8,uv0,uv1, a*1.6,-1.6,-.8,uv1,uv1, -a*1.6,1.6,-.8,uv0,uv0, a*1.6,1.6,-.8,uv1,uv0]), new Uint16Array([0,1,2,2,1,3]));
      const load = async (data: string, role: string) => {
        if (!FS.cacheDirectory) throw Error('사진 캐시를 사용할 수 없어요.');
        const uri = `${FS.cacheDirectory}depth-${frame.key}-${role}-${Date.now()}.png`; files.push(uri);
        await FS.writeAsStringAsync(uri, data, { encoding: FS.EncodingType.Base64 });
        if (!alive.current || closed) { await FS.deleteAsync(uri, { idempotent: true }).catch(() => {}); return null; }
        const texture = gl.createTexture(); if (!texture) throw Error('사진을 준비하지 못했어요.'); textures.push(texture); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, { localUri: uri } as unknown as TexImageSource);
        return texture;
      };
      const photo = await load(frame.image, 'photo'), far = await load(frame.farImage, 'back');
      if (!alive.current || closed || !photo || !far) { cleanup(); return; }
      const camera = gl.getUniformLocation(program, 'camera'); gl.uniform1f(gl.getUniformLocation(program, 'aspect'), a); gl.uniform1i(gl.getUniformLocation(program, 'photo'), 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.enableVertexAttribArray(position); gl.enableVertexAttribArray(uv); gl.disable(gl.CULL_FACE); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.clearColor(.93,.91,.87,1);
      const draw = (item: typeof main, texture: WebGLTexture) => { gl.bindBuffer(gl.ARRAY_BUFFER, item.vb); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, item.ib); gl.vertexAttribPointer(position,3,gl.FLOAT,false,20,0); gl.vertexAttribPointer(uv,2,gl.FLOAT,false,20,12); gl.bindTexture(gl.TEXTURE_2D,texture); gl.drawElements(gl.TRIANGLES,item.count,gl.UNSIGNED_SHORT,0); };
      const render = () => {
        if (!alive.current || closed) return;
        const t = Date.now() / 1000;
        const input = latest.current.motion.status === 'reduced' ? { x: 0, y: 0 } : latest.current.tour ? { x: Math.sin(t * .75) * .9, y: Math.sin(t * .47) * .55 } : latest.current.motion;
        const c = depthCamera(input, latest.current.strength);
        gl.viewport(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.uniform4f(camera,c.yaw,c.pitch,c.shiftX,c.shiftY); draw(back,far); draw(main,photo); for (const edge of edges) draw(edge,photo); gl.endFrameEXP(); loop=requestAnimationFrame(render);
      };
      render();
    } catch (failure) { cleanup(); if (alive.current) setError(failure instanceof Error ? failure.message : '3D 화면을 표시하지 못했어요.'); }
  };
  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    <GLView style={StyleSheet.absoluteFill} onContextCreate={start} msaaSamples={0} />
    <View style={{ position:'absolute',top:12,left:12,right:72,padding:10,borderRadius:12,backgroundColor:'#19171FDF',flexDirection:'row',gap:8,alignItems:'center' }}>
      <View style={{ width:26,height:26,borderRadius:13,borderWidth:1,borderColor:'#8C80A0',alignItems:'center',justifyContent:'center' }}><View style={{ width:7,height:7,borderRadius:4,backgroundColor:motion.status==='active'?'#ADFFD3':'#F4C47D',transform:[{translateX:motion.x*8},{translateY:motion.y*8}] }} /></View>
      <Text style={{flex:1,color:'#F1EAF7',fontSize:11,lineHeight:16}}>{error ? `깊이 미리보기 오류: ${error}` : tour ? '자동 3D 보기 · 가까운 곳과 먼 곳을 비교해 보세요.' : motion.status==='active' ? '3D 깊이 보기 · 천천히 좌우로 기울여 보세요.' : motion.status==='waiting' ? '기울기 신호를 기다리는 중이에요.' : '동작 센서 권한과 동작 줄이기 설정을 확인해 주세요.'}</Text>
      {!error && <Pressable accessibilityRole="button" accessibilityLabel={tour ? '자동 둘러보기 중지' : '자동 둘러보기'} disabled={motion.status === 'reduced'} onPress={() => setTour(value => !value)} style={{ padding:8,borderRadius:10,backgroundColor:'#514362' }}><Text style={{color:'#fff',fontSize:10}}>{tour ? '중지' : '자동 보기'}</Text></Pressable>}
    </View>
  </View>;
}
